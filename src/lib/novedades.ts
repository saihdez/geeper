/**
 * Novedades de los repos integrados (docs/fuentes.json): versiones publicadas después de la que usa
 * Geeper y commits posteriores a la última revisión. Consulta GitHub (y npm para Hyperframes) como
 * mucho una vez al día; el resultado queda en ~/geeper-data/novedades.json. No cambia nada: la UI
 * ofrece actualizar las apps de Media y, para el resto, la skill `/novedades` revisa y propone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { escribirAtomico } from "./archivos";
import { dirDatos, RAIZ_REPO } from "./rutas";

const Fuente = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  tipo: z.enum(["release", "commits", "npm"]),
  como: z.array(z.enum(["binario", "web", "codigo", "servicio"])),
  version: z.string().optional(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  paquete: z.string().optional(),
  ruta: z.string().optional(),
  revisado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  que: z.string(),
  archivos: z.array(z.string()).optional(),
  docs: z.string().optional(),
  pruebas: z.array(z.string()).optional(),
  /**
   * Ya no se sigue (p. ej. el autor borró el repo): queda registrada con el motivo, pero no se consulta.
   * Lo que se integró sigue en Geeper; `copia` apunta, sólo como referencia, a una copia fiel.
   */
  archivada: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motivo: z.string(), copia: z.string().optional() }).optional(),
});
export type Fuente = z.infer<typeof Fuente>;
const Registro = z.object({ fuentes: z.array(Fuente) }).passthrough();

export const rutaFuentes = () => path.join(RAIZ_REPO, "docs", "fuentes.json");

export async function leerFuentes(archivo = rutaFuentes()): Promise<Fuente[]> {
  return Registro.parse(JSON.parse(await fs.readFile(archivo, "utf8"))).fuentes;
}

/** «v0.24.1» → [0, 24, 1]. Compara números; lo que no es número cuenta como 0. */
const partes = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
export function compararVersiones(a: string, b: string): number {
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export interface Lanzamiento {
  version: string;
  fecha: string;
  url: string;
  /** Notas de la versión, recortadas. */
  notas: string;
}
export interface CommitNuevo {
  sha: string;
  fecha: string;
  mensaje: string;
  url: string;
}
export interface Novedad {
  id: string;
  repo: string;
  como: Fuente["como"];
  que: string;
  base: { version?: string; commit?: string; revisado: string };
  nuevas: Lanzamiento[];
  commits: CommitNuevo[];
  /** Hay commits más allá de los que se listan. */
  masCommits: boolean;
  error?: string;
}
export interface Informe {
  fecha: string;
  novedades: Novedad[];
}

const MAX_NOTAS = 4000;
const recortar = (s: string) => (s.length > MAX_NOTAS ? `${s.slice(0, MAX_NOTAS)}\n…` : s);

type Pedir = (url: string) => Promise<unknown>;

/** Respuesta guardada de una consulta, con su ETag: si GitHub responde 304, se reutiliza (TER-08). */
export interface Guardada {
  etag: string;
  cuerpo: unknown;
}

/**
 * Pide JSON con reintentos. Con `memoria` manda `If-None-Match` con el ETag de la última respuesta de
 * esa URL: un 304 no gasta cuota de GitHub (60 consultas por hora sin token) y devuelve lo guardado.
 * `hacerFetch` se inyecta en las pruebas.
 */
export function crearPedidor(memoria: Map<string, Guardada> = new Map(), hacerFetch: typeof fetch = fetch): Pedir {
  return async (url) => {
    const headers: Record<string, string> = { "user-agent": "geeper-novedades", accept: "application/vnd.github+json" };
    // Opcional: con un token sube el límite de GitHub (60 consultas por hora sin él; Geeper usa ~25 al día).
    if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const previa = memoria.get(url);
    if (previa) headers["if-none-match"] = previa.etag;
    // La conexión con GitHub a veces tarda o se corta: tres intentos con pausa creciente.
    for (let i = 1; ; i++) {
      try {
        const r = await hacerFetch(url, { headers, signal: AbortSignal.timeout(60_000) });
        if (r.status === 304 && previa) return previa.cuerpo;
        if (r.status === 403 || r.status === 429) throw new Error("GitHub limitó las consultas por ahora; se vuelve a intentar más tarde");
        if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`);
        const cuerpo: unknown = await r.json();
        const etag = r.headers.get("etag");
        if (etag) memoria.set(url, { etag, cuerpo });
        return cuerpo;
      } catch (e) {
        const http = e instanceof Error && /respondió|limitó/.test(e.message);
        if (http || i >= 3) throw new Error(http ? (e as Error).message : `No se pudo conectar con ${new URL(url).host} (${e instanceof Error ? e.message : String(e)})`);
        await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  };
}

const pedirJson: Pedir = crearPedidor();

interface CommitGh {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string } };
}

const MAX_COMMITS = 30;

/** Lo nuevo de una fuente respecto de su base. `pedir` se inyecta en las pruebas. */
export async function consultar(f: Fuente, pedir: Pedir = pedirJson): Promise<Novedad> {
  const n: Novedad = { id: f.id, repo: f.repo, como: f.como, que: f.que, base: { version: f.version, commit: f.commit, revisado: f.revisado }, nuevas: [], commits: [], masCommits: false };
  try {
    if (f.tipo === "release") {
      const rels = (await pedir(`https://api.github.com/repos/${f.repo}/releases?per_page=20`)) as { tag_name: string; published_at: string; html_url: string; body?: string; draft?: boolean; prerelease?: boolean }[];
      n.nuevas = rels
        .filter((r) => !r.draft && !r.prerelease)
        .filter((r) => (f.version ? compararVersiones(r.tag_name, f.version) > 0 : r.published_at.slice(0, 10) > f.revisado))
        .map((r) => ({ version: r.tag_name.replace(/^v/i, ""), fecha: r.published_at.slice(0, 10), url: r.html_url, notas: recortar(r.body ?? "") }))
        .sort((a, b) => compararVersiones(b.version, a.version));
    } else if (f.tipo === "npm") {
      const j = (await pedir(`https://registry.npmjs.org/${f.paquete ?? f.id}`)) as { time?: Record<string, string> };
      n.nuevas = Object.entries(j.time ?? {})
        .filter(([v]) => /^\d+\.\d+\.\d+$/.test(v) && (!f.version || compararVersiones(v, f.version) > 0))
        .map(([v, fecha]) => ({ version: v, fecha: fecha.slice(0, 10), url: `https://github.com/${f.repo}/releases/tag/v${v}`, notas: "" }))
        .sort((a, b) => compararVersiones(b.version, a.version));
    }
    if (f.tipo === "commits" || f.como.includes("codigo")) {
      const comoNuevos = (cs: CommitGh[]) =>
        cs
          .filter((c) => !f.commit || !c.sha.startsWith(f.commit))
          .slice(0, MAX_COMMITS)
          .map((c) => ({ sha: c.sha.slice(0, 7), fecha: (c.commit.committer?.date ?? "").slice(0, 10), mensaje: c.commit.message.split("\n")[0]!.slice(0, 200), url: c.html_url }));
      // Con un commit fijado y sin ruta: lo que vino después de ese commit, no lo fechado después de la
      // revisión (un commit viejo que se fusiona tarde también cuenta). Si GitHub no conoce el commit,
      // se cae a la fecha.
      let hecho = false;
      if (f.commit && !f.ruta) {
        try {
          const cmp = (await pedir(`https://api.github.com/repos/${f.repo}/compare/${f.commit}...HEAD`)) as { total_commits?: number; commits?: CommitGh[] };
          const cs = [...(cmp.commits ?? [])].reverse(); // GitHub los da del más viejo al más nuevo.
          n.commits = comoNuevos(cs);
          n.masCommits = (cmp.total_commits ?? cs.length) > n.commits.length;
          hecho = true;
        } catch (e) {
          if (!(e instanceof Error && /respondió 404/.test(e.message))) throw e;
        }
      }
      if (!hecho) {
        const q = new URLSearchParams({ since: `${f.revisado}T00:00:00Z`, per_page: String(MAX_COMMITS) });
        if (f.ruta) q.set("path", f.ruta);
        const cs = (await pedir(`https://api.github.com/repos/${f.repo}/commits?${q}`)) as CommitGh[];
        n.commits = comoNuevos(cs);
        n.masCommits = cs.length === MAX_COMMITS;
      }
    }
  } catch (e) {
    n.error = e instanceof Error ? e.message : String(e);
  }
  return n;
}

export const tieneNovedades = (n: Novedad) => n.nuevas.length > 0 || n.commits.length > 0;

const rutaCache = () => path.join(dirDatos(), "novedades.json");
const rutaEtags = () => path.join(dirDatos(), "novedades-etag.json");
const UN_DIA = 24 * 60 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;

export async function leerCache(): Promise<Informe | null> {
  try {
    return JSON.parse(await fs.readFile(rutaCache(), "utf8")) as Informe;
  } catch {
    return null;
  }
}

/**
 * Un informe vale un día; uno con errores (red caída, GitHub limitó) sólo una hora (TER-08): si no,
 * el informe incompleto quedaba 24 h y no se veían las novedades de esas fuentes.
 */
export function informeFresco(inf: Informe | null, ahora = Date.now()): inf is Informe {
  if (!inf) return false;
  const edad = ahora - Date.parse(inf.fecha);
  return edad < (inf.novedades.some((n) => n.error) ? UNA_HORA : UN_DIA);
}

async function leerEtags(): Promise<Map<string, Guardada>> {
  try {
    return new Map(Object.entries(JSON.parse(await fs.readFile(rutaEtags(), "utf8")) as Record<string, Guardada>));
  } catch {
    return new Map();
  }
}

const g = globalThis as unknown as { __buscandoNovedades?: Promise<Informe> };

/** Novedades de todas las fuentes: del caché si sigue fresco (ver `informeFresco`), salvo con `forzar`. */
export async function buscarNovedades({ forzar = false, pedir }: { forzar?: boolean; pedir?: Pedir } = {}): Promise<Informe> {
  const cache = await leerCache();
  if (!forzar && informeFresco(cache)) return cache;
  g.__buscandoNovedades ??= (async () => {
    const fuentes = (await leerFuentes()).filter((f) => !f.archivada);
    // Sin `pedir` inyectado: las respuestas anteriores con su ETag, para que lo que no cambió no gaste cuota.
    const etags = pedir ? null : await leerEtags();
    const pedirAhora = pedir ?? crearPedidor(etags!);
    const novedades: Novedad[] = [];
    // De a 4 para no saturar la red ni el límite de GitHub.
    for (let i = 0; i < fuentes.length; i += 4) novedades.push(...(await Promise.all(fuentes.slice(i, i + 4).map((f) => consultar(f, pedirAhora)))));
    const informe: Informe = { fecha: new Date().toISOString(), novedades };
    await fs.mkdir(dirDatos(), { recursive: true });
    await escribirAtomico(rutaCache(), JSON.stringify(informe, null, 2));
    if (etags) await escribirAtomico(rutaEtags(), JSON.stringify(Object.fromEntries(etags)));
    return informe;
  })().finally(() => {
    g.__buscandoNovedades = undefined;
  });
  return g.__buscandoNovedades;
}

/**
 * Marca una fuente como revisada hasta hoy (y, si se dan, la versión o el commit que quedan como base).
 * Lo usa `scripts/novedades.ts --marcar` después de revisar con la skill /novedades.
 */
export async function marcarRevisada(id: string, cambios: { version?: string; commit?: string; hoy?: string }, archivo = rutaFuentes()): Promise<Fuente> {
  const j = JSON.parse(await fs.readFile(archivo, "utf8")) as { fuentes: Fuente[] };
  const f = j.fuentes.find((x) => x.id === id);
  if (!f) throw new Error(`No hay una fuente «${id}» en docs/fuentes.json`);
  f.revisado = cambios.hoy ?? new Date().toISOString().slice(0, 10);
  if (cambios.version) f.version = cambios.version.replace(/^v/i, "");
  if (cambios.commit) f.commit = cambios.commit;
  Registro.parse(j);
  await escribirAtomico(archivo, `${JSON.stringify(j, null, 2)}\n`);
  return f;
}
