/**
 * Compilador geeper.json → proyecto Hyperframes (index.html + assets enlazados).
 *
 * Es `construir_html()` de mpt_acabado.py generalizado: marca arriba dentro de la banda segura,
 * golpe de zoom en cada corte, subtítulos karaoke con la palabra activa resaltada, tarjeta final; con
 * escenas editables, plantilla de datos, tres formatos y comprobación de zonas seguras. Desde v2:
 * transiciones entre escenas, movimiento de cámara, velocidad y color por clip, superposiciones de las
 * pistas libres, textos superpuestos y banda segura por plataforma.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ajusteDe, posicionCara, sigueCara } from "./caras";
import { bezier, CURVAS, cssFusion, easeDe, esMascara, filtroEfectos, mascaraTransicion, scriptEfectos, svgDefs, unirFiltro, type Efecto, type EncuadreGsap, type Grano } from "./efectos";
import { aplicarEstilo, pistasLibres, type Asset, type Clip, type Encuadre, type Proyecto, type Texto, type Transicion } from "./esquema";
import { ANCHO_CARACTER, caracteresPorLinea, dentro, metricas, PADDING_PASTILLA, type Caja, type Metricas } from "./formatos";
import { duracionEscenas, escenasEnLinea, intervalos, opcionesDe, todosLosGrupos, type EscenaEnLinea, type Grupo } from "./linea";
import { zonasDelVideo } from "./caras-zonas";
import { cajaMarco, estiloMarco } from "./marco";
import { resolverMarco, type Zona } from "./marco-auto";
import type { DatosPlantilla } from "./plantillas";
import { logoPermitido } from "./plantillas-rutas";
import { lineas, lineasDePalabras } from "./subtitulos";
import { textoSobre } from "./colores-marca";

export const VERSION_COMPILADOR = "compilador-hf-v3";

export interface CajaRevisada {
  nombre: string;
  caja: Caja;
  dentro: boolean;
}

export interface Compilado {
  html: string;
  total: number;
  inicioTarjeta: number;
  grupos: Grupo[];
  cajas: CajaRevisada[];
  /** Archivos que el proyecto Hyperframes necesita: ruta dentro de build → ruta absoluta de origen. */
  archivos: Record<string, string>;
  ancho: number;
  alto: number;
}

const e = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jsonScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const f3 = (n: number) => n.toFixed(3);

interface Pieza {
  id: string;
  src: string;
  inicio: number;
  dur: number;
  desde: number;
  clase: string;
  imagen: boolean;
  pista: number;
  estilo: string;
  velocidad?: number;
}

/** Animación que el script GSAP aplica a un elemento (todo en tiempo de la línea final). */
export interface Anim {
  id: string;
  t: number;
  dur: number;
  desde: Record<string, number>;
  hasta: Record<string, number>;
  ease?: string;
}


const ENCUADRE_BASE: Encuadre = { escala: 1, x: 0, y: 0 };
const mezclarEncuadre = (a: Encuadre, b: Encuadre, k: number): Record<string, number> => ({
  scale: a.escala + (b.escala - a.escala) * k,
  xPercent: (a.x + (b.x - a.x) * k) * 50,
  yPercent: (a.y + (b.y - a.y) * k) * 50,
});

/** Filtro CSS del ajuste de color (vacío si no hay). */
function filtroColor(c: Clip): string {
  if (!c.color) return "";
  const { brillo, contraste, saturacion } = c.color;
  if (brillo === 1 && contraste === 1 && saturacion === 1) return "";
  return `filter: brightness(${brillo}) contrast(${contraste}) saturate(${saturacion});`;
}

/** Animación de entrada de una transición sobre el elemento `id`, que empieza en `t`. */
function entrada(id: string, tipo: string, t: number, d: number, opacidad = 1): Anim | null {
  if (tipo === "fundido") return { id, t, dur: d, desde: { opacity: 0 }, hasta: { opacity: opacidad }, ease: "none" };
  if (tipo === "deslizar") return { id, t, dur: d, desde: { xPercent: 100 }, hasta: { xPercent: 0 }, ease: "power3.out" };
  if (tipo === "zoom") return { id, t, dur: d, desde: { scale: 1.3, opacity: 0 }, hasta: { scale: 1, opacity: opacidad }, ease: "power3.out" };
  return null;
}

const ESTILOS_TEXTO = { titulo: "texto-titulo", rotulo: "texto-rotulo", cita: "texto-cita" } as const;

function cuerpoTexto(t: Texto, m: Metricas): number {
  if (t.estilo === "titulo") return Math.round(m.tituloFs * 0.62);
  if (t.estilo === "cita") return Math.round(m.subsFs * 0.8);
  return Math.round(m.subsFs * 0.85);
}

/** Caja que ocupa un texto superpuesto (la misma que pinta el HTML y revisa el QC). */
export function cajaTexto(t: Texto, m: Metricas, altoMarca: number): Caja {
  const fs = cuerpoTexto(t, m);
  const maxW = m.segura.w - 40;
  const cpl = Math.max(4, Math.floor((maxW - 48) / (fs * ANCHO_CARACTER)));
  const ls = lineas(t.texto, cpl);
  const w = Math.min(maxW, Math.max(...ls.map((l) => l.length * fs * ANCHO_CARACTER)) + 48);
  const h = ls.length * fs * 1.15 + 32;
  const x = m.segura.x + (m.segura.w - w) / 2;
  const y =
    t.posicion === "arriba" ? m.marcaTop + altoMarca + 24
    : t.posicion === "abajo" ? m.subs.y - h - 20
    : m.segura.y + (m.segura.h - h) / 2;
  return { x, y, w, h };
}

/** Un tramo del visual de una escena: `t` relativo al inicio de la escena, `desde` sobre el asset. */
export interface SegmentoVisual {
  t: number;
  dur: number;
  desde: number;
}

/**
 * Qué partes del asset visual cubren la escena. Normal: corre seguido desde `rango.inicio` y, si es
 * más corto que la escena, vuelve a empezar. Con `sincro: "voz"`: un tramo por cada tramo que suena de
 * la voz, con el mismo desplazamiento sobre el asset (recortar palabras corta también la imagen).
 * `entrada` es el silencio inicial que cubre la primera escena (el visual empieza antes que la voz).
 */
export function segmentosVisuales(es: Pick<EscenaEnLinea, "duracion" | "visual" | "voz" | "tramos">, a: Asset, velocidad: number, entrada: number): SegmentoVisual[] {
  const v = es.visual;
  const imagen = a.tipo === "imagen";
  if (v.sincro === "voz" && !imagen) {
    const out = es.tramos.map((tr) => ({ t: tr.enEscena, dur: tr.fin - tr.inicio, desde: v.rango.inicio + (tr.inicio - es.voz.rango.inicio) }));
    const p = out[0];
    if (p && entrada > 0) {
      // La imagen de la entrada es la que precede a la voz en la misma grabación (si la hay). Si la
      // grabación tiene menos imagen antes de la voz que la entrada, lo que falta se cubre con el
      // comienzo de la grabación en un tramo aparte, para que la voz no se desincronice.
      const atras = Math.min(entrada, p.desde);
      p.t -= atras;
      p.dur += atras;
      p.desde -= atras;
      if (entrada - atras > 1e-3) out.unshift({ t: -entrada, dur: entrada - atras, desde: 0 });
    }
    return out;
  }
  const out: SegmentoVisual[] = [];
  let t = entrada > 0 ? -entrada : 0;
  let desde = v.rango.inicio;
  let k = 0;
  while (t < es.duracion - 1e-3 && k < 50) {
    const disponible = imagen || !a.duracion ? es.duracion - t : (a.duracion - desde) / velocidad;
    if (disponible < 0.05) {
      desde = 0;
      k++;
      continue;
    }
    const dur = Math.min(es.duracion - t, disponible);
    out.push({ t, dur, desde });
    t += dur;
    desde = 0;
    k++;
  }
  return out;
}

/**
 * `sustitutos`: id de asset → archivo que lo reemplaza al componer (p. ej. el clip con el look de color
 * del canal, src/lib/looks.ts). El geeper.json no cambia.
 */
export function compilar(original: Proyecto, plantilla: DatosPlantilla, rutaMezcla: string, dirProyecto: string, sustitutos: Record<string, string> = {}): Compilado {
  // El estilo del video se aplica a las escenas que no tienen el suyo.
  const p = aplicarEstilo(original);
  const m = metricas(p.formato, opcionesDe(p));
  const cplSubs = caracteresPorLinea(p.formato, opcionesDe(p));
  const { W, H } = m;
  const vertical = H > W;
  const escenas = escenasEnLinea(p);
  const inicioTarjeta = duracionEscenas(p);
  const total = inicioTarjeta + plantilla.tarjetaFinal.duracion;
  const grupos = todosLosGrupos(p);
  const archivos: Record<string, string> = { "assets/mezcla.wav": rutaMezcla };
  const anims: Anim[] = [];
  const enlazar = (a: Asset) => {
    const fuente = sustitutos[a.id] ?? path.join(dirProyecto, a.ruta);
    const nombre = `assets/${a.id}${path.extname(fuente)}`;
    archivos[nombre] = fuente;
    return nombre;
  };
  // Efectos por pieza: se convierten en filtros al final, con la duración ya definitiva.
  const efectosDe = new Map<Pieza, Efecto[]>();
  /** Entrada de una transición sobre una pieza: las de máscara también le agregan su CSS. */
  const entradaEn = (pz: Pieza, tr: Transicion, t0: number, d: number, enc: EncuadreGsap, opacidad = 1): Anim | null => {
    if (!esMascara(tr.tipo)) return entrada(pz.id, tr.tipo, t0, d, opacidad);
    const m = mascaraTransicion({ ...tr, tipo: tr.tipo }, W, H, enc);
    pz.estilo = `${pz.estilo} ${m.estilo}`.trim();
    return { id: pz.id, t: t0, dur: d, desde: m.desde, hasta: m.hasta, ease: m.ease };
  };
  /** Avance del movimiento de cámara con su curva (After Effects: Easy Ease y variantes). */
  const curvaDe = (c: Clip) => {
    const pc = CURVAS[c.movimiento?.curva ?? "lineal"];
    return pc ? bezier(pc[0], pc[1], pc[2], pc[3]) : (k: number) => k;
  };

  // ---- Visuales: un tramo por escena; si el clip es más corto que la escena, se repite.
  const piezas: Pieza[] = [];
  const cortes: { t: number; ids: string[] }[] = [];
  const ultimasDeEscena: Pieza[][] = [];
  for (const es of escenas) {
    const a = p.assets[es.visual.asset]!;
    const nombre = enlazar(a);
    const ajuste = ajusteDe(es.visual, a, W, H);
    const v = es.visual;
    const velocidad = v.velocidad ?? 1;
    const color = filtroColor(v);
    const ids: string[] = [];
    const imagen = a.tipo === "imagen";
    // Escenas pares e impares en carriles distintos: una transición las monta una sobre otra.
    const carril = es.indice % 2 === 0 ? 0 : 5;
    // La primera escena también cubre la entrada en silencio del principio.
    const entradaSilencio = es.indice === 0 ? es.inicio : 0;
    const largo = es.duracion + entradaSilencio;
    const propias: Pieza[] = [];
    for (const [k, seg] of segmentosVisuales(es, a, velocidad, entradaSilencio).entries()) {
      const { t, dur, desde } = seg;
      const base = `${es.escena.id}-${k}`;
      const sincro = v.sincro === "voz" && !imagen;
      const comun = { src: nombre, inicio: es.inicio + t, dur, desde, imagen, pista: carril, velocidad: imagen || sincro ? undefined : velocidad };
      if (ajuste === "contener") {
        piezas.push({ ...comun, id: `b-${base}`, clase: "fondo desenfoque", estilo: "" });
        const pz = { ...comun, id: `v-${base}`, clase: "fondo contener", estilo: color };
        piezas.push(pz);
        propias.push(pz);
        if (v.efectos?.length) efectosDe.set(pz, v.efectos);
      } else {
        const cara = sigueCara(v, a) ? posicionCara(a, W, H) : null;
        const pz = { ...comun, id: `v-${base}`, clase: cara ? "fondo" : `fondo ancla-${v.ancla ?? "centro"}`, estilo: `${cara ?? ""} ${color}`.trim() };
        piezas.push(pz);
        propias.push(pz);
        if (v.efectos?.length) efectosDe.set(pz, v.efectos);
      }
      if (k === 0) ids.push(`v-${base}`);
      // Movimiento de cámara: cada tramo recorre su parte del camino desde → hasta.
      if (v.movimiento) {
        const k0 = (t + entradaSilencio) / largo;
        const k1 = (t + dur + entradaSilencio) / largo;
        const d0 = { ...ENCUADRE_BASE, ...v.movimiento.desde };
        const d1 = { ...ENCUADRE_BASE, ...v.movimiento.hasta };
        // Un solo tramo: la curva entera como ease. Varios tramos: cada uno, lineal entre sus puntos de la curva.
        const entero = k0 < 1e-6 && k1 > 1 - 1e-6;
        const cv = curvaDe(v);
        anims.push({
          id: `v-${base}`, t: es.inicio + t, dur,
          desde: mezclarEncuadre(d0, d1, entero ? 0 : cv(k0)), hasta: mezclarEncuadre(d0, d1, entero ? 1 : cv(k1)),
          ease: entero ? easeDe(v.movimiento.curva) : "none",
        });
      }
    }
    ultimasDeEscena.push(piezas.filter((x) => Math.abs(x.inicio + x.dur - (es.inicio + es.duracion)) < 1e-3));
    const tr = v.transicion;
    if (es.indice > 0 && tr && tr.tipo !== "corte") {
      // La escena entra sobre la anterior: la anterior se alarga lo que dura la transición.
      const d = Math.min(tr.duracion, es.duracion);
      for (const u of ultimasDeEscena[es.indice - 1] ?? []) u.dur += d;
      const primera = propias[0];
      const enc = v.movimiento ? mezclarEncuadre({ ...ENCUADRE_BASE, ...v.movimiento.desde }, { ...ENCUADRE_BASE, ...v.movimiento.hasta }, 0) : {};
      const an = primera ? entradaEn(primera, tr, es.inicio, d, enc) : null;
      if (an) anims.push(an);
      const fondo = piezas.find((x) => x.id === `b-${es.escena.id}-0`);
      // El fondo desenfocado está escalado 1,15 por CSS (.fondo.desenfoque).
      const anFondo = fondo ? entradaEn(fondo, tr, es.inicio, d, { scale: 1.15 }) : null;
      if (anFondo) anims.push(anFondo);
    } else if (!v.movimiento && tr?.tipo !== "corte") {
      // Por defecto (plantilla): golpe de zoom en el corte.
      cortes.push({ t: es.inicio - entradaSilencio, ids });
    }
  }
  // La última escena se congela bajo la tarjeta final: se extiende el último tramo.
  const ultimas = piezas.filter((x) => Math.abs(x.inicio + x.dur - inicioTarjeta) < 1e-3);
  for (const u of ultimas) u.dur += plantilla.tarjetaFinal.duracion;

  // ---- Superposiciones (pistas libres de video): encima del fondo, debajo de marca y subtítulos.
  const superpuestas: Pieza[] = [];
  // Caras de las escenas, para la burbuja en «auto»: se calculan sólo si hay un clip con marco.
  let zonas: Zona[] | undefined;
  pistasLibres(p)
    .filter((x) => x.tipo === "video")
    .forEach((pi, n) => {
      pi.clips.forEach((c, j) => {
        const a = p.assets[c.asset]!;
        const ini = c.inicio ?? 0;
        if (ini >= total) return;
        const velocidad = c.velocidad ?? 1;
        const imagen = a.tipo === "imagen";
        const dur = Math.min(c.rango.duracion / velocidad, total - ini);
        // «auto»: la esquina que menos tapa las caras (marco-auto.ts), resuelta antes de mirar la forma.
        const marco = c.marco ? resolverMarco(c.marco, m, (zonas ??= zonasDelVideo(p, W, H))) : null;
        const caja = marco ? cajaMarco(marco, m) : null;
        const ajuste = caja ? "cubrir" : ajusteDe(c, a, W, H);
        const id = `s-${pi.id}-${j}`;
        const opacidad = c.opacidad ?? 1;
        // En la burbuja, la cara se busca dentro del recuadro; sin cara detectada, el tercio de arriba.
        const cara = caja ? (marco!.forma === "recorte" ? null : sigueCara(c, a) ? posicionCara(a, caja.w, caja.h) : "object-position: 50% 30%;") : ajuste === "cubrir" && sigueCara(c, a) ? posicionCara(a, W, H) : null;
        const sp: Pieza = {
          id, src: enlazar(a), inicio: ini, dur, desde: c.rango.inicio, imagen, pista: 6 + n,
          clase: `superpuesta ${caja ? "marco" : ajuste === "contener" ? "contener" : cara ? "" : `ancla-${c.ancla ?? "centro"}`}`.trim(),
          estilo: `z-index: ${20 + n}; opacity: ${opacidad}; ${caja ? estiloMarco(marco!, m) : ""} ${cara ?? ""} ${filtroColor(c)} ${cssFusion(c.fusion)}`.replace(/\s+/g, " ").trim(),
          velocidad: imagen ? undefined : velocidad,
        };
        superpuestas.push(sp);
        if (c.efectos?.length) efectosDe.set(sp, c.efectos);
        const d0 = { ...ENCUADRE_BASE, ...c.movimiento?.desde };
        const d1 = { ...ENCUADRE_BASE, ...c.movimiento?.hasta };
        if (c.movimiento) {
          anims.push({ id, t: ini, dur, desde: mezclarEncuadre(d0, d1, 0), hasta: mezclarEncuadre(d0, d1, 1), ease: easeDe(c.movimiento.curva) });
        }
        if (c.transicion && c.transicion.tipo !== "corte") {
          const an = entradaEn(sp, c.transicion, ini, Math.min(c.transicion.duracion, dur), c.movimiento ? mezclarEncuadre(d0, d1, 0) : {}, opacidad);
          if (an) anims.push(an);
        }
      });
    });

  const media = (x: Pieza) => {
    const vel = x.velocidad && x.velocidad !== 1 ? ` data-playback-rate="${x.velocidad}"` : "";
    const estilo = x.estilo ? ` style="${e(x.estilo)}"` : "";
    return x.imagen
      ? `      <img id="${x.id}" class="clip ${x.clase}" src="${e(x.src)}" data-start="${f3(x.inicio)}" data-duration="${f3(x.dur)}" data-track-index="${x.pista}"${estilo} alt="" />`
      : `      <video id="${x.id}" class="clip ${x.clase}" src="${e(x.src)}" data-start="${f3(x.inicio)}" data-duration="${f3(x.dur)}" data-media-start="${f3(x.desde)}" data-track-index="${x.pista}"${vel}${estilo} muted playsinline></video>`;
  };
  // ---- Efectos (filtros SVG de efectos.ts), ya con la duración final de cada pieza.
  const defsFx: string[] = [];
  const granos: Grano[] = [];
  for (const [pz, efs] of efectosDe) {
    const fx = filtroEfectos(pz.id, efs, W, H, { t: pz.inicio, dur: pz.dur });
    pz.estilo = unirFiltro(pz.estilo, fx);
    defsFx.push(fx.defs);
    granos.push(...fx.granos);
  }
  const videos = [svgDefs(defsFx), ...[...piezas, ...superpuestas].map(media)].filter(Boolean).join("\n");

  // ---- Subtítulos.
  const gruposHtml = grupos
    .map((g, gi) => {
      // Las líneas las decide `lineasDePalabras` (equilibradas), las mismas que mide el QC.
      let wi = 0;
      const filas = lineasDePalabras(g.fichas.map((f) => f.texto), cplSubs).map((linea) => {
        const spans = linea.map((texto) => `<span id="w${gi}-${wi++}" class="palabra">${e(texto)}</span>`).join(" ");
        return `<div class="linea">${spans}</div>`;
      });
      return `        <div id="g${gi}" class="grupo"><div class="pastilla">${filas.join("")}</div></div>`;
    })
    .join("\n");
  const iv = intervalos(grupos, inicioTarjeta);
  const tiempos = grupos.map((g, gi) => ({
    id: `g${gi}`,
    ini: iv[gi]!.ini,
    fin: iv[gi]!.fin,
    words: g.fichas.map((f, wi) => ({ id: `w${gi}-${wi}`, start: f.inicio, end: f.fin })),
  }));

  // ---- Marca (logo opcional).
  let logoHtml = "";
  // Sólo un logo subido desde el editor (<datos>/plantillas/, imagen): otra ruta podría sacar cualquier
  // archivo de la PC por la vista previa (SEG-02). Si no vale, queda el texto de la marca.
  if (plantilla.marca.logo && logoPermitido(plantilla.marca.logo)) {
    const nombre = `assets/logo${path.extname(plantilla.marca.logo)}`;
    archivos[nombre] = plantilla.marca.logo;
    logoHtml = `<img class="logo" src="${e(nombre)}" alt="" />`;
  }

  // ---- Zonas seguras: cajas de cada elemento contra la banda segura del formato (o de la plataforma).
  const S = m.segura;
  const centroX = S.x + S.w / 2;
  const centroY = S.y + S.h / 2;
  const anchoTexto = (txt: string, fs: number) => txt.length * fs * ANCHO_CARACTER;
  const chipW = anchoTexto(plantilla.marca.texto, m.marcaFs) * 1.06 + 68 + (logoHtml ? m.marcaFs * 1.4 : 0);
  const chipH = m.marcaFs * 1.15 + 30;
  const tituloCpl = Math.max(4, Math.floor((S.w - 60) / (m.tituloFs * ANCHO_CARACTER)));
  const tituloLineas = lineas(plantilla.tarjetaFinal.titulo.toUpperCase(), tituloCpl);
  const tituloW = Math.min(S.w - 60, Math.max(...tituloLineas.map((l) => anchoTexto(l, m.tituloFs))));
  const ctaW = anchoTexto(p.cta ?? plantilla.cta, m.ctaFs) + 80;
  const cierreH = tituloLineas.length * m.tituloFs + 28 + m.ctaFs * 1.2 + 32;
  const cajasBase: { nombre: string; caja: Caja }[] = [
    ...(p.marca ? [{ nombre: "marca", caja: { x: centroX - chipW / 2, y: m.marcaTop, w: chipW, h: chipH } }] : []),
    { nombre: "subtítulos", caja: m.subs },
    { nombre: "tarjeta final: título", caja: { x: centroX - tituloW / 2, y: centroY - cierreH / 2, w: tituloW, h: tituloLineas.length * m.tituloFs } },
    { nombre: "tarjeta final: CTA", caja: { x: centroX - ctaW / 2, y: centroY + cierreH / 2 - (m.ctaFs * 1.2 + 32), w: ctaW, h: m.ctaFs * 1.2 + 32 } },
  ];

  // ---- Textos superpuestos (títulos, rótulos, citas).
  const textosHtml: string[] = [];
  for (const t of p.textos) {
    if (t.inicio >= inicioTarjeta) continue;
    const dur = Math.min(t.duracion, inicioTarjeta - t.inicio);
    const caja = cajaTexto(t, m, p.marca ? chipH : 0);
    const fs = cuerpoTexto(t, m);
    cajasBase.push({ nombre: `texto «${t.texto.slice(0, 24)}»`, caja });
    const id = `t-${t.id}`;
    textosHtml.push(
      `      <div id="${id}" class="clip texto ${ESTILOS_TEXTO[t.estilo]}" data-start="${f3(t.inicio)}" data-duration="${f3(dur)}" data-track-index="7" ` +
        `style="left: ${f3(caja.x)}px; top: ${f3(caja.y)}px; width: ${f3(caja.w)}px; font-size: ${fs}px;">${e(t.texto)}</div>`,
    );
    anims.push({ id, t: t.inicio, dur: 0.35, desde: { opacity: 0, y: 24 }, hasta: { opacity: 1, y: 0 }, ease: "power3.out" });
    anims.push({ id, t: Math.max(t.inicio + 0.4, t.inicio + dur - 0.25), dur: 0.25, desde: { opacity: 1 }, hasta: { opacity: 0 }, ease: "power2.in" });
  }
  const cajas = cajasBase.map((c) => ({ ...c, dentro: dentro(c.caja, m.segura) }));

  const c = plantilla.colores;
  const t = plantilla.tipografia;
  const fuenteTitulos = `"${t.titulos}", "${t.texto}", sans-serif`;
  const fuenteTexto = `"${t.texto}", sans-serif`;
  const html = `<!doctype html>
<html lang="es" data-resolution="${vertical ? "portrait" : W === H ? "square" : "landscape"}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <!-- Generado por Geeper (${VERSION_COMPILADOR}) desde geeper.json: no editar a mano. -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {
        --tinta: ${c.tinta};
        --activa: ${c.activa};
        --acento1: ${c.acento1};
        --acento2: ${c.acento2};
        --fondo-pastilla: ${c.fondoPastilla};
        --fondo-cierre: ${c.fondoCierre};
        /* Letras sobre los acentos: la tinta si se lee (≥ 3:1); si no, casi negro o blanco. */
        --tinta-boton: ${textoSobre(c.acento1, c.tinta)};
        --tinta-titulo: ${textoSobre([c.acento1, c.acento2], c.tinta)};
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: ${fuenteTitulos}; }
      .fondo, .superpuesta { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1; }
      .fondo.contener, .superpuesta.contener { object-fit: contain; }
      .fondo.contener { z-index: 2; }
      .fondo.desenfoque { filter: blur(40px) brightness(0.55); transform: scale(1.15); z-index: 1; }
      .ancla-arriba { object-position: 50% 0%; }
      .ancla-abajo { object-position: 50% 100%; }
      #marca { position: absolute; top: ${m.marcaTop}px; left: ${S.x}px; width: ${S.w}px; z-index: 30; display: flex; justify-content: center; }
      #marca .chip { display: flex; align-items: center; gap: 14px; padding: 14px 34px 16px; border-radius: 999px;
                     background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.18); }
      #marca .logo { height: ${Math.round(m.marcaFs * 1.2)}px; width: auto; }
      #marca .txt { font-size: ${m.marcaFs}px; letter-spacing: 0.06em; text-transform: uppercase;
                    background: linear-gradient(90deg, var(--acento1), var(--acento2));
                    -webkit-background-clip: text; background-clip: text; color: transparent; }
      .texto { position: absolute; z-index: 35; text-align: center; text-wrap: balance; line-height: 1.15; padding: 16px 24px; border-radius: 18px; opacity: 0; }
      .texto-titulo { font-family: ${fuenteTitulos}; text-transform: uppercase; color: var(--tinta-titulo);
                      background: linear-gradient(90deg, var(--acento1), var(--acento2)); }
      .texto-rotulo { font-family: ${fuenteTitulos}; color: var(--tinta); background: var(--fondo-pastilla); }
      .texto-cita { font-family: ${fuenteTexto}; font-weight: ${t.pesoTexto}; font-style: italic; color: var(--tinta);
                    background: var(--fondo-pastilla); border-left: 8px solid var(--acento1); }
      #subtitulos { position: absolute; left: ${m.subs.x}px; top: ${m.subs.y}px; width: ${m.subs.w}px; height: ${m.subs.h}px; z-index: 40; overflow: visible; }
      .grupo { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; overflow: visible; }
      .pastilla { max-width: ${m.pastillaMax}px; padding: 18px ${PADDING_PASTILLA}px 22px; border-radius: 26px; background: var(--fondo-pastilla);
                  text-align: center; line-height: 1.12; display: flex; flex-direction: column; align-items: center; gap: 6px; overflow: visible; }
      .linea { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px ${Math.round(m.subsFs * 0.42)}px; }
      .palabra { display: inline-block; font-family: ${fuenteTitulos}; font-size: ${m.subsFs}px; color: var(--tinta); text-shadow: 0 4px 14px rgba(0,0,0,0.65); }
      #cierre { position: absolute; inset: 0; z-index: 60; background: var(--fondo-cierre); }
      #cierre .contenido { position: absolute; left: ${S.x}px; top: ${S.y}px; width: ${S.w}px; height: ${S.h}px;
                           display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
      #cierre .titulo { font-size: ${m.tituloFs}px; text-transform: uppercase; text-align: center; text-wrap: balance; line-height: 1.0; padding: 0 30px;
                        background: linear-gradient(90deg, var(--acento1), var(--acento2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
      #cierre .cta { font-family: ${fuenteTexto}; font-weight: ${t.pesoTexto}; font-size: ${m.ctaFs}px; color: var(--tinta-boton);
                     padding: 16px 40px; border-radius: 999px; background: var(--acento1); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${f3(total)}" data-width="${W}" data-height="${H}">
${videos}
${textosHtml.join("\n")}
      <audio id="mezcla" class="clip" src="assets/mezcla.wav" data-start="0" data-duration="${f3(total)}" data-track-index="1"></audio>
${p.marca ? `      <div id="marca" class="clip" data-start="0" data-duration="${f3(inicioTarjeta)}" data-track-index="2">
        <div class="chip">${logoHtml}<span class="txt">${e(plantilla.marca.texto)}</span></div>
      </div>
` : ""}      <div id="subtitulos" class="clip" data-start="0" data-duration="${f3(inicioTarjeta)}" data-track-index="3" data-track-kind="captions">
${gruposHtml}
      </div>
      <div id="cierre" class="clip" data-start="${f3(inicioTarjeta)}" data-duration="${f3(total - inicioTarjeta)}" data-track-index="4">
        <div class="contenido">
          <div class="titulo">${e(plantilla.tarjetaFinal.titulo)}</div>
          <div class="cta">${e(p.cta ?? plantilla.cta)}</div>
        </div>
      </div>
    </div>
    <script>
      const GRUPOS = ${jsonScript(tiempos)};
      const CORTES = ${jsonScript(cortes)};
      const ANIMS = ${jsonScript(anims)};
      const FIN_SUBS = ${f3(inicioTarjeta)};
      const ACTIVA = ${jsonScript(c.activa)};
      const TINTA = ${jsonScript(c.tinta)};
      const tl = gsap.timeline({ paused: true });
      // Curvas de movimiento y grano por fotograma (efectos.ts).
      ${scriptEfectos(granos, p.fps)}
      // Golpe de zoom en cada corte de escena (las que no tienen transición ni movimiento propios).
      CORTES.forEach((c) => {
        c.ids.forEach((id) => tl.fromTo("#" + id, { scale: 1.07 }, { scale: 1, duration: 0.4, ease: "power3.out" }, c.t));
      });
      // Transiciones, movimiento de cámara y textos superpuestos (de geeper.json).
      ANIMS.forEach((a) => {
        tl.fromTo("#" + a.id, a.desde, Object.assign({}, a.hasta, { duration: a.dur, ease: a.ease || "none", immediateRender: false }), a.t);
      });
${p.marca ? `      tl.from("#marca .chip", { y: -30, opacity: 0, duration: 0.45, ease: "back.out(1.6)" }, 0.15);
` : ""}      // Karaoke: un grupo visible a la vez; la palabra que suena se enciende.
      GRUPOS.forEach((g) => {
        const ini = g.ini;
        const fin = g.fin;
        const el = "#" + g.id;
        tl.set(el, { visibility: "visible" }, ini);
        tl.fromTo(el, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.1, ease: "power2.out" }, ini);
        g.words.forEach((w) => {
          const s = Math.max(ini, w.start - 0.03);
          tl.to("#" + w.id, { color: ACTIVA, scale: 1.05, duration: 0.07, ease: "power2.out" }, s);
          tl.to("#" + w.id, { color: TINTA, scale: 1, duration: 0.08, ease: "power2.in" }, Math.max(s + 0.08, w.end));
        });
        tl.to(el, { opacity: 0, duration: 0.08, ease: "power2.in" }, Math.max(ini + 0.12, fin - 0.08));
        tl.set(el, { opacity: 0, visibility: "hidden" }, Math.max(ini + 0.2, fin));
      });
      tl.from("#cierre", { opacity: 0, duration: 0.3, ease: "power2.out" }, FIN_SUBS);
      tl.from("#cierre .titulo", { scale: 0.82, opacity: 0, duration: 0.45, ease: "back.out(1.8)" }, FIN_SUBS + 0.1);
      tl.from("#cierre .cta", { y: 40, opacity: 0, duration: 0.35, ease: "power3.out" }, FIN_SUBS + 0.35);
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  return { html, total, inicioTarjeta, grupos, cajas, archivos, ancho: W, alto: H };
}

/** Escribe el proyecto Hyperframes en `dirBuild` (enlaces duros a los assets: no ocupa espacio). */
export async function escribirProyectoHf(dirBuild: string, comp: Compilado): Promise<void> {
  await fs.rm(dirBuild, { recursive: true, force: true });
  await fs.mkdir(path.join(dirBuild, "assets"), { recursive: true });
  for (const [rel, abs] of Object.entries(comp.archivos)) {
    const destino = path.join(dirBuild, rel);
    try {
      await fs.link(abs, destino);
    } catch {
      await fs.copyFile(abs, destino);
    }
  }
  await fs.writeFile(path.join(dirBuild, "index.html"), comp.html);
  await fs.writeFile(
    path.join(dirBuild, "hyperframes.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
        media: { autoProxy: true },
      },
      null,
      2,
    ),
  );
}
