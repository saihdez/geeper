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
  const id = (p: string) => `${p}-${++n}`;
  const base = (nombre: string, x: number, y: number, w: number, h: number, extra: Partial<Base> = {}): Base => ({
    id: id(nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")), name: nombre, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h),
    rotation: 0, opacity: 1, visible: true, fill: NADA, stroke: NADA, strokeWidth: 0, ...extra,
  });

  /** Arma una página: fondo, tarjeta (opcional) y lo que se le agregue, de arriba abajo. */
  function pagina(nombre: string, tarjeta: boolean, armar: (p: { y: number; texto: typeof texto; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }) => void) {
    const objetos: ObjetoAvnac[] = [];
    const X = 90;
    const W = ANCHO - 2 * X;
    const ctx = { y: tarjeta ? 330 : 260 };
    function texto(nombreT: string, contenido: string, o: { tamano: number; letra?: string; color?: string; peso?: string; interlineado?: number; mayus?: boolean; margen?: number }) {
      const ancho = W - 2 * 70;
      const valor = o.mayus ? contenido.toUpperCase() : contenido;
      const inter = o.interlineado ?? 1.25;
      const letra = o.letra ?? letraX;
      const porLetra = anchoLetra(letra, o.mayus);
      const tamano = tamanoQueCabe(valor, o.tamano, ancho, porLetra);
      const h = altoTexto(valor, tamano, ancho, inter, porLetra);
      objetos.push({ ...base(nombreT, X + 70, ctx.y, ancho, h, { fill: solido(o.color ?? (tarjeta ? c.tinta : c.claro)) }), type: "text", text: valor, fontFamily: letra, fontSize: tamano, lineHeight: inter, fontWeight: o.peso ?? "normal", textAlign: "center" });
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
    paginas.push({ id: `pagina-${paginas.length + 1}`, name: nombre, bg: solido(c.fondo), objects: [...fondo, ...objetos] });
  }
  const divisor = (p: { y: number; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }) => {
    p.agregar({ ...base("Adorno", (ANCHO - 360) / 2, p.y, 360, 43), type: "image", src: svgDato(divisorSvg) });
    p.espacio(80);
  };
  const boton = (p: { y: number; agregar: (o: ObjetoAvnac) => void; espacio: (h: number) => void }, nombre: string, etiqueta: string) => {
    const w = 640;
    const x = (ANCHO - w) / 2;
    p.agregar({ ...base(`Botón ${nombre}`, x, p.y, w, 120, { fill: solido(c.tinta) }), type: "rect", cornerRadius: 60 });
    p.agregar({ ...base(`Texto del botón ${nombre}`, x, p.y + 32, w, 60, { fill: solido(c.tarjeta) }), type: "text", text: etiqueta, fontFamily: letraX, fontSize: 44, lineHeight: 1.2, fontWeight: "600", textAlign: "center" });
    p.espacio(170);
  };

  // 1. Portada: adornos en las esquinas, títulos, el sobre (o la foto) y la pista.
  pagina("Portada", false, (p) => {
    if (e.adorno !== "clasico") {
      const s = SIMBOLOS[e.adorno];
      const racimo = svgDato(svgAdorno(`<g transform="translate(6 10) scale(2.2) rotate(-12 12 12)">${s}</g><g transform="translate(62 4) scale(1.3) rotate(18 12 12)">${s}</g><g transform="translate(18 66) scale(1.1) rotate(30 12 12)">${s}</g>`, "0 0 120 120", c.acento));
      p.agregar({ ...base("Adorno de esquina", 20, 40, 300, 300, { opacity: 0.6 }), type: "image", src: racimo });
      p.agregar({ ...base("Adorno de esquina", ANCHO - 320, ALTO - 360, 300, 300, { opacity: 0.6, rotation: 180 }), type: "image", src: racimo });
    }
    p.espacio(60);
    p.texto("Título", t("pre"), { tamano: 40, mayus: true, margen: 40 });
    p.texto("Nombres", t("nombres"), { tamano: 150, letra: letraT, interlineado: 1.05, margen: 80 });
    const w = 820;
    const h = Math.round(w * 2 / 3);
    const x = (ANCHO - w) / 2;
    if (r.fotoB64) {
      p.agregar({ ...base("Foto del sobre", x, p.y, w, h), type: "image", src: `data:image/webp;base64,${r.fotoB64}`, cornerRadius: 24 });
    } else {
      p.agregar({ ...base("Sobre", x, p.y, w, h, { fill: solido(c.sobre) }), type: "rect", cornerRadius: 20 });
      p.agregar({ ...base("Tarjeta del sobre", x + 50, p.y + 40, w - 100, h - 80, { fill: solido(c.tarjeta) }), type: "rect", cornerRadius: 14 });
      p.agregar({ ...base("Texto del sobre", x + 50, p.y + 120, w - 100, 50, { fill: solido(c.tinta) }), type: "text", text: (bases.carta ? t("carta") : "").toUpperCase(), fontFamily: letraX, fontSize: 34, lineHeight: 1.2, fontWeight: "normal", textAlign: "center" });
      p.agregar({ ...base("Sello", (ANCHO - 190) / 2, p.y + h - 150, 190, 190, { fill: solido(c.sello) }), type: "ellipse" });
      p.agregar({ ...base("Iniciales del sello", (ANCHO - 190) / 2, p.y + h - 100, 190, 90, { fill: solido(c.tarjeta) }), type: "text", text: iniciales(inv.nombres), fontFamily: letraT, fontSize: 64, lineHeight: 1.1, fontWeight: "normal", textAlign: "center" });
    }
    p.espacio(h + 120);
    p.texto("Pista", t("pista"), { tamano: 38 });
  });

  // 2. Mensaje.
  if (!ocultas.has("mensaje")) pagina("Mensaje", true, (p) => {
    p.texto("Saludo", t("saludo"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Mensaje", t("mensaje"), { tamano: 46, interlineado: 1.5, margen: 60 });
    p.texto("Firma", t("firma"), { tamano: 90, letra: letraT, interlineado: 1.1 });
  });

  // 3. Fecha: el mes con cada día suelto y el del evento marcado, fecha y hora.
  if (!ocultas.has("fecha")) pagina("Fecha", true, (p) => {
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
    p.texto("Fecha", t("fecha"), { tamano: 54, peso: "600", margen: 16 });
    p.texto("Hora", t("hora"), { tamano: 46 });
  });

  // 4. Cuenta atrás (en una imagen no corre: se dejan los días que faltan hoy).
  if (!ocultas.has("cuenta")) pagina("Cuenta atrás", true, (p) => {
    const dias = Math.max(0, Math.ceil((instanteUTC(inv.fecha, inv.hora, inv.zona) - ahora) / 86_400_000));
    p.texto("Faltan", t("faltan"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 40 });
    p.texto("Días que faltan", String(dias), { tamano: 220, letra: letraT, interlineado: 1, margen: 0 });
    p.texto("Días", dias === 1 ? "día" : "días", { tamano: 44, mayus: true });
  });

  // 5. Lugar.
  if (!ocultas.has("lugar")) pagina("Ubicación", true, (p) => {
    p.texto("Título de ubicación", t("ubicacion"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Lugar", t("lugar"), { tamano: 50, mayus: true, margen: 20 });
    if (bases.direccion) p.texto("Dirección", t("direccion"), { tamano: 44, interlineado: 1.4, margen: 60 });
    boton(p, "Cómo llegar", t("btn-mapa"));
  });

  // 6. Código de vestimenta.
  if (bases.dress && !ocultas.has("dress")) pagina("Código de vestimenta", true, (p) => {
    p.texto("Título de vestimenta", t("dress"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    if (bases["dress-estilo"]) p.texto("Estilo", t("dress-estilo"), { tamano: 50, mayus: true });
    const cols = inv.dressCode.colores;
    if (cols.length) {
      const d = 130;
      const x0 = (ANCHO - (cols.length * d + (cols.length - 1) * 40)) / 2;
      cols.forEach((col, i) => p.agregar({ ...base(`Color ${i + 1}`, x0 + i * (d + 40), p.y, d, d, { fill: solido(col), stroke: solido(c.tinta), strokeWidth: 3 }), type: "ellipse" }));
      p.espacio(d + 50);
    }
    if (bases["dress-evitar"]) p.texto("Evitar", t("dress-evitar"), { tamano: 42, interlineado: 1.4 });
  });

  // 7. Confirmación: botón de WhatsApp y el QR de la invitación (si ya está publicada).
  if (!ocultas.has("rsvp")) pagina("Confirmación", true, (p) => {
    p.texto("Título de confirmación", t("rsvp"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    if (bases["rsvp-limite"]) p.texto("Fecha límite", t("rsvp-limite"), { tamano: 42, margen: 16 });
    if (bases["rsvp-pases"]) p.texto("Pases", t("rsvp-pases"), { tamano: 42, margen: 40 });
    p.texto("Número de WhatsApp", `WhatsApp: +${inv.whatsapp}`, { tamano: 42, margen: 50 });
    boton(p, "WhatsApp", t("btn-wa"));
    if (r.qrB64) {
      p.agregar({ ...base("QR de la invitación", (ANCHO - 420) / 2, p.y, 420, 420), type: "image", src: `data:image/png;base64,${r.qrB64}`, cornerRadius: 16 });
      p.espacio(450);
      p.texto("Texto del QR", "Escanéalo para abrir la invitación", { tamano: 36 });
    }
  });

  // 8. Regalos y hashtag.
  if (bases.regalos && !ocultas.has("regalos")) pagina("Regalos", true, (p) => {
    p.texto("Título de regalos", t("regalos"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 20 });
    divisor(p);
    p.texto("Regalos", t("regalos-texto"), { tamano: 46, interlineado: 1.5 });
  });
  if (inv.hashtag && !ocultas.has("comparte")) pagina("Hashtag", true, (p) => {
    p.texto("Comparte", t("comparte"), { tamano: 110, letra: letraT, interlineado: 1.1, margen: 40 });
    p.texto("Hashtag", `#${inv.hashtag!.replace(/^#/, "")}`, { tamano: 64, peso: "600" });
  });

  // 9. Cierre.
  pagina("Cierre", false, (p) => {
    p.texto("Nombres al final", t("pie-nombres"), { tamano: 140, letra: letraT, interlineado: 1.05, margen: 40 });
    p.texto("Fecha al final", t("pie-fecha"), { tamano: 44, mayus: true });
  });

  return { v: 2, artboard: { width: ANCHO, height: ALTO }, bg: solido(c.fondo), activePageId: paginas[0]!.id, pages: paginas };
}

/** Nombre del archivo: «XV años de Mariangel.workspace.avnac» (sin caracteres que Windows no acepta). */
export function nombreArchivoAvnac(inv: Invitacion): string {
  const limpio = `${TIPOS_INFO[inv.tipo].nombre} de ${inv.nombres}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${limpio || "Invitación"}.workspace.avnac`;
}
