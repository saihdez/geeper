/**
 * Ediciones que sólo tocan geeper.json (ninguna usa la GPU). Son funciones puras: reciben un
 * proyecto válido y devuelven otro nuevo, validado.
 */
import { z } from "zod";
import {
  Color,
  Encuadre,
  Formato,
  Mostrar,
  pista,
  PISTAS_RESERVADAS,
  Plataforma,
  Texto,
  Transicion,
  validarProyecto,
  type Asset,
  type Escena,
  type Proyecto,
  type Recorte,
} from "./esquema";
import { Curva, Efecto, Fusion } from "./efectos-esquema";
import { norm } from "./subtitulos";

const Id = z.string().regex(/^[a-z0-9-]+$/);

export const Edicion = z.discriminatedUnion("tipo", [
  // `revisada`: la persona escuchó el tramo y escribió lo que se oye (revisión de dudosas en clips): deja de ser dudosa.
  z.object({ tipo: z.literal("corregirSubtitulo"), escena: z.string(), desde: z.number().int(), hasta: z.number().int(), texto: z.string(), revisada: z.boolean().optional() }),
  z.object({ tipo: z.literal("quitarCorreccion"), escena: z.string(), desde: z.number().int() }),
  z.object({ tipo: z.literal("quitarEscena"), escena: z.string() }),
  z.object({ tipo: z.literal("moverEscena"), escena: z.string(), a: z.number().int().min(0) }),
  z.object({ tipo: z.literal("cambiarFormato"), formato: Formato }),
  z.object({ tipo: z.literal("cambiarPlantilla"), plantilla: z.string().min(1) }),
  z.object({ tipo: z.literal("cambiarMostrar"), mostrar: z.array(Mostrar) }),
  z.object({
    tipo: z.literal("ajusteVisual"),
    escena: z.string(),
    ajuste: z.enum(["cubrir", "contener"]).optional(),
    ancla: z.enum(["centro", "arriba", "abajo"]).optional(),
  }),
  z.object({ tipo: z.literal("renombrar"), nombre: z.string().min(1) }),
  z.object({
    tipo: z.literal("cambiarVoz"),
    motor: z.enum(["mpt", "kokoro", "voxcpm"]).optional(),
    voz: z.string().min(1).optional(),
    velocidad: z.number().min(0.5).max(2).optional(),
  }),
  // ---- Edición por texto: quitar lo que se oye (y su tiempo) sin regenerar nada.
  z.object({ tipo: z.literal("recortarPalabras"), escena: z.string(), desde: z.number().int().min(0), hasta: z.number().int().positive() }),
  z.object({ tipo: z.literal("restaurarPalabras"), escena: z.string(), desde: z.number().int().min(0), hasta: z.number().int().positive() }),
  // Una persona escuchó esas palabras y su tiempo es correcto: dejan de ser dudosas (confianza 1).
  z.object({ tipo: z.literal("confirmarPalabras"), escena: z.string(), desde: z.number().int().min(0), hasta: z.number().int().positive() }),
  z.object({
    tipo: z.literal("quitarSilencios"),
    escena: z.string().optional(),
    /** Silencios de más de `umbral` segundos se acortan a `dejar` segundos. */
    umbral: z.number().min(0.2).max(5).default(0.6),
    dejar: z.number().min(0.05).max(2).default(0.25),
  }),
  z.object({ tipo: z.literal("quitarMuletillas"), escena: z.string().optional() }),
  z.object({ tipo: z.literal("quitarRecortes"), escena: z.string().optional(), motivo: z.enum(["palabras", "silencio", "muletilla"]).optional() }),
  // ---- Efectos del plano de una escena (null quita el efecto).
  z.object({
    tipo: z.literal("efectosVisual"),
    escena: z.string(),
    transicion: Transicion.nullable().optional(),
    movimiento: z.object({ desde: Encuadre, hasta: Encuadre, curva: Curva.optional() }).nullable().optional(),
    velocidad: z.number().min(0.1).max(10).nullable().optional(),
    color: Color.nullable().optional(),
    /** Efectos en orden (efectos.ts); [] = sin efectos en esta escena; null = vuelve al estilo del video. */
    efectos: z.array(Efecto).max(8).nullable().optional(),
    /** Ritmo del movimiento sólo de esta escena; null = vuelve al estilo del video. */
    curva: Curva.nullable().optional(),
  }),
  // ---- Estilo del video: lo heredan las escenas sin valor propio (null lo quita).
  z.object({
    tipo: z.literal("estiloVideo"),
    efectos: z.array(Efecto).max(8).nullable().optional(),
    transicion: Transicion.nullable().optional(),
    curva: Curva.nullable().optional(),
  }),
  // ---- Textos superpuestos.
  z.object({ tipo: z.literal("agregarTexto"), texto: Texto.omit({ id: true }).extend({ id: Id.optional() }) }),
  z.object({ tipo: z.literal("editarTexto"), id: Id, cambios: Texto.omit({ id: true }).partial() }),
  z.object({ tipo: z.literal("quitarTexto"), id: Id }),
  // ---- Pistas libres (superposiciones de video, efectos de sonido) con assets ya registrados.
  z.object({
    tipo: z.literal("agregarClipLibre"),
    pista: Id,
    asset: z.string().min(1),
    inicio: z.number().min(0),
    duracion: z.number().positive().optional(),
    desde: z.number().min(0).default(0),
    volumen: z.number().min(0).max(4).optional(),
    opacidad: z.number().min(0).max(1).optional(),
    transicion: Transicion.optional(),
    fusion: Fusion.optional(),
  }),
  z.object({ tipo: z.literal("quitarClipLibre"), clip: z.string().min(1) }),
  // ---- Ajustes de una superposición ya agregada (null quita el ajuste).
  z.object({
    tipo: z.literal("editarClipLibre"),
    clip: z.string().min(1),
    fusion: Fusion.optional(),
    efectos: z.array(Efecto).max(8).nullable().optional(),
    transicion: Transicion.nullable().optional(),
    opacidad: z.number().min(0).max(1).nullable().optional(),
  }),
  // ---- Destino y entrega.
  z.object({
    tipo: z.literal("cambiarDestino"),
    comercial: z.boolean().optional(),
    plataformas: z.array(Plataforma).optional(),
    master: z.boolean().optional(),
    marca: z.boolean().optional(),
  }),
  // ---- Botón de la tarjeta final sólo para este video (null o vacío = el de la plantilla).
  z.object({ tipo: z.literal("cambiarCta"), cta: z.string().trim().max(60).nullable() }),
  // ---- Música: desde qué segundo suena y sus pulsos (ver pulsos.ts).
  z.object({ tipo: z.literal("fijarMusica"), inicio: z.number().min(0), pulsos: z.array(z.number().min(0)).optional() }),
]);
export type Edicion = z.infer<typeof Edicion>;

function clonar(p: Proyecto): Proyecto {
  return structuredClone(p);
}

function indiceDe(p: Proyecto, escena: string): number {
  const i = pista(p, "voz").clips.findIndex((c) => c.escena === escena);
  if (i < 0) throw new Error(`No existe la escena ${escena}`);
  return i;
}

function escenaDe(p: Proyecto, id: string): Escena {
  const e = p.escenas[id];
  if (!e) throw new Error(`No existe la escena ${id}`);
  return e;
}

/** Rango del clip de voz de la escena, en tiempo del asset. */
function rangoVoz(p: Proyecto, escena: string): { desde: number; hasta: number } {
  const c = pista(p, "voz").clips[indiceDe(p, escena)]!;
  return { desde: c.rango.inicio, hasta: c.rango.inicio + c.rango.duracion };
}

/**
 * El tramo de tiempo que ocupan las palabras [desde, hasta) de la escena: de la mitad del silencio
 * anterior a la mitad del silencio siguiente, así el corte cae entre palabras y no se come ninguna.
 */
export function tramoDePalabras(p: Proyecto, escena: string, desde: number, hasta: number): { inicio: number; fin: number } {
  const e = escenaDe(p, escena);
  const w = e.palabras;
  if (desde < 0 || hasta > w.length || hasta <= desde) throw new Error("Rango de palabras inválido");
  const r = rangoVoz(p, escena);
  const antes = w[desde - 1];
  const despues = w[hasta];
  const inicio = antes ? (antes.fin + Math.max(antes.fin, w[desde]!.inicio)) / 2 : r.desde;
  const fin = despues ? (w[hasta - 1]!.fin + Math.max(w[hasta - 1]!.fin, despues.inicio)) / 2 : r.hasta;
  return { inicio: Math.max(r.desde, inicio), fin: Math.min(r.hasta, fin) };
}

/** Palabras de relleno que se quitan con «Quitar muletillas» (normalizadas: sin tildes ni signos). */
export const MULETILLAS = new Set(["eh", "ehh", "ehhh", "ehm", "em", "emm", "mm", "mmm", "mmmm", "uh", "uhm", "um", "umm", "ah", "ahh"]);

/** Formas base de las vacilaciones estiradas: «eeeeh», «ehmmm», «uuum» se aprietan a una de éstas. */
const VACILACIONES = new Set(["eh", "em", "ehm", "uh", "um", "uhm", "ah", "hm", "mh"]);

/**
 * ¿Es una vacilación? Además de la lista, reconoce las estiradas de cualquier largo (idea de Cap,
 * `crates/project/src/disfluency.rs`): «mmmmm» y, apretando las letras repetidas, «eeehhh» → «eh».
 * «Ajá» o «mjm» no caen: no se aprietan a una forma de la lista.
 */
export function esMuletilla(texto: string): boolean {
  const n = norm(texto);
  if (!n) return false;
  if (MULETILLAS.has(n)) return true;
  if (!/^[a-z]+$/.test(n)) return false;
  if (n.length >= 2 && /^m+$/.test(n)) return true;
  return VACILACIONES.has(n.replace(/(.)\1+/g, "$1"));
}

/**
 * Palabras que en español se repiten a propósito («no, no», «sí sí», «muy muy», «ya ya», «jaja ja»):
 * nunca se cuentan como tartamudeo. Los números tampoco («dos dos»).
 */
const DOBLES_INTENCIONALES = new Set([
  "no", "si", "muy", "ya", "bueno", "claro", "mas", "nada", "poco", "cada", "tan", "otra", "otro", "vamos", "dale",
  "corre", "rapido", "anda", "andale", "hola", "adios", "chao", "oye", "mira", "ay", "uy", "oh", "ja", "je", "jaja",
  "jeje", "jajaja", "pum", "tic", "tac", "bla", "toc", "listo", "vale", "eso", "bien", "super", "mucho", "mucha",
  "cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "cien", "mil", "millon",
]);

/** Pausa (s) a partir de la cual una repetición es intención («Fue… fue increíble») y no tartamudeo. */
const PAUSA_REPETICION = 1.0;
/** Frase más larga que se busca repetida («en el en el»). */
const MAX_FRASE_REPETIDA = 3;

/**
 * Tartamudeos: una palabra o frase corta dicha dos veces seguidas («el el problema», «en la en la casa»).
 * Devuelve los rangos [desde, hasta) de la PRIMERA vez, que es la que se quita. Reglas de Cap
 * (`detect_repetitions`) pasadas al español: se saltan las vacilaciones intermedias («el, eh, el»), no
 * cuenta si la primera vez cierra una oración, si hay una pausa ≥ 1 s o si es un doble intencional.
 */
export function repeticiones(palabras: { texto: string; inicio: number; fin: number }[]): [number, number][] {
  const dichas = palabras.map((_, i) => i).filter((i) => !esMuletilla(palabras[i]!.texto) && norm(palabras[i]!.texto));
  const cierra = (i: number) => /[.?!…]["'”’)\]]*$/.test(palabras[i]!.texto.trim());
  const out: [number, number][] = [];
  let k = 0;
  while (k < dichas.length) {
    let tam = 0;
    for (let n = MAX_FRASE_REPETIDA; n >= 1; n--) {
      if (k + 2 * n > dichas.length) continue;
      const a = dichas.slice(k, k + n);
      const b = dichas.slice(k + n, k + 2 * n);
      if (!a.every((x, j) => norm(palabras[x]!.texto) === norm(palabras[b[j]!]!.texto))) continue;
      if ([...a, ...b.slice(0, -1)].some(cierra)) continue;
      if (a.every((x) => DOBLES_INTENCIONALES.has(norm(palabras[x]!.texto)) || /^\d+$/.test(norm(palabras[x]!.texto)))) continue;
      let pausa = 0;
      for (let x = a[0]!; x < b[n - 1]!; x++) pausa = Math.max(pausa, palabras[x + 1]!.inicio - palabras[x]!.fin);
      if (pausa >= PAUSA_REPETICION) continue;
      tam = n;
      break;
    }
    if (tam) {
      out.push([dichas[k]!, dichas[k + tam - 1]! + 1]);
      k += tam;
    } else k++;
  }
  return out;
}

function agregarRecorte(e: Escena, r: Recorte) {
  e.recortes.push(r);
  e.recortes.sort((a, b) => a.inicio - b.inicio);
}

/** Recortes de silencio de una escena: cada pausa de más de `umbral` s queda en `dejar` s. */
export function silenciosLargos(p: Proyecto, escena: string, umbral: number, dejar: number): Recorte[] {
  const e = escenaDe(p, escena);
  const r = rangoVoz(p, escena);
  const marcas = [
    { fin: r.desde, inicio: r.desde },
    ...e.palabras.filter((w) => w.fin > r.desde && w.inicio < r.hasta),
    { inicio: r.hasta, fin: r.hasta },
  ];
  if (marcas.length <= 2) return []; // sin palabras: no hay pausas que acortar
  const out: Recorte[] = [];
  const ultimo = marcas.length - 2;
  for (let i = 0; i <= ultimo; i++) {
    const a = Math.max(r.desde, marcas[i]!.fin);
    const b = Math.min(r.hasta, marcas[i + 1]!.inicio);
    if (b - a <= umbral) continue;
    // Pausa interna: quedan `dejar` s, mitad pegada a cada palabra. Pausa en el borde de la escena:
    // queda `dejar / 2` junto a la palabra (la otra mitad la pone la escena vecina).
    const inicio = i === 0 ? a : a + dejar / 2;
    const fin = i === ultimo ? b : b - dejar / 2;
    if (fin - inicio > 0.05) out.push({ inicio, fin, motivo: "silencio" });
  }
  return out;
}

export function aplicarEdicion(original: Proyecto, ed: Edicion): Proyecto {
  const p = clonar(original);
  switch (ed.tipo) {
    case "corregirSubtitulo": {
      const e = escenaDe(p, ed.escena);
      if (ed.desde < 0 || ed.hasta > e.palabras.length || ed.hasta <= ed.desde) throw new Error("Rango de palabras inválido");
      // Una corrección nueva reemplaza a las que se solapan con ella.
      e.correcciones = e.correcciones.filter((c) => c.hasta <= ed.desde || c.desde >= ed.hasta);
      const oido = e.palabras.slice(ed.desde, ed.hasta).map((w) => w.texto).join(" ");
      if (ed.texto.trim() !== oido) e.correcciones.push({ desde: ed.desde, hasta: ed.hasta, texto: ed.texto.trim() });
      e.correcciones.sort((a, b) => a.desde - b.desde);
      if (ed.revisada) for (let i = ed.desde; i < ed.hasta; i++) e.palabras[i] = { ...e.palabras[i]!, confianza: 1 };
      break;
    }
    case "quitarCorreccion": {
      const e = escenaDe(p, ed.escena);
      e.correcciones = e.correcciones.filter((c) => c.desde !== ed.desde);
      break;
    }
    case "quitarEscena": {
      if (pista(p, "voz").clips.length <= 1) throw new Error("No se puede quitar la única escena");
      const i = indiceDe(p, ed.escena);
      pista(p, "voz").clips.splice(i, 1);
      pista(p, "visual").clips.splice(i, 1);
      delete p.escenas[ed.escena];
      break;
    }
    case "moverEscena": {
      const i = indiceDe(p, ed.escena);
      for (const id of ["voz", "visual"] as const) {
        const clips = pista(p, id).clips;
        const [c] = clips.splice(i, 1);
        clips.splice(Math.min(ed.a, clips.length), 0, c!);
      }
      break;
    }
    case "cambiarFormato":
      p.formato = ed.formato;
      break;
    case "cambiarPlantilla":
      p.plantilla = ed.plantilla;
      break;
    case "cambiarMostrar":
      p.mostrar = ed.mostrar;
      break;
    case "ajusteVisual": {
      const c = pista(p, "visual").clips[indiceDe(p, ed.escena)]!;
      c.ajuste = ed.ajuste;
      c.ancla = ed.ancla;
      break;
    }
    case "renombrar":
      p.nombre = ed.nombre;
      break;
    case "cambiarVoz":
      // Sólo cambia cómo se generará la próxima voz; lo que ya suena no cambia hasta regenerarla.
      if (ed.motor) p.voz.motor = ed.motor;
      if (ed.voz) p.voz.voz = ed.voz;
      if (ed.velocidad) p.voz.velocidad = ed.velocidad;
      break;
    case "recortarPalabras": {
      const e = escenaDe(p, ed.escena);
      const t = tramoDePalabras(p, ed.escena, ed.desde, ed.hasta);
      agregarRecorte(e, { ...t, motivo: "palabras" });
      break;
    }
    case "restaurarPalabras": {
      // Quita los recortes que tocan esas palabras (enteros: un recorte no se parte).
      const e = escenaDe(p, ed.escena);
      const desde = e.palabras[ed.desde];
      const hasta = e.palabras[Math.min(ed.hasta, e.palabras.length) - 1];
      if (!desde || !hasta) throw new Error("Rango de palabras inválido");
      e.recortes = e.recortes.filter((r) => r.fin <= desde.inicio || r.inicio >= hasta.fin);
      break;
    }
    case "confirmarPalabras": {
      const e = escenaDe(p, ed.escena);
      if (ed.hasta <= ed.desde || ed.hasta > e.palabras.length) throw new Error("Rango de palabras inválido");
      for (let i = ed.desde; i < ed.hasta; i++) e.palabras[i] = { ...e.palabras[i]!, confianza: 1 };
      break;
    }
    case "quitarSilencios": {
      const ids = ed.escena ? [ed.escena] : pista(p, "voz").clips.map((c) => c.escena!);
      for (const id of ids) {
        const e = escenaDe(p, id);
        e.recortes = e.recortes.filter((r) => r.motivo !== "silencio");
        for (const r of silenciosLargos(p, id, ed.umbral, ed.dejar)) agregarRecorte(e, r);
      }
      break;
    }
    case "quitarMuletillas": {
      const ids = ed.escena ? [ed.escena] : pista(p, "voz").clips.map((c) => c.escena!);
      for (const id of ids) {
        const e = escenaDe(p, id);
        // Se recalcula entero: aplicarlo dos veces no duplica recortes.
        e.recortes = e.recortes.filter((r) => r.motivo !== "muletilla");
        // Vacilaciones («eh», «mmmm») y la primera vez de cada tartamudeo («el el»).
        const quitar = e.palabras.map((w) => esMuletilla(w.texto));
        for (const [a, b] of repeticiones(e.palabras)) for (let x = a; x < b; x++) quitar[x] = true;
        let i = 0;
        while (i < e.palabras.length) {
          if (!quitar[i]) {
            i++;
            continue;
          }
          let j = i + 1;
          while (j < e.palabras.length && quitar[j]) j++;
          // Nunca se deja una escena sin nada que decir.
          if (!(i === 0 && j === e.palabras.length)) agregarRecorte(e, { ...tramoDePalabras(p, id, i, j), motivo: "muletilla" });
          i = j;
        }
      }
      break;
    }
    case "quitarRecortes": {
      const ids = ed.escena ? [ed.escena] : Object.keys(p.escenas);
      for (const id of ids) {
        const e = escenaDe(p, id);
        e.recortes = ed.motivo ? e.recortes.filter((r) => r.motivo !== ed.motivo) : [];
      }
      break;
    }
    case "efectosVisual": {
      const c = pista(p, "visual").clips[indiceDe(p, ed.escena)]!;
      if (ed.transicion !== undefined) c.transicion = ed.transicion ?? undefined;
      if (ed.movimiento !== undefined) c.movimiento = ed.movimiento ?? undefined;
      if (ed.velocidad !== undefined) c.velocidad = ed.velocidad === null || ed.velocidad === 1 ? undefined : ed.velocidad;
      if (ed.color !== undefined) c.color = ed.color ?? undefined;
      if (ed.efectos !== undefined) c.efectos = ed.efectos ?? undefined;
      if (ed.curva !== undefined && c.movimiento) {
        const { curva: _, ...sin } = c.movimiento;
        c.movimiento = ed.curva ? { ...sin, curva: ed.curva } : sin;
      }
      break;
    }
    case "estiloVideo": {
      const e = { ...p.estilo };
      if (ed.efectos !== undefined) e.efectos = ed.efectos?.length ? ed.efectos : undefined;
      if (ed.transicion !== undefined) e.transicion = ed.transicion ?? undefined;
      if (ed.curva !== undefined) e.curva = ed.curva ?? undefined;
      p.estilo = e.efectos || e.transicion || e.curva ? e : undefined;
      break;
    }
    case "editarClipLibre": {
      const c = p.pistas
        .filter((x) => !(PISTAS_RESERVADAS as readonly string[]).includes(x.id) && x.tipo === "video")
        .flatMap((x) => x.clips)
        .find((x) => x.id === ed.clip);
      if (!c) throw new Error(`No hay una superposición ${ed.clip}`);
      if (ed.fusion !== undefined) c.fusion = ed.fusion === "normal" ? undefined : ed.fusion;
      if (ed.efectos !== undefined) c.efectos = ed.efectos?.length ? ed.efectos : undefined;
      if (ed.transicion !== undefined) c.transicion = ed.transicion ?? undefined;
      if (ed.opacidad !== undefined) c.opacidad = ed.opacidad ?? undefined;
      break;
    }
    case "agregarTexto": {
      const usados = new Set(p.textos.map((t) => t.id));
      let id = ed.texto.id ?? `texto-${p.textos.length + 1}`;
      for (let n = p.textos.length + 2; usados.has(id); n++) id = `texto-${n}`;
      p.textos.push({ ...ed.texto, id });
      p.textos.sort((a, b) => a.inicio - b.inicio);
      break;
    }
    case "editarTexto": {
      const t = p.textos.find((x) => x.id === ed.id);
      if (!t) throw new Error(`No existe el texto ${ed.id}`);
      Object.assign(t, Object.fromEntries(Object.entries(ed.cambios).filter(([, v]) => v !== undefined)));
      p.textos.sort((a, b) => a.inicio - b.inicio);
      break;
    }
    case "quitarTexto":
      p.textos = p.textos.filter((t) => t.id !== ed.id);
      break;
    case "agregarClipLibre": {
      if ((PISTAS_RESERVADAS as readonly string[]).includes(ed.pista)) throw new Error(`«${ed.pista}» es una pista reservada: usa otro nombre`);
      const a = p.assets[ed.asset];
      if (!a) throw new Error(`No existe el asset ${ed.asset}`);
      const tipo = a.tipo === "audio" ? "audio" : "video";
      let pi = p.pistas.find((x) => x.id === ed.pista);
      if (!pi) {
        pi = { id: ed.pista, tipo, clips: [] };
        p.pistas.push(pi);
      }
      if (pi.tipo !== tipo) throw new Error(`La pista «${ed.pista}» es de ${pi.tipo} y el asset es de ${a.tipo}`);
      const disponible = a.tipo === "imagen" || !a.duracion ? (ed.duracion ?? 3) : a.duracion - ed.desde;
      const duracion = Math.min(ed.duracion ?? disponible, disponible);
      if (duracion <= 0) throw new Error("El clip no tiene duración");
      const ids = new Set(p.pistas.flatMap((x) => x.clips.map((c) => c.id)));
      let n = pi.clips.length + 1;
      while (ids.has(`${ed.pista}-${n}`)) n++;
      pi.clips.push({
        id: `${ed.pista}-${n}`,
        asset: a.id,
        inicio: ed.inicio,
        rango: { inicio: ed.desde, duracion },
        volumen: tipo === "audio" ? ed.volumen : undefined,
        opacidad: tipo === "video" ? ed.opacidad : undefined,
        transicion: tipo === "video" ? ed.transicion : undefined,
        fusion: tipo === "video" && ed.fusion !== "normal" ? ed.fusion : undefined,
      });
      pi.clips.sort((x, y) => (x.inicio ?? 0) - (y.inicio ?? 0));
      break;
    }
    case "quitarClipLibre": {
      const pi = p.pistas.find((x) => !(PISTAS_RESERVADAS as readonly string[]).includes(x.id) && x.clips.some((c) => c.id === ed.clip));
      if (!pi) throw new Error(`No hay un clip libre ${ed.clip}`);
      pi.clips = pi.clips.filter((c) => c.id !== ed.clip);
      if (!pi.clips.length) p.pistas = p.pistas.filter((x) => x !== pi);
      limpiarAssets(p);
      break;
    }
    case "cambiarCta":
      if (ed.cta) p.cta = ed.cta;
      else delete p.cta;
      break;
    case "cambiarDestino":
      if (ed.comercial !== undefined) p.comercial = ed.comercial;
      if (ed.plataformas !== undefined) p.plataformas = [...new Set(ed.plataformas)];
      if (ed.master !== undefined) p.entrega = { ...p.entrega, master: ed.master };
      if (ed.marca !== undefined) p.marca = ed.marca;
      break;
    case "fijarMusica": {
      const m = p.pistas.find((x) => x.id === "musica")?.clips[0];
      if (!m) throw new Error("El proyecto no tiene música");
      const a = p.assets[m.asset]!;
      const inicio = a.duracion ? ed.inicio % a.duracion : ed.inicio;
      m.rango = { inicio, duracion: Math.max(0.1, (a.duracion ?? m.rango.duracion + m.rango.inicio) - inicio) };
      if (ed.pulsos) {
        p.marcadores = [
          ...p.marcadores.filter((x) => x.tipo !== "pulso"),
          ...ed.pulsos.map((t, i) => ({ id: `pulso-${i + 1}`, tiempo: t, nombre: `Pulso ${i + 1}`, tipo: "pulso" as const })),
        ].sort((x, y) => x.tiempo - y.tiempo);
      }
      break;
    }
  }
  return validarProyecto(p);
}

/** Reemplaza el clip visual de una escena por un asset ya registrado (p. ej. un archivo subido). */
export function reemplazarVisual(original: Proyecto, escena: string, asset: Asset): Proyecto {
  const p = clonar(original);
  p.assets[asset.id] = asset;
  const c = pista(p, "visual").clips[indiceDe(p, escena)]!;
  c.asset = asset.id;
  // Un archivo propio ya no es la misma grabación que la voz.
  delete c.sincro;
  c.rango = { inicio: 0, duracion: c.rango.duracion };
  return validarProyecto(limpiarAssets(p));
}

/** Registra un asset nuevo en el proyecto sin usarlo todavía (p. ej. una superposición subida). */
export function registrarAsset(original: Proyecto, asset: Asset): Proyecto {
  const p = clonar(original);
  p.assets[asset.id] = asset;
  return p;
}

/** Quita del índice los assets que ya no usa ningún clip (los archivos se quedan en disco). */
export function limpiarAssets(p: Proyecto): Proyecto {
  const usados = new Set(p.pistas.flatMap((x) => x.clips.map((c) => c.asset)));
  for (const id of Object.keys(p.assets)) if (!usados.has(id)) delete p.assets[id];
  return p;
}

/*
 * Voces del video (UX-12). «Regenerar voz de la escena» usa la voz ELEGIDA del proyecto (`p.voz`), que
 * puede no ser la que suena en el resto: el video quedaba con dos voces y nadie lo avisaba. Esto sólo
 * mira y avisa; no bloquea nada.
 */

/** Nombre comparable de una voz: «kokoro:ef_dora» (MPT) y «ef_dora» (Kokoro local) son la misma. */
export function claveVoz(voz: string): string {
  return voz.trim().toLowerCase().replace(/^kokoro:/, "");
}

/**
 * Con qué voz suena cada escena (en el orden del video). `voz` es null si es una voz real (un clip, un
 * audio propio) o si el asset no dice cuál es: ésas no cuentan para comparar.
 */
export function vocesDeEscenas(p: Proyecto): { escena: string; numero: number; voz: string | null }[] {
  return pista(p, "voz").clips.map((c, i) => {
    const a = p.assets[c.asset];
    const sintetica = a && (a.source === "tts" || a.source === "mpt") && a.regenerar.origen !== "clip";
    const voz = sintetica && typeof a.regenerar.voz === "string" && a.regenerar.voz.trim() ? claveVoz(a.regenerar.voz) : null;
    return { escena: c.escena ?? "", numero: i + 1, voz };
  });
}

/** Escenas que no suenan con la voz elegida del proyecto (para avisar que la voz elegida todavía no suena). */
export function escenasConOtraVoz(p: Proyecto): { escena: string; numero: number; voz: string }[] {
  const elegida = claveVoz(p.voz.voz);
  return vocesDeEscenas(p).filter((x): x is { escena: string; numero: number; voz: string } => x.voz !== null && x.voz !== elegida);
}

const enLista = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/**
 * Aviso antes de rehacer la voz de UNA escena: con la voz elegida, ¿queda distinta de las demás? Por
 * ejemplo: «Esta escena quedará con la voz Álex y las otras 7 con Dora.» null si todo queda igual.
 * `nombre`: cómo se llama cada voz en pantalla (de «em_alex» a «Álex»).
 */
export function avisoVozDeEscena(p: Proyecto, escena: string, nombre: (voz: string) => string = (v) => v): string | null {
  const elegida = claveVoz(p.voz.voz);
  const otras = vocesDeEscenas(p).filter((x) => x.escena !== escena && x.voz !== null);
  const distintas = otras.filter((x) => x.voz !== elegida);
  if (!distintas.length) return null;
  const k = distintas.length;
  const quienes = k === otras.length ? (k === 1 ? "la otra" : `las otras ${k}`) : k === 1 ? "otra escena" : `otras ${k} escenas`;
  return `Esta escena quedará con la voz ${nombre(elegida)} y ${quienes} con ${enLista([...new Set(distintas.map((x) => nombre(x.voz!)))])}.`;
}

/**
 * Aviso para la revisión final: «El video mezcla dos voces: Dora y Álex (escena 8).» Las escenas que se
 * nombran son las que no tienen la voz más usada. null si todas suenan con la misma.
 */
export function avisoMezclaVoces(p: Proyecto, nombre: (voz: string) => string = (v) => v): string | null {
  const con = vocesDeEscenas(p).filter((x): x is { escena: string; numero: number; voz: string } => x.voz !== null);
  const cuenta = new Map<string, number>();
  for (const x of con) cuenta.set(x.voz, (cuenta.get(x.voz) ?? 0) + 1);
  if (cuenta.size < 2) return null;
  const elegida = claveVoz(p.voz.voz);
  // La más usada; si empatan, la elegida del proyecto.
  const principal = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === elegida) - Number(a[0] === elegida))[0]![0];
  const resto = con.filter((x) => x.voz !== principal).map((x) => x.numero);
  const cuantas = cuenta.size === 2 ? "dos" : String(cuenta.size);
  const voces = enLista([principal, ...[...cuenta.keys()].filter((v) => v !== principal)].map(nombre));
  return `El video mezcla ${cuantas} voces: ${voces} (${resto.length === 1 ? "escena" : "escenas"} ${enLista(resto.map(String))}).`;
}
