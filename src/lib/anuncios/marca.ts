/**
 * Perfil de marca desde un sitio web (claude-ads, ads-dna): separa lo observado (título, colores,
 * fuentes, botones) de lo inferido (qué color sería el acento), y lo inferido lo confirma la persona.
 *
 * El contenido de la página es dato no confiable: no se ejecuta nada, sólo se leen textos y CSS con
 * expresiones regulares. Sólo http/https públicos (nada de localhost ni redes privadas, tampoco por
 * redirección), tope de tamaño y de tiempo, sin cookies ni formularios.
 */
import dns from "node:dns/promises";
import net from "node:net";

export interface Conteo {
  valor: string;
  veces: number;
}

export interface PerfilMarca {
  url: string;
  fecha: string;
  observado: {
    titulo: string;
    descripcion: string;
    sitio: string;
    h1: string;
    themeColor: string;
    colores: Conteo[];
    fuentes: Conteo[];
    botones: Conteo[];
  };
  /** Hipótesis a confirmar, no hechos. */
  inferido: {
    marca: string;
    acento1: string | null;
    acento2: string | null;
    activa: string | null;
    fuente: string | null;
    cta: string | null;
  };
  avisos: string[];
}

const MAX_HTML = 2_000_000;
const MAX_CSS = 600_000;
const TIEMPO = 10_000;

export function ipPrivada(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return ipPrivada(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

/** Lanza si la dirección no es http(s) pública (localhost, redes privadas, metadatos de la nube…). */
export async function asegurarPublica(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Sólo direcciones http o https");
  if (u.username || u.password) throw new Error("La dirección no puede llevar usuario ni contraseña");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("No se leen direcciones locales");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(ipPrivada)) throw new Error("No se leen direcciones de redes privadas o locales");
}

/** GET con redirecciones manuales (cada salto se vuelve a comprobar) y tope de bytes. */
async function traer(url: string, max: number): Promise<{ url: string; texto: string; tipo: string }> {
  let actual = new URL(url);
  for (let saltos = 0; saltos < 4; saltos++) {
    await asegurarPublica(actual);
    const r = await fetch(actual, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIEMPO),
      headers: { "user-agent": "Mozilla/5.0 (compatible; GeeperBrandReader/1.0)", accept: "text/html,text/css;q=0.9,*/*;q=0.5" },
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error(`Redirección sin destino (${r.status})`);
      actual = new URL(loc, actual);
      continue;
    }
    if (!r.ok) throw new Error(`La página respondió ${r.status}`);
    const lector = r.body?.getReader();
    if (!lector) return { url: actual.href, texto: "", tipo: r.headers.get("content-type") ?? "" };
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel();
        break;
      }
      partes.push(value);
    }
    const texto = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(partes));
    return { url: actual.href, texto, tipo: r.headers.get("content-type") ?? "" };
  }
  throw new Error("Demasiadas redirecciones");
}

function limpiar(s: string, max = 200): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n) || 32))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function meta(html: string, clave: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${clave}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? limpiar(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
}

function contar(valores: string[], max: number): Conteo[] {
  const m = new Map<string, number>();
  for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([valor, veces]) => ({ valor, veces })).sort((a, b) => b.veces - a.veces).slice(0, max);
}

export function normalizarHex(h: string): string | null {
  const v = h.replace("#", "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) return `#${v.split("").map((c) => c + c).join("")}`;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-f]{8}$/.test(v)) return `#${v.slice(0, 6)}`;
  return null;
}

/** Saturación y luminosidad (HSL) de un #rrggbb. */
export function sl(hex: string): { s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

const GENERICAS = new Set(["sans-serif", "serif", "monospace", "system-ui", "inherit", "initial", "cursive", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica", "helvetica neue", "arial", "ui-sans-serif", "ui-serif", "var", "emoji", "apple color emoji", "segoe ui emoji", "noto color emoji"]);

/** Analiza HTML y CSS ya descargados (función pura, para probarla). */
export function analizar(url: string, html: string, css: string[], fecha = new Date().toISOString().slice(0, 10)): PerfilMarca {
  const avisos: string[] = [];
  const estilos = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
  const enLinea = [...html.matchAll(/style=["']([^"']*)["']/gi)].map((m) => m[1] ?? "");
  const todoCss = [...css, ...estilos, ...enLinea].join("\n");

  const themeColor = normalizarHex(meta(html, "theme-color")) ?? "";
  const hex = [...todoCss.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => normalizarHex(m[0])).filter((x): x is string => Boolean(x));
  const colores = contar(hex, 12);

  const fuentesCss = [...todoCss.matchAll(/font-family\s*:\s*([^;}{]+)/gi)]
    .map((m) => (m[1] ?? "").split(",")[0]!.replace(/["']/g, "").trim())
    .filter((f) => f && !f.startsWith("var(") && !GENERICAS.has(f.toLowerCase()));
  const google = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)].flatMap((m) =>
    [...(m[1] ?? "").replace(/&amp;/g, "&").matchAll(/family=([^&:]+)/g)].map((f) => decodeURIComponent((f[1] ?? "").replace(/\+/g, " "))),
  );
  const fuentes = contar([...google, ...google, ...fuentesCss].map((f) => limpiar(f, 60)), 6);

  const botones = contar(
    [
      ...[...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => limpiar(m[1] ?? "", 40)),
      ...[...html.matchAll(/<a[^>]+class=["'][^"']*(?:btn|button|cta|boton)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => limpiar(m[1] ?? "", 40)),
    ].filter((t) => t.length >= 3 && t.length <= 30),
    6,
  );

  const titulo = limpiar(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 120);
  const sitio = meta(html, "og:site_name");
  const descripcion = meta(html, "description") || meta(html, "og:description");
  const h1 = limpiar(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "", 160);

  // Inferencias: los colores con más saturación y luminosidad media son candidatos a acento.
  const vivos = colores.map((c) => ({ ...c, ...sl(c.valor) })).filter((c) => c.s >= 0.35 && c.l >= 0.25 && c.l <= 0.8);
  const candidatos = [...new Set([themeColor, ...vivos.map((c) => c.valor)].filter(Boolean))];
  const claro = vivos.filter((c) => c.l >= 0.5).sort((a, b) => b.veces - a.veces)[0]?.valor ?? null;
  const marca = sitio || titulo.split(/\s[|·—–-]\s/)[0]?.trim() || new URL(url).hostname.replace(/^www\./, "");
  if (!colores.length) avisos.push("No se encontraron colores en el HTML ni en sus hojas de estilo (puede que se carguen con JavaScript).");
  if (!candidatos.length && colores.length) avisos.push("Los colores del sitio son neutros: elige los acentos a mano.");
  if (fuentes.length) avisos.push("Las fuentes son sólo una observación: para usarlas en el video tienen que estar disponibles para Hyperframes y tener licencia.");
  return {
    url, fecha,
    observado: { titulo, descripcion, sitio, h1, themeColor, colores, fuentes, botones },
    inferido: { marca: marca.slice(0, 60), acento1: candidatos[0] ?? null, acento2: candidatos[1] ?? null, activa: claro, fuente: fuentes[0]?.valor ?? null, cta: botones[0]?.valor ?? null },
    avisos,
  };
}

export async function leerMarca(url: string): Promise<PerfilMarca> {
  const pagina = await traer(url, MAX_HTML);
  if (!/html/i.test(pagina.tipo) && !/<html/i.test(pagina.texto.slice(0, 2000))) throw new Error("La dirección no devolvió una página HTML");
  const hojas = [...pagina.texto.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => m[0].match(/href=["']([^"']+)["']/i)?.[1])
    .filter((h): h is string => Boolean(h))
    .map((h) => new URL(h.replace(/&amp;/g, "&"), pagina.url))
    .filter((u) => u.hostname === new URL(pagina.url).hostname)
    .slice(0, 3);
  const css: string[] = [];
  for (const h of hojas) {
    try {
      css.push((await traer(h.href, MAX_CSS)).texto);
    } catch {
      /* una hoja que falla no impide el perfil */
    }
  }
  return analizar(pagina.url, pagina.texto, css);
}
