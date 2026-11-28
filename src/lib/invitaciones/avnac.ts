/**
 * La invitación como diseño de Avnac Studio (src/lib/avnac.ts): cada parte de la página es una página del
 * diseño y cada pieza (textos, foto, QR, botones, adornos, colores) va suelta para editarla a gusto.
 *
 * Formato: el «v2» de Avnac (el esquema plano de avnac.design), que Avnac Studio 0.4.1 importa desde
 * «Import» en su pantalla de archivos (`parseAvnacImport` → `parseV2WorkspaceImport` en su código):
 * `{ v: 2, artboard, bg, activePageId, pages: [{ id, name, bg, objects: [...] }] }`, y cada objeto con
 * id/type/x/y/width/height/rotation/opacity/visible/fill/stroke (+ text/fontFamily/fontSize… o src).
 * Revisado contra el código de su v0.4.1 (frontend/src/lib/saraswati/compat/from-avnac-v2.ts).
 *
 * Avnac exporta imagen o PDF: esto es para imprimir o compartir como imagen. La página interactiva se
 * corrige en Geeper («Corregir textos»). Función pura: los recursos llegan ya leídos.
 */
import { TIPOS_INFO } from "./catalogo";
import { instanteUTC, semanasDelMes, textosFecha } from "./calendario";
import { basesDe, iniciales, retoquesVigentes } from "./compilar";
import type { Invitacion } from "./esquema";
import { estiloDe, SIMBOLOS } from "./estilo";
import { LETRAS_TEXTO, LETRAS_TITULOS } from "./tema";

export const ANCHO = 1080;
export const ALTO = 1920;

type Pintura = { type: "solid"; color: string };
const solido = (color: string): Pintura => ({ type: "solid", color });
const NADA = solido("transparent");

interface Base {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  fill: Pintura;
  stroke: Pintura;
  strokeWidth: number;
}
export type ObjetoAvnac =
  | (Base & { type: "rect"; cornerRadius: number })
  | (Base & { type: "ellipse" })
  | (Base & { type: "text"; text: string; fontFamily: string; fontSize: number; lineHeight: number; fontWeight: string; textAlign: "left" | "center" | "right" })
  | (Base & { type: "image"; src: string; cornerRadius?: number });

export interface PaginaAvnac {
  id: string;
  name: string;
  bg: Pintura;
  objects: ObjetoAvnac[];
}

export interface DisenoAvnac {
  v: 2;
  artboard: { width: number; height: number };
  bg: Pintura;
  activePageId: string;
  pages: PaginaAvnac[];
}

export interface RecursosAvnac {
  /** foto.webp en base64. */
  fotoB64?: string;
  /** qr.png en base64 (si la invitación está publicada). */
  qrB64?: string;
}

/** Letras anchas (mayúsculas romanas, display): cada letra ocupa más que en una letra de texto. */
const LETRAS_ANCHAS = /^(Cinzel|Cinzel Decorative|Uncial Antiqua|Abril Fatface|Bodoni Moda|Italiana|MedievalSharp|Playfair Display|Lobster)$/;

/** Ancho medio de una letra, en fracciones del tamaño (estimado a lo seguro). */
export const anchoLetra = (letra: string, mayus = false) => (LETRAS_ANCHAS.test(letra) || mayus ? 0.74 : 0.56);

/** Tamaño para que la palabra más larga quepa en una línea (los nombres largos no se cortan). */
export function tamanoQueCabe(texto: string, tamano: number, ancho: number, porLetra: number): number {
  const larga = Math.max(1, ...texto.split(/\s+/).map((w) => w.length));
  return Math.max(24, Math.min(tamano, Math.floor(ancho / (larga * porLetra))));
}

/** Alto de un texto con ese ancho, repartiendo palabras enteras por línea (para que la caja no corte líneas). */
export function altoTexto(texto: string, tamano: number, ancho: number, interlineado: number, porLetra: number): number {
  const porLinea = Math.max(1, Math.floor(ancho / (tamano * porLetra)));
  let lineas = 0;
  for (const parrafo of texto.split("\n")) {
    let actual = 0;
    lineas++;
    for (const w of parrafo.split(/\s+/).filter(Boolean)) {
      if (actual && actual + 1 + w.length > porLinea) {
        lineas++;
        actual = w.length;
      } else actual += (actual ? 1 : 0) + w.length;
    }
  }
  return Math.ceil(lineas * tamano * interlineado + tamano * 0.25);
}

const sinClave = <T extends { clave?: string }>(o: T): Omit<T, "clave"> => {
  const { clave: _c, ...resto } = o;
  return resto;
};

const svgDato = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** Un adorno como SVG suelto, con sus colores puestos (la página los toma del CSS). */
function svgAdorno(cuerpo: string, viewBox: string, acento: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="${acento}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><style>.relleno{fill:${acento};fill-opacity:.35}</style>${cuerpo}</svg>`;
}

export function disenoAvnac(inv: Invitacion, r: RecursosAvnac = {}, ahora = Date.now()): DisenoAvnac {
  const e = estiloDe(inv);
  const c = e.colores;
  const bases = basesDe(inv);
  const { vigentes } = retoquesVigentes(inv);
  const t = (k: string) => vigentes[k]?.texto ?? bases[k] ?? "";
  const ocultas = new Set<string>(inv.ocultas ?? []);
  const letraT = e.letras.titulos;
  const letraX = e.letras.texto;
  const divisorSvg = e.adorno === "clasico"
    ? svgAdorno('<path d="M2 10h70M128 10h70"/><path class="relleno" d="M100 3c-6 0-10 7-18 7 8 0 12 7 18 7s10-7 18-7c-8 0-12-7-18-7z"/><circle cx="76" cy="10" r="2"/><circle cx="124" cy="10" r="2"/>', "0 0 200 20", c.acento)
    : svgAdorno(`<path d="M2 12h76M122 12h76"/><g class="relleno" transform="translate(88 0)">${SIMBOLOS[e.adorno]}</g>`, "0 0 200 24", c.acento);

  const paginas: PaginaAvnac[] = [];
  let n = 0;
  let seccion = "portada";
  /** «<parte>--<pieza>-<n>», o «<parte>--ed-<clave>» si es un texto de la página: así se lee de vuelta (cambiosDesdeAvnac). */
  const id = (nombre: string, clave?: string) => `${seccion}--${clave ? `ed-${clave}` : `${nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}-${++n}`}`;
  const base = (nombre: string, x: number, y: number, w: number, h: number, extra: Partial<Base> & { clave?: string } = {}): Base => ({
    id: id(nombre, extra.clave), name: nombre, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h),
    rotation: 0, opacity: 1, visible: true, fill: NADA, stroke: NADA, strokeWidth: 0, ...sinClave(extra),
  });

  /** Arma una página: fondo, tarjeta (opcional) y lo que se le agregue, de arriba abajo. */
  function pagina(nombre: string, parte: string, tarjeta: boolean, armar: (p: { y: number; texto: typeof texto; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }) => void) {
    seccion = parte;
    const objetos: ObjetoAvnac[] = [];
    const X = 90;
    const W = ANCHO - 2 * X;
    const ctx = { y: tarjeta ? 330 : 260 };
    function texto(nombreT: string, contenido: string, o: { clave?: string; tamano: number; letra?: string; color?: string; peso?: string; interlineado?: number; mayus?: boolean; margen?: number }) {
      const ancho = W - 2 * 70;
      const valor = o.mayus ? contenido.toUpperCase() : contenido;
      const inter = o.interlineado ?? 1.25;
      const letra = o.letra ?? letraX;
      const porLetra = anchoLetra(letra, o.mayus);
      const tamano = tamanoQueCabe(valor, o.tamano, ancho, porLetra);
      const h = altoTexto(valor, tamano, ancho, inter, porLetra);
      objetos.push({ ...base(nombreT, X + 70, ctx.y, ancho, h, { clave: o.clave, fill: solido(o.color ?? (tarjeta ? c.tinta : c.claro)) }), type: "text", text: valor, fontFamily: letra, fontSize: tamano, lineHeight: inter, fontWeight: o.peso ?? "normal", textAlign: "center" });
      ctx.y += h + (o.margen ?? 30);
    }
    const p = {
      get y() { return ctx.y; },
      texto,
      agregar: (o: ObjetoAvnac) => objetos.push(o),
      espacio: (h: number) => { ctx.y += h; },
    };
    const inicio = ctx.y;
    armar(p);
    const fondo: ObjetoAvnac[] = tarjeta
      ? [{ ...base("Tarjeta", X, 220, W, Math.max(ctx.y - 220 + 80, 700), { fill: solido(c.tarjeta) }), type: "rect", cornerRadius: 56 }]
      : [];
    // Centrado en la página: lo de arriba abajo (con la tarjeta) se baja hasta quedar al medio.
    const piezas = [...fondo, ...objetos.filter((o) => o.name !== "Adorno de esquina")];
    const arriba = Math.min(...piezas.map((o) => o.y), inicio);
    const abajo = Math.max(...piezas.map((o) => o.y + o.height));
    const bajar = Math.max(0, Math.round((ALTO - (abajo - arriba)) / 2 - arriba));
    for (const o of piezas) o.y += bajar;
    paginas.push({ id: `pagina-${parte}`, name: nombre, bg: solido(c.fondo), objects: [...fondo, ...objetos] });
  }
  const divisor = (p: { y: number; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }) => {
    p.agregar({ ...base("Adorno", (ANCHO - 360) / 2, p.y, 360, 43), type: "image", src: svgDato(divisorSvg) });
    p.espacio(80);
  };
  const boton = (p: { y: number; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }, nombre: string, etiqueta: string, clave: string) => {
    const w = 640;
    const x = (ANCHO - w) / 2;
    p.agregar({ ...base(`Botón ${nombre}`, x, p.y, w, 120, { fill: solido(c.tinta) }), type: "rect", cornerRadius: 60 });
    p.agregar({ ...base(`Texto del botón ${nombre}`, x, p.y + 32, w, 60, { clave, fill: solido(c.tarjeta) }), type: "text", text: etiqueta, fontFamily: letraX, fontSize: 44, lineHeight: 1.2, fontWeight: "600", textAlign: "center" });
    p.espacio(170);
  };

  // 1. Portada: adornos en las esquinas, títulos, el sobre (o la foto) y la pista.
  pagina("Portada", "portada", false, (p) => {
    if (e.adorno !== "clasico") {
      const s = SIMBOLOS[e.adorno];
      const racimo = svgDato(svgAdorno(`<g transform="translate(6 10) scale(2.2) rotate(-12 12 12)">${s}</g><g transform="translate(62 4) scale(1.3) rotate(18 12 12)">${s}</g><g transform="translate(18 66) scale(1.1) rotate(30 12 12)">${s}</g>`, "0 0 120 120", c.acento));
      p.agregar({ ...base("Adorno de esquina", 20, 40, 300, 300, { opacity: 0.6 }), type: "image", src: racimo });
      p.agregar({ ...base("Adorno de esquina", ANCHO - 320, ALTO - 360, 300, 300, { opacity: 0.6, rotation: 180 }), type: "image", src: racimo });
    }
    p.espacio(60);
    p.texto("Título", t("pre"), { clave: "pre", tamano: 40, mayus: true, margen: 40 });
    p.texto("Nombres", t("nombres"), { clave: "nombres", tamano: 150, letra: letraT, interlineado: 1.05, margen: 80 });
    const w = 820;
    const h = Math.round(w * 2 / 3);
    const x = (ANCHO - w) / 2;
    if (r.fotoB64) {
      p.agregar({ ...base("Foto del sobre", x, p.y, w, h), type: "image", src: `data:image/webp;base64,${r.fotoB64}`, cornerRadius: 24 });
    } else {
      p.agregar({ ...base("Sobre", x, p.y, w, h, { fill: solido(c.sobre) }), type: "rect", cornerRadius: 20 });
      p.agregar({ ...base("Tarjeta del sobre", x + 50, p.y + 40, w - 100, h - 80, { fill: solido(c.tarjeta) }), type: "rect", cornerRadius: 14 });
      p.agregar({ ...base("Texto del sobre", x + 50, p.y + 120, w - 100, 50, { clave: bases.carta ? "carta" : undefined, fill: solido(c.tinta) }), type: "text", text: (bases.carta ? t("carta") : "").toUpperCase(), fontFamily: letraX, fontSize: 34, lineHeight: 1.2, fontWeight: "normal", textAlign: "center" });
      p.agregar({ ...base("Sello", (ANCHO - 190) / 2, p.y + h - 150, 190, 190, { fill: solido(c.sello) }), type: "ellipse" });
      p.agregar({ ...base("Iniciales del sello", (ANCHO - 190) / 2, p.y + h - 100, 190, 90, { fill: solido(c.tarjeta) }), type: "text", text: iniciales(inv.nombres), fontFamily: letraT, fontSize: 64, lineHeight: 1.1, fontWeight: "normal", textAlign: "center" });
    }
    p.espacio(h + 120);
    p.texto("Pista", t("pista"), { clave: "pista", tamano: 38 });
  });

  // 2. Mensaje.
  if (!ocultas.has("mensaje")) pagina("Mensaje", "mensaje", true, (p) => {
    p.texto("Saludo", t("saludo"), { clave: "saludo", tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Mensaje", t("mensaje"), { clave: "mensaje", tamano: 46, interlineado: 1.5, margen: 60 });
    p.texto("Firma", t("firma"), { clave: "firma", tamano: 90, letra: letraT, interlineado: 1.1 });
  });

  // 3. Fecha: el mes con cada día suelto y el del evento marcado, fecha y hora.
  if (!ocultas.has("fecha")) pagina("Fecha", "fecha", true, (p) => {
    const inicio = instanteUTC(inv.fecha, inv.hora, inv.zona);
    const f = textosFecha(inicio, inv.zona);
    const mesNum = +new Intl.DateTimeFormat("en-US", { timeZone: inv.zona, month: "numeric" }).format(inicio);
    p.texto("Mes", f.mes, { tamano: 100, letra: letraT, interlineado: 1.1, margen: 30 });
    const celda = 118;
    const x0 = (ANCHO - celda * 7) / 2;
    ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].forEach((d, i) => p.agregar({ ...base(`Día ${d}`, x0 + i * celda, p.y, celda, 44, { fill: solido(c.tinta) }), type: "text", text: d.toUpperCase(), fontFamily: letraX, fontSize: 28, lineHeight: 1.2, fontWeight: "600", textAlign: "center" }));
    p.espacio(70);
    for (const semana of semanasDelMes(f.anio, mesNum)) {
      semana.forEach((d, i) => {
        if (d === null) return;
        if (d === f.dia) p.agregar({ ...base("Marca del día", x0 + i * celda + 9, p.y - 22, celda - 18, celda - 18, { stroke: solido(c.acento), strokeWidth: 4 }), type: "ellipse" });
        p.agregar({ ...base(`Día ${d}`, x0 + i * celda, p.y, celda, 60, { fill: solido(c.tinta) }), type: "text", text: String(d), fontFamily: letraX, fontSize: 44, lineHeight: 1.2, fontWeight: d === f.dia ? "700" : "normal", textAlign: "center" });
      });
      p.espacio(celda - 18);
    }
    p.espacio(40);
    p.texto("Fecha", t("fecha"), { clave: "fecha", tamano: 54, peso: "600", margen: 16 });
    p.texto("Hora", t("hora"), { clave: "hora", tamano: 46 });
  });

  // 4. Cuenta atrás (en una imagen no corre: se dejan los días que faltan hoy).
  if (!ocultas.has("cuenta")) pagina("Cuenta atrás", "cuenta", true, (p) => {
    const dias = Math.max(0, Math.ceil((instanteUTC(inv.fecha, inv.hora, inv.zona) - ahora) / 86_400_000));
    p.texto("Faltan", t("faltan"), { clave: "faltan", tamano: 110, letra: letraT, interlineado: 1.1, margen: 40 });
    p.texto("Días que faltan", String(dias), { tamano: 220, letra: letraT, interlineado: 1, margen: 0 });
    p.texto("Días", dias === 1 ? "día" : "días", { tamano: 44, mayus: true });
  });

  // 5. Lugar.
  if (!ocultas.has("lugar")) pagina("Ubicación", "lugar", true, (p) => {
    p.texto("Título de ubicación", t("ubicacion"), { clave: "ubicacion", tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Lugar", t("lugar"), { clave: "lugar", tamano: 50, mayus: true, margen: 20 });
    if (bases.direccion) p.texto("Dirección", t("direccion"), { clave: "direccion", tamano: 44, interlineado: 1.4, margen: 60 });
    boton(p, "Cómo llegar", t("btn-mapa"), "btn-mapa");
  });

  // 6. Código de vestimenta.
  if (bases.dress && !ocultas.has("dress")) pagina("Código de vestimenta", "dress", true, (p) => {
    p.texto("Título de vestimenta", t("dress"), { clave: "dress", tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    if (bases["dress-estilo"]) p.texto("Estilo", t("dress-estilo"), { clave: "dress-estilo", tamano: 50, mayus: true });
    const cols = inv.dressCode.colores;
    if (cols.length) {
      const d = 130;
      const x0 = (ANCHO - (cols.length * d + (cols.length - 1) * 40)) / 2;
      cols.forEach((col, i) => p.agregar({ ...base(`Color ${i + 1}`, x0 + i * (d + 40), p.y, d, d, { fill: solido(col), stroke: solido(c.tinta), strokeWidth: 3 }), type: "ellipse" }));
      p.espacio(d + 50);
    }
    if (bases["dress-evitar"]) p.texto("Evitar", t("dress-evitar"), { clave: "dress-evitar", tamano: 42, interlineado: 1.4 });
  });

  // 7. Confirmación: botón de WhatsApp y el QR de la invitación (si ya está publicada).
  if (!ocultas.has("rsvp")) pagina("Confirmación", "rsvp", true, (p) => {
    p.texto("Título de confirmación", t("rsvp"), { clave: "rsvp", tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    if (bases["rsvp-limite"]) p.texto("Fecha límite", t("rsvp-limite"), { clave: "rsvp-limite", tamano: 42, margen: 16 });
    if (bases["rsvp-pases"]) p.texto("Pases", t("rsvp-pases"), { clave: "rsvp-pases", tamano: 42, margen: 40 });
    p.texto("Número de WhatsApp", `WhatsApp: +${inv.whatsapp}`, { tamano: 42, margen: 50 });
    boton(p, "WhatsApp", t("btn-wa"), "btn-wa");
    if (r.qrB64) {
      p.agregar({ ...base("QR de la invitación", (ANCHO - 420) / 2, p.y, 420, 420), type: "image", src: `data:image/png;base64,${r.qrB64}`, cornerRadius: 16 });
      p.espacio(450);
      p.texto("Texto del QR", "Escanéalo para abrir la invitación", { tamano: 36 });
    }
  });

  // 8. Regalos y hashtag.
  if (bases.regalos && !ocultas.has("regalos")) pagina("Regalos", "regalos", true, (p) => {
    p.texto("Título de regalos", t("regalos"), { clave: "regalos", tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Regalos", t("regalos-texto"), { clave: "regalos-texto", tamano: 46, interlineado: 1.5 });
  });
  if (inv.hashtag && !ocultas.has("comparte")) pagina("Hashtag", "comparte", true, (p) => {
    p.texto("Comparte", t("comparte"), { clave: "comparte", tamano: 110, letra: letraT, interlineado: 1.1, margen: 40 });
    p.texto("Hashtag", `#${inv.hashtag!.replace(/^#/, "")}`, { tamano: 64, peso: "600" });
  });

  // 9. Cierre.
  pagina("Cierre", "cierre", false, (p) => {
    p.texto("Nombres al final", t("pie-nombres"), { clave: "pie-nombres", tamano: 140, letra: letraT, interlineado: 1.05, margen: 40 });
    p.texto("Fecha al final", t("pie-fecha"), { clave: "pie-fecha", tamano: 44, mayus: true });
  });

  return { v: 2, artboard: { width: ANCHO, height: ALTO }, bg: solido(c.fondo), activePageId: paginas[0]!.id, pages: paginas };
}

/** Nombre del archivo: «XV años de Mariangel.workspace.avnac» (sin caracteres que Windows no acepta). */
export function nombreArchivoAvnac(inv: Invitacion): string {
  const limpio = `${TIPOS_INFO[inv.tipo].nombre} de ${inv.nombres}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${limpio || "Invitación"}.workspace.avnac`;
}

// ── De vuelta: lo que se cambió en Avnac pasa a la página interactiva ───────────────────────────────

export interface PiezaLeida {
  id: string;
  nombre: string;
  tipo: string;
  visible: boolean;
  texto?: string;
  letra?: string;
  color?: string;
  borde?: string;
  src?: string;
}
export interface PaginaLeida {
  nombre: string;
  fondo?: string;
  piezas: PiezaLeida[];
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cadena = (v: unknown) => (typeof v === "string" ? v : undefined);
/** Color de una pintura de Avnac ({ type: "solid", color }) o de Fabric (una cadena). */
const colorDe = (v: unknown) => cadena(objeto(v)?.color) ?? cadena(v);

/** Pieza del formato que guarda Avnac (v1, con forma de Fabric) o del v2; los grupos se aplanan. */
function piezasDe(lista: unknown, fuera: PiezaLeida[] = []): PiezaLeida[] {
  if (!Array.isArray(lista)) return fuera;
  for (const v of lista) {
    const o = objeto(v);
    if (!o) continue;
    if (o.type === "group" && Array.isArray(o.objects)) {
      piezasDe(o.objects, fuera);
      continue;
    }
    fuera.push({
      id: cadena(o.avnacLayerId) ?? cadena(o.id) ?? "",
      nombre: cadena(o.avnacLayerName) ?? cadena(o.name) ?? "",
      tipo: cadena(o.type) ?? "",
      visible: o.visible !== false,
      texto: cadena(o.text),
      letra: cadena(o.fontFamily),
      color: colorDe(o.avnacFill) ?? colorDe(o.fill),
      borde: colorDe(o.avnacStroke) ?? colorDe(o.stroke),
      src: cadena(o.src),
    });
  }
  return fuera;
}

/**
 * Lee un diseño de Avnac: lo que guarda en su carpeta (pages.json: `avnac-multi-page-document`), lo que
 * exporta (.workspace.avnac / .page.avnac, v1) o el v2 que arma Geeper. Null si no se reconoce.
 */
export function leerDisenoAvnac(raw: unknown): PaginaLeida[] | null {
  const d = objeto(raw);
  if (!d) return null;
  const v1 = (p: unknown, nombre: string): PaginaLeida | null => {
    const o = objeto(p);
    const fabric = objeto(o?.fabric);
    return o && fabric ? { nombre, fondo: colorDe(o.bg), piezas: piezasDe(fabric.objects) } : null;
  };
  if (d.kind === "avnac-multi-page-document" && Array.isArray(d.pages)) {
    const nombres = Array.isArray(d.pageNames) ? d.pageNames : [];
    return d.pages.map((p, i) => v1(p, cadena(nombres[i]) ?? "")).filter((p): p is PaginaLeida => !!p);
  }
  if (d.v === 1) {
    const p = v1(d, "");
    return p ? [p] : null;
  }
  if (d.v === 2) {
    if (Array.isArray(d.pages)) return d.pages.map((p) => objeto(p)).filter((p): p is Record<string, unknown> => !!p).map((p) => ({ nombre: cadena(p.name) ?? "", fondo: colorDe(p.bg) ?? colorDe(d.bg), piezas: piezasDe(p.objects) }));
    if (Array.isArray(d.objects)) return [{ nombre: "", fondo: colorDe(d.bg), piezas: piezasDe(d.objects) }];
  }
  return null;
}

/** «#a1b2c3», «#abc» o «rgb(…)» → «#a1b2c3»; lo demás (degradados, transparente) no se usa. */
export function hexDe(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join("")}`;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (!m || (m[4] !== undefined && Number(m[4]) < 0.99)) return undefined;
  return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
}

/** Las partes que se pueden ocultar y su página en el diseño (el resto: portada y cierre, siempre van). */
const PARTES = ["mensaje", "fecha", "cuenta", "lugar", "dress", "rsvp", "regalos", "comparte"] as const;

/** Nombre de la pieza → clave del texto, por si Avnac cambió los id (se reconoce por el nombre de la capa). */
const CLAVE_POR_NOMBRE: Record<string, string> = {
  "Título": "pre", Nombres: "nombres", Pista: "pista", "Texto del sobre": "carta", Saludo: "saludo", Mensaje: "mensaje", Firma: "firma",
  Fecha: "fecha", Hora: "hora", Faltan: "faltan", "Título de ubicación": "ubicacion", Lugar: "lugar", "Dirección": "direccion",
  "Texto del botón Cómo llegar": "btn-mapa", "Título de vestimenta": "dress", Estilo: "dress-estilo", Evitar: "dress-evitar",
  "Título de confirmación": "rsvp", "Fecha límite": "rsvp-limite", Pases: "rsvp-pases", "Texto del botón WhatsApp": "btn-wa",
  "Título de regalos": "regalos", Regalos: "regalos-texto", Comparte: "comparte", "Nombres al final": "pie-nombres", "Fecha al final": "pie-fecha",
};

export interface CambiosAvnac {
  /** clave → texto nuevo (para `guardarCambiosMano`). */
  textos: Record<string, string>;
  /** Partes que se borraron en Avnac (se ocultan en la página). */
  ocultas: string[];
  colores: Partial<Record<"fondo" | "tarjeta" | "tinta" | "claro" | "acento" | "sobre" | "sello", string>>;
  letras: { titulos?: string; texto?: string };
  /** La foto del sobre nueva (data URI), si se cambió. */
  foto?: string;
  avisos: string[];
}

/**
 * Qué cambió en Avnac respecto de la invitación: textos (por su clave), partes borradas, colores, letras y la
 * foto. Las posiciones y tamaños no pasan: la página interactiva se acomoda sola a cada teléfono.
 */
export function cambiosDesdeAvnac(inv: Invitacion, paginas: PaginaLeida[], fotoActualB64?: string): CambiosAvnac {
  const e = estiloDe(inv);
  const bases = basesDe(inv);
  const { vigentes } = retoquesVigentes(inv);
  const actual = (k: string) => vigentes[k]?.texto ?? bases[k] ?? "";
  const piezas = paginas.flatMap((p) => p.piezas.map((x) => ({ ...x, pagina: p })));
  const porId = (re: RegExp) => piezas.find((x) => re.test(x.id));
  const conIds = piezas.some((x) => /^[a-z]+--/.test(x.id));
  const r: CambiosAvnac = { textos: {}, ocultas: [], colores: {}, letras: {}, avisos: [] };
  if (!conIds) r.avisos.push("Este diseño no tiene las marcas de Geeper (¿se armó desde cero?): sólo se reconocen los textos por el nombre de su capa.");

  // Textos.
  for (const x of piezas) {
    if (x.tipo !== "textbox" && x.tipo !== "text") continue;
    const clave = /--ed-([a-z][a-z0-9-]*)$/.exec(x.id)?.[1] ?? (conIds ? undefined : CLAVE_POR_NOMBRE[x.nombre]);
    if (!clave || bases[clave] === undefined || x.texto === undefined || !x.visible) continue;
    const nuevo = x.texto.replace(/\r\n?/g, "\n").trim();
    const antes = actual(clave);
    // En el diseño algunos van en mayúsculas (la página también los muestra así): eso no es un cambio.
    if (nuevo === antes || nuevo === antes.toUpperCase()) continue;
    r.textos[clave] = nuevo.toUpperCase() === bases[clave]!.toUpperCase() ? bases[clave]! : nuevo;
  }

  // Partes borradas: no queda ninguna pieza visible de esa parte.
  if (conIds) {
    // Las partes que tenía el diseño que armó Geeper (sin las ya ocultas).
    const tenia = new Set(disenoAvnac(inv).pages.map((p) => p.id.replace(/^pagina-/, "")));
    for (const parte of PARTES) {
      if (tenia.has(parte) && !piezas.some((x) => x.id.startsWith(`${parte}--`) && x.visible)) r.ocultas.push(parte);
    }
  }

  // Colores (sólo los que cambiaron y son un color liso).
  const c = e.colores;
  const portada = paginas.find((p) => p.piezas.some((x) => x.id.startsWith("portada--")));
  const nuevos: CambiosAvnac["colores"] = {
    fondo: hexDe(portada?.fondo),
    tarjeta: hexDe(porId(/--tarjeta-\d+$/)?.color),
    tinta: hexDe(porId(/^mensaje--ed-saludo$/)?.color ?? porId(/--ed-rsvp$/)?.color),
    claro: hexDe(porId(/^portada--ed-nombres$/)?.color),
    acento: hexDe(porId(/--marca-del-dia-\d+$/)?.borde),
    sobre: hexDe(porId(/^portada--sobre-\d+$/)?.color),
    sello: hexDe(porId(/^portada--sello-\d+$/)?.color),
  };
  for (const [k, v] of Object.entries(nuevos) as [keyof CambiosAvnac["colores"], string | undefined][]) if (v && v !== c[k].toLowerCase()) r.colores[k] = v;

  // Letras: la de los nombres (títulos) y la del mensaje (texto), si son de las que la página puede llevar.
  const lt = porId(/^portada--ed-nombres$/)?.letra;
  const lx = porId(/^mensaje--ed-mensaje$/)?.letra;
  if (lt && lt !== e.letras.titulos) {
    if ((LETRAS_TITULOS as readonly string[]).includes(lt)) r.letras.titulos = lt;
    else r.avisos.push(`La letra «${lt}» de los títulos no pasa a la página (no está entre las que Geeper lleva adentro); se queda «${e.letras.titulos}».`);
  }
  if (lx && lx !== e.letras.texto) {
    if ((LETRAS_TEXTO as readonly string[]).includes(lx)) r.letras.texto = lx;
    else r.avisos.push(`La letra «${lx}» del texto no pasa a la página; se queda «${e.letras.texto}».`);
  }

  // Foto del sobre: si se cambió por otra imagen (Avnac la guarda dentro del diseño).
  const foto = porId(/^portada--foto-del-sobre-\d+$/)?.src;
  if (foto && /^data:image\/(png|jpe?g|webp);base64,/.test(foto) && (!fotoActualB64 || !foto.endsWith(fotoActualB64))) r.foto = foto;

  return r;
}
