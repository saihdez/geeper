/**
 * Revisión de una campaña: cada chequeo termina en pass, fail, unknown o not_applicable con su
 * evidencia (contrato de claude-ads). «unknown» es una respuesta válida: falta el dato, y no se adivina.
 * Es una función pura: recibe los datos de la campaña y lo que se sabe de cada proyecto vinculado.
 */
import type { Formato, Plataforma } from "../esquema";
import { CATEGORIAS_SENSIBLES, ubicacion, type Ubicacion } from "./catalogo";
import type { Concepto, DatosCampana, ResultadoChequeo } from "./esquema";

export interface ReglaQcV {
  id: string;
  nombre: string;
  ok: boolean;
  aviso?: boolean;
  detalle?: string;
}

/** Lo que la revisión necesita saber del proyecto de Geeper vinculado a un concepto. */
export interface InfoProyecto {
  id: string;
  slug: string;
  nombre: string;
  formato: Formato;
  estado: string;
  versionActual: number;
  plataformas: Plataforma[];
  comercial: boolean;
  /** Descripción de los assets generados por IA (imágenes de MPT, voz TTS, planos Wan). */
  sinteticos: string[];
  textosEnPantalla: string[];
  ctaPlantilla: string;
  /** Último render de la versión actual. */
  render: { estado: string; duracion: number | null; reglas: ReglaQcV[] } | null;
  /** Hay un trabajo de generación o render en curso. */
  ocupado: boolean;
}

export interface Chequeo {
  id: string;
  nombre: string;
  estado: ResultadoChequeo;
  evidencia: string;
  /** Qué hacer para pasarlo. */
  accion?: string;
  /** Clave en DatosCampana.manuales si lo marca la persona. */
  clave?: string;
  fuente?: string;
  /** Acción que Geeper puede hacer sola. */
  arreglo?: "preparar" | `formato:${Formato}`;
  fecha?: string;
}

export interface RevisionUbicacion {
  ubicacion: Ubicacion;
  chequeos: Chequeo[];
}

export interface RevisionConcepto {
  conceptoId: string;
  nombre: string;
  proyecto: InfoProyecto | null;
  copy: Chequeo[];
  video: Chequeo[];
  ubicaciones: RevisionUbicacion[];
  resumen: Resumen;
}

export type Resumen = Record<ResultadoChequeo, number>;

export interface Revision {
  conceptos: RevisionConcepto[];
  resumen: Resumen;
}

const vacio = (): Resumen => ({ pass: 0, fail: 0, unknown: 0, not_applicable: 0 });

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
}

/**
 * Frases que suelen ser afirmaciones verificables o presión: cifras, superlativos, garantías,
 * gratuidad, urgencia. Es una heurística para pedir prueba, no un juicio de política.
 */
const PATRON_AFIRMACION =
  /\d|garantiz|gratis|gratuit|\bel mejor\b|\bla mejor\b|\blos mejores\b|\bnumero uno\b|\bn[ºo°] ?1\b|#1|\bunic[oa]\b|\bcura\b|\bsin riesgo\b|\bpara siempre\b|comprobad|clinicamente|cientificamente|aprobado por|\bsolo hoy\b|\bultimas? unidades\b|\bultima oportunidad\b|\bse acaba\b|\bresultados? en\b/;

export function frasesConAfirmacion(texto: string): string[] {
  const frases = texto
    .split(/(?<=[.!?¡¿\n])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
  return frases.filter((f) => PATRON_AFIRMACION.test(normalizar(f)));
}

/**
 * ¿La frase está respaldada por una afirmación aprobada? La frase es un trozo de la afirmación, o
 * comparten ≥ 60 % de las palabras de la afirmación y ≥ 50 % de las de la frase (así «Envío gratis»
 * no respalda «Gratis para siempre y garantizado»).
 */
export function respaldada(frase: string, aprobadas: string[]): boolean {
  const palabras = (s: string) => new Set(s.split(" ").filter((w) => w.length > 2 || /\d/.test(w)));
  const f = normalizar(frase);
  const pf = palabras(f);
  return aprobadas.some((a) => {
    const n = normalizar(a);
    if (!n || !f) return false;
    if (n.includes(f)) return true;
    const pa = palabras(n);
    if (!pa.size || !pf.size) return false;
    const comunes = [...pa].filter((w) => pf.has(w)).length;
    return comunes / pa.size >= 0.6 && comunes / pf.size >= 0.5;
  });
}

function seg(s: number | null): string {
  return s == null ? "—" : `${s.toFixed(1)} s`;
}

function conManual(datos: DatosCampana, c: Chequeo): Chequeo {
  if (!c.clave) return c;
  const m = datos.manuales[c.clave];
  if (!m) return c;
  const evidencia = [m.evidencia, c.evidencia].filter(Boolean).join(" · ");
  return { ...c, estado: m.estado, evidencia, fecha: m.fecha || undefined };
}

function chequeosCopy(datos: DatosCampana, c: Concepto, proyecto: InfoProyecto | null): Chequeo[] {
  const out: Chequeo[] = [];
  const otros = datos.conceptos.filter((o) => o.id !== c.id);

  // 1. Materialmente distinto: redimensionar o reescribir lo mismo no es un concepto nuevo.
  const g = normalizar(c.gancho);
  const mismoGancho = g ? otros.filter((o) => normalizar(o.gancho) === g) : [];
  const mismoVideo = c.proyectoId ? otros.filter((o) => o.proyectoId === c.proyectoId) : [];
  if (!g) out.push({ id: "distinto", nombre: "Idea distinta de las demás", estado: "unknown", evidencia: "Falta cómo empieza.", accion: "Escribe cómo empieza el video (el gancho)." });
  else if (mismoGancho.length || mismoVideo.length) {
    const quienes = [...new Set([...mismoGancho, ...mismoVideo].map((o) => `«${o.nombre}»`))].join(", ");
    out.push({
      id: "distinto", nombre: "Concepto distinto de los demás", estado: "fail",
      evidencia: `${mismoGancho.length ? "Mismo gancho" : "Mismo video"} que ${quienes}.`,
      accion: "Cambia la idea de verdad (otro comienzo, otro mensaje), no sólo unas palabras o la forma del video.",
    });
  } else out.push({ id: "distinto", nombre: "Concepto distinto de los demás", estado: "pass", evidencia: "Tiene su propio comienzo y su propio video." });

  // 2. CTA: el que se dice y el botón de la red.
  const cta = normalizar(c.cta);
  const boton = `Botón del anuncio: «${datos.brief.botonCta}».`;
  if (!cta) out.push({ id: "cta", nombre: "Pide algo al final", estado: "fail", evidencia: boton, accion: "Escribe qué le pides a la persona al final (ej.: «pide tu bolsa»)." });
  else if (!c.guion.trim()) out.push({ id: "cta", nombre: "Llamado a la acción", estado: "unknown", evidencia: `Pide: «${c.cta}». Aún no hay guion. ${boton}` });
  else if (normalizar(c.guion).includes(cta)) out.push({ id: "cta", nombre: "Llamado a la acción", estado: "pass", evidencia: `El guion dice «${c.cta}». ${boton}` });
  else {
    const tarjeta = proyecto?.ctaPlantilla ? ` El cartel final del video dice «${proyecto.ctaPlantilla}».` : "";
    out.push({ id: "cta", nombre: "Llamado a la acción", estado: "unknown", evidencia: `El guion no dice «${c.cta}».${tarjeta} ${boton}`, accion: "Agrega esa frase al final del guion, o confirma que el cartel final del video basta." });
  }

  // 3. Afirmaciones: toda cifra, garantía o urgencia necesita una prueba aprobada.
  const aprobadas = datos.brief.afirmaciones.filter((a) => a.aprobada).map((a) => a.texto);
  const texto = [c.gancho, c.promesa, c.guion, c.cta, ...(proyecto?.textosEnPantalla ?? [])].join("\n");
  const marcadas = [...new Set(frasesConAfirmacion(texto))];
  const sinRespaldo = marcadas.filter((f) => !respaldada(f, aprobadas));
  const nombre = "Datos con respaldo";
  if (!marcadas.length) out.push({ id: "afirmaciones", nombre, estado: "not_applicable", evidencia: "No se ven cifras, garantías ni urgencias en el texto (revisión automática: igual léelo)." });
  else if (!sinRespaldo.length) out.push({ id: "afirmaciones", nombre, estado: "pass", evidencia: `${marcadas.length} dato(s), todos aprobados en «Tu negocio».` });
  else
    out.push({
      id: "afirmaciones", nombre, estado: "unknown",
      evidencia: `Sin respaldo: ${sinRespaldo.slice(0, 4).map((f) => `«${f.slice(0, 90)}»`).join(" · ")}${sinRespaldo.length > 4 ? ` y ${sinRespaldo.length - 4} más` : ""}.`,
      accion: "Anota ese dato en «Tu negocio» con lo que lo demuestra y apruébalo, o quítalo del guion.",
    });

  // 4. Las pruebas que el concepto cita deben estar aprobadas.
  const citadas = c.pruebas.map((id) => datos.brief.afirmaciones.find((a) => a.id === id));
  const noAprobadas = citadas.filter((a) => a && !a.aprobada).map((a) => `«${a!.texto.slice(0, 60)}»`);
  const perdidas = citadas.filter((a) => !a).length;
  if (!c.pruebas.length) out.push({ id: "pruebas", nombre: "Datos aprobados", estado: "not_applicable", evidencia: "La idea no usa datos de «Tu negocio»." });
  else if (noAprobadas.length || perdidas)
    out.push({
      id: "pruebas", nombre: "Pruebas citadas aprobadas", estado: "fail",
      evidencia: [noAprobadas.length ? `Sin aprobar: ${noAprobadas.join(", ")}` : "", perdidas ? `${perdidas} ya no existe(n) en «Tu negocio»` : ""].filter(Boolean).join(". ") + ".",
      accion: "Apruébalos en «Tu negocio» (con lo que los demuestra) o quítalos de la idea.",
    });
  else out.push({ id: "pruebas", nombre: "Pruebas citadas aprobadas", estado: "pass", evidencia: `${c.pruebas.length} dato(s) aprobado(s).` });
  return out;
}

function chequeosVideo(datos: DatosCampana, c: Concepto, p: InfoProyecto | null): Chequeo[] {
  const clave = (id: string) => `${c.id}:video:${id}`;
  if (!p) {
    const sin = "Todavía no hay video.";
    return [
      { id: "vinculado", nombre: "Tiene video", estado: "fail", evidencia: sin, accion: "Haz el video con el guion de esta idea (o usa uno que ya tengas)." },
      { id: "qc", nombre: "Video revisado por Geeper", estado: "unknown", evidencia: sin },
      { id: "sonido", nombre: "Se entiende sin sonido", estado: "unknown", evidencia: sin },
      { id: "licencias", nombre: "Música e imágenes con permiso", estado: "unknown", evidencia: sin },
      conManual(datos, { id: "ia", nombre: "Aviso de contenido hecho con IA", estado: "unknown", evidencia: sin, clave: clave("ia") }),
    ];
  }
  const out: Chequeo[] = [];
  const r = p.render;
  const regla = (id: string) => r?.reglas.find((x) => x.id === id);
  out.push({ id: "vinculado", nombre: "Video del concepto", estado: "pass", evidencia: `Video «${p.nombre}» (${p.formato}, versión ${p.versionActual}).` });

  if (!r) out.push({ id: "qc", nombre: "Render con QC aprobado", estado: "unknown", evidencia: p.ocupado ? "Haciendo el video…" : "Falta producir la última versión del video.", accion: p.ocupado ? undefined : "Abre el video y toca «Renderizar»." });
  else if (r.estado === "aprobado") out.push({ id: "qc", nombre: "Render con QC aprobado", estado: "pass", evidencia: `Pasó el control de calidad (sonido, imagen, subtítulos) · ${seg(r.duracion)}.` });
  else if (r.estado === "rechazado") {
    const malas = r.reglas.filter((x) => !x.ok && !x.aviso).map((x) => x.nombre);
    out.push({ id: "qc", nombre: "Render con QC aprobado", estado: "fail", evidencia: `No pasó el control de calidad: ${malas.join(", ") || "ver el informe"}.`, accion: "Abre el video, corrige lo que marca y vuelve a producirlo." });
  } else out.push({ id: "qc", nombre: "Render con QC aprobado", estado: "unknown", evidencia: `El video está en estado «${r.estado}».` });

  const subs = regla("subtitulos");
  if (!subs) out.push({ id: "sonido", nombre: "Se entiende sin sonido (subtítulos)", estado: "unknown", evidencia: "Falta el control de los subtítulos." });
  else out.push({ id: "sonido", nombre: "Se entiende sin sonido (subtítulos)", estado: subs.ok ? "pass" : "fail", evidencia: subs.ok ? "Tiene subtítulos legibles: se entiende con el sonido apagado." : `Subtítulos: ${subs.detalle ?? "no pasan la regla de legibilidad"}.` });

  const lic = regla("licencias");
  if (!p.comercial)
    out.push({ id: "licencias", nombre: "Uso comercial y licencias", estado: "fail", evidencia: "El video no está marcado para uso comercial, así que Geeper no revisó si la música y las imágenes se pueden usar en anuncios.", accion: "Toca «Preparar para anuncio» y vuelve a producir el video.", arreglo: "preparar" });
  else if (!lic) out.push({ id: "licencias", nombre: "Uso comercial y licencias", estado: "unknown", evidencia: "Marcado para uso comercial; falta producir el video para revisarlo." });
  else out.push({ id: "licencias", nombre: "Uso comercial y licencias", estado: lic.ok ? "pass" : "fail", evidencia: lic.ok ? "La música y las imágenes se pueden usar en anuncios." : `Permisos: ${lic.detalle ?? "hay material sin permiso comercial"}.`, accion: lic.ok ? undefined : "Cambia ese material (por ejemplo la música) por otro con permiso claro." });

  if (p.sinteticos.length)
    out.push(conManual(datos, {
      id: "ia", nombre: "Contenido generado con IA declarado", estado: "unknown",
      evidencia: `Hecho con IA: ${p.sinteticos.join(", ")}.`,
      accion: "Al crear el anuncio, activa la casilla de «contenido hecho con IA» que pide cada plataforma, y márcalo aquí.",
      clave: clave("ia"),
    }));
  else out.push({ id: "ia", nombre: "Contenido generado con IA declarado", estado: "not_applicable", evidencia: "Todo el material es tuyo, no hecho con IA." });
  return out;
}

function chequeosUbicacion(datos: DatosCampana, c: Concepto, u: Ubicacion, p: InfoProyecto | null): Chequeo[] {
  const clave = (id: string) => `${c.id}:${u.id}:${id}`;
  const out: Chequeo[] = [];
  if (!p) out.push({ id: "formato", nombre: "Forma del video correcta", estado: "unknown", evidencia: `Este lugar usa video ${u.formato}; aún no hay video.` });
  else if (p.formato === u.formato) out.push({ id: "formato", nombre: "Formato nativo", estado: "pass", evidencia: `Video ${p.formato}.` });
  else out.push({ id: "formato", nombre: "Formato nativo", estado: "fail", evidencia: `El video es ${p.formato} y este lugar usa ${u.formato}.`, accion: `Pásalo a ${u.formato} (Geeper lo rehace en un minuto) o quita este lugar de la idea.`, arreglo: `formato:${u.formato}` });

  const zonas = p?.render?.reglas.find((x) => x.id === "zonas-seguras");
  if (!p) out.push({ id: "banda", nombre: "Textos visibles", estado: "unknown", evidencia: "Aún no hay video." });
  else if (u.plataforma && p.formato === "9:16") {
    if (!p.plataformas.includes(u.plataforma))
      out.push({ id: "banda", nombre: "Texto fuera de la interfaz", estado: "fail", evidencia: `Geeper todavía no revisó si los botones de ${u.red} tapan los textos.`, accion: "Toca «Preparar para anuncio» y vuelve a producir el video.", arreglo: "preparar" });
    else if (!zonas) out.push({ id: "banda", nombre: "Texto fuera de la interfaz", estado: "unknown", evidencia: `${u.red} agregado; falta producir el video para revisarlo.` });
    else out.push({ id: "banda", nombre: "Texto fuera de la interfaz", estado: zonas.ok ? "pass" : "fail", evidencia: zonas.ok ? `Los botones de ${u.red} no tapan textos ni logo.` : `Hay texto tapado: ${zonas.detalle ?? "ver el informe del video"}.` });
  } else {
    // Sin una banda medida para esta interfaz, el QC sólo dice que está dentro de la zona genérica.
    const gen = zonas ? (zonas.ok ? "Los textos están dentro del margen seguro general." : `Hay texto fuera del margen seguro: ${zonas.detalle ?? ""}.`) : "Falta producir el video.";
    out.push({ id: "banda", nombre: "Texto fuera de la interfaz", estado: zonas && !zonas.ok ? "fail" : "unknown", evidencia: `${gen} Geeper no conoce los botones de ${u.nombre}: míralo en la vista previa.` });
  }

  const medido = p ? `Tu video: ${p.formato}, ${seg(p.render?.duracion ?? null)}.` : "";
  out.push(conManual(datos, {
    id: "specs", nombre: "Requisitos técnicos de la plataforma", estado: "unknown",
    evidencia: `${medido} Duración y tamaño máximos cambian seguido: revísalos en la página oficial.`.trim(),
    fuente: u.specs, clave: clave("specs"),
  }));
  const cat = datos.brief.categoria;
  out.push(conManual(datos, {
    id: "politica", nombre: cat === "ninguna" ? "Reglas de publicidad de la plataforma" : `Reglas de publicidad (tema delicado: ${CATEGORIAS_SENSIBLES[cat]})`,
    estado: "unknown", evidencia: cat === "ninguna" ? "Que la plataforma apruebe el anuncio no significa que sea legal en tu país." : "Tema delicado: revisa permisos, certificados, a quién se puede mostrar y avisos obligatorios en tu país.",
    fuente: u.politicas, clave: clave("politica"),
  }));
  out.push(conManual(datos, {
    id: "vista-previa", nombre: "Vista previa revisada", estado: "unknown",
    evidencia: "Al crear el anuncio, mira la vista previa: que no se corte el video, que se lean los textos y que el botón sea el correcto.",
    clave: clave("vista-previa"),
  }));
  return out;
}

function sumar(r: Resumen, cs: Chequeo[]) {
  for (const c of cs) r[c.estado]++;
}

export function revisar(datos: DatosCampana, proyectos: Record<string, InfoProyecto>): Revision {
  const total = vacio();
  const conceptos = datos.conceptos.map((c): RevisionConcepto => {
    const p = c.proyectoId ? (proyectos[c.proyectoId] ?? null) : null;
    const ids = c.ubicaciones.length ? c.ubicaciones : datos.brief.ubicaciones;
    const ubis = ids.map((id) => ubicacion(id)).filter((u): u is Ubicacion => Boolean(u));
    const copy = chequeosCopy(datos, c, p);
    const video = chequeosVideo(datos, c, p);
    const ubicaciones = ubis.map((u) => ({ ubicacion: u, chequeos: chequeosUbicacion(datos, c, u, p) }));
    const resumen = vacio();
    sumar(resumen, copy);
    sumar(resumen, video);
    for (const u of ubicaciones) sumar(resumen, u.chequeos);
    for (const k of Object.keys(total) as ResultadoChequeo[]) total[k] += resumen[k];
    return { conceptoId: c.id, nombre: c.nombre, proyecto: p, copy, video, ubicaciones, resumen };
  });
  return { conceptos, resumen: total };
}

/** Un concepto está listo cuando nada falla ni queda sin saber. */
export function listo(r: Resumen): boolean {
  return r.fail === 0 && r.unknown === 0;
}
