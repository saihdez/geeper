/**
 * «Pedir los datos con Google Forms»: Geeper crea en la cuenta de Google de la persona un formulario con
 * las preguntas de la invitación, ella le manda el enlace a su cliente y, cuando el cliente responde,
 * Geeper arma (o actualiza) la invitación con esas respuestas.
 *
 * Cada pedido vive en `<GEEPER_DATA>/invitaciones-formularios/<id>.json`, con el id de cada pregunta en
 * Google: así una respuesta se lee por pregunta y no por título (el cliente o la persona pueden cambiar
 * los textos del formulario en Google sin romper nada).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { escribirAtomico } from "../archivos";
import { dirDatos } from "../rutas";
import { TIPOS_INFO } from "./catalogo";
import { guardarInvitacion, leerInvitacion } from "./construir";
import { Entrada, TIPOS, Tipo, zonaValida, type Invitacion } from "./esquema";
import { forms } from "./google";
import { temaPorPalabras } from "./tema";

export const dirFormularios = () => path.join(dirDatos(), "invitaciones-formularios");
const ID = /^f-[0-9a-f]{12}$/;

/** Las preguntas, en orden. `campo` es la clave estable con la que se lee la respuesta. */
type Clase = "corta" | "larga" | "fecha" | "hora" | "tipo";
interface Pregunta {
  campo: string;
  titulo: string;
  ayuda?: string;
  clase: Clase;
  obligatoria?: boolean;
}

export const PREGUNTAS: Pregunta[] = [
  { campo: "tipo", titulo: "¿Qué se celebra?", clase: "tipo", obligatoria: true },
  { campo: "nombres", titulo: "¿De quién es la fiesta?", ayuda: "Como quieres que aparezca en grande. Por ejemplo: Ana & Luis, o Sofía.", clase: "corta", obligatoria: true },
  { campo: "fecha", titulo: "Fecha del evento", clase: "fecha", obligatoria: true },
  { campo: "hora", titulo: "Hora de inicio", clase: "hora", obligatoria: true },
  { campo: "lugar", titulo: "Nombre del lugar", ayuda: "Por ejemplo: Hacienda Los Olivos.", clase: "corta", obligatoria: true },
  { campo: "direccion", titulo: "Dirección del lugar", ayuda: "Calle, número, colonia y ciudad.", clase: "corta" },
  { campo: "mapa", titulo: "Enlace de Google Maps del lugar (opcional)", ayuda: "En Google Maps: busca el lugar → Compartir → Copiar vínculo.", clase: "corta" },
  { campo: "whatsapp", titulo: "WhatsApp donde quieres recibir las confirmaciones", ayuda: "Con el código del país, por ejemplo 52 55 1234 5678 (México) o 1 305 123 4567 (EE. UU.).", clase: "corta", obligatoria: true },
  { campo: "titulo", titulo: "Título de la invitación (opcional)", ayuda: "Por ejemplo: «Nuestra boda» o «Mis XV años». Si lo dejas vacío, ponemos uno.", clase: "corta" },
  { campo: "mensaje", titulo: "Mensaje para tus invitados (opcional)", ayuda: "Unas líneas para invitar. Si lo dejas vacío, escribimos uno bonito.", clase: "larga" },
  { campo: "idea", titulo: "¿Cómo te la imaginas? (opcional)", ayuda: "Temática, colores o estilo. Por ejemplo: bosque encantado, dorado y verde, elegante.", clase: "larga" },
  { campo: "musica", titulo: "Canción (opcional)", ayuda: "Pega el enlace de Spotify (Compartir → Copiar enlace) o de YouTube.", clase: "corta" },
  { campo: "dressEstilo", titulo: "Código de vestimenta (opcional)", ayuda: "Por ejemplo: formal, casual elegante, de blanco.", clase: "corta" },
  { campo: "dressEvitar", titulo: "¿Algo que los invitados no deban usar? (opcional)", ayuda: "Por ejemplo: el blanco se reserva para la novia.", clase: "corta" },
  { campo: "confirmarAntes", titulo: "¿Hasta qué fecha pueden confirmar? (opcional)", clase: "fecha" },
  { campo: "pases", titulo: "¿Para cuántas personas es cada invitación? (opcional)", ayuda: "Sólo el número, por ejemplo 2.", clase: "corta" },
  { campo: "regalos", titulo: "Mesa de regalos (opcional)", ayuda: "Por ejemplo: Liverpool 12345678, o «tu presencia es nuestro mejor regalo».", clase: "larga" },
  { campo: "hashtag", titulo: "Hashtag para las fotos (opcional)", ayuda: "Por ejemplo: #AnaYLuis2026", clase: "corta" },
];

export const Pedido = z.object({
  id: z.string().regex(ID),
  /** Para reconocerlo en la lista («Boda de Ana»). */
  referencia: z.string(),
  formId: z.string(),
  enlace: z.string(),
  editar: z.string(),
  zona: z.string(),
  tipo: Tipo.optional(),
  /** campo → questionId en Google. */
  preguntas: z.record(z.string(), z.string()),
  creado: z.string(),
  revisado: z.string().optional(),
  /** La última respuesta que se usó (para no rehacer la invitación si no cambió). */
  respuesta: z.object({ id: z.string(), enviada: z.string() }).optional(),
  slug: z.string().optional(),
  /** Lo que hubo que corregir de la última respuesta (vacío: se usó tal cual). */
  problemas: z.array(z.string()).default([]),
  avisos: z.array(z.string()).default([]),
  /** La respuesta pasada a datos de invitación, para completarla a mano si algo no se pudo usar. */
  borrador: z.record(z.string(), z.unknown()).optional(),
});
export type Pedido = z.infer<typeof Pedido>;

const rutaPedido = (id: string) => {
  if (!ID.test(id)) throw new Error("Formulario no encontrado");
  return path.join(dirFormularios(), `${id}.json`);
};

export async function leerPedido(id: string): Promise<Pedido> {
  const crudo = await fs.readFile(rutaPedido(id), "utf8").catch(() => {
    throw new Error("Formulario no encontrado");
  });
  return Pedido.parse(JSON.parse(crudo));
}

async function guardarPedido(p: Pedido) {
  await fs.mkdir(dirFormularios(), { recursive: true });
  await escribirAtomico(rutaPedido(p.id), JSON.stringify(p, null, 2));
}

export async function listarPedidos(): Promise<Pedido[]> {
  const nombres = await fs.readdir(dirFormularios()).catch(() => [] as string[]);
  const out: Pedido[] = [];
  for (const n of nombres) {
    if (!n.endsWith(".json")) continue;
    try {
      out.push(await leerPedido(n.slice(0, -5)));
    } catch {
      /* archivo a medias: se ignora */
    }
  }
  return out.sort((a, b) => b.creado.localeCompare(a.creado));
}

/** Sólo se borra en Geeper: el formulario sigue en el Drive de la persona (lo puede borrar allí). */
export async function borrarPedido(id: string): Promise<void> {
  await fs.rm(rutaPedido(id), { force: true });
}

function pregunta(p: Pregunta, tipo?: Tipo) {
  const base = { required: !!p.obligatoria };
  switch (p.clase) {
    case "fecha":
      return { ...base, dateQuestion: { includeYear: true, includeTime: false } };
    case "hora":
      return { ...base, timeQuestion: { duration: false } };
    case "tipo":
      return { ...base, choiceQuestion: { type: "RADIO", options: TIPOS.filter((t) => !tipo || t === tipo).map((t) => ({ value: TIPOS_INFO[t].nombre })) } };
    default:
      return { ...base, textQuestion: { paragraph: p.clase === "larga" } };
  }
}

/** Pedidos a la Forms API para armar el formulario (`forms.batchUpdate`). */
export function pedidosFormulario(tipo?: Tipo): { requests: unknown[]; campos: string[] } {
  const lista = PREGUNTAS.filter((p) => !(tipo && p.campo === "tipo"));
  const requests: unknown[] = [
    {
      updateFormInfo: {
        info: { description: "Con tus respuestas armamos tu invitación digital: se abre como un sobre, con música, calendario, cuenta atrás, cómo llegar y confirmación por WhatsApp. Te toma unos 3 minutos." },
        updateMask: "description",
      },
    },
    ...lista.map((p, i) => ({
      createItem: {
        item: { title: p.titulo, ...(p.ayuda ? { description: p.ayuda } : {}), questionItem: { question: pregunta(p, tipo) } },
        location: { index: i },
      },
    })),
  ];
  return { requests, campos: lista.map((p) => p.campo) };
}

export const NuevoPedido = z.object({
  referencia: z.string().trim().min(1, "Escribe para quién es (por ejemplo: Boda de Ana)").max(80),
  tipo: Tipo.optional(),
  zona: z.string().refine(zonaValida, "zona horaria desconocida"),
});

interface FormCreado {
  formId: string;
  responderUri: string;
}
interface RespLote {
  replies?: ({ createItem?: { itemId: string; questionId?: string[] } } | Record<string, never>)[];
}

/** Crea el formulario en Google y guarda el pedido. Los formularios nuevos de la API ya aceptan respuestas. */
export async function crearPedido(datos: unknown): Promise<Pedido> {
  const n = NuevoPedido.parse(datos);
  const titulo = `Datos para tu invitación · ${n.referencia}`;
  const creado = await forms<FormCreado>("/forms", { method: "POST", body: { info: { title: titulo, documentTitle: titulo } } });
  const { requests, campos } = pedidosFormulario(n.tipo);
  const lote = await forms<RespLote>(`/forms/${encodeURIComponent(creado.formId)}:batchUpdate`, { method: "POST", body: { requests } });
  const respuestas = (lote.replies ?? []).slice(1);
  const preguntas: Record<string, string> = {};
  campos.forEach((c, i) => {
    const q = (respuestas[i] as { createItem?: { questionId?: string[] } } | undefined)?.createItem?.questionId?.[0];
    if (q) preguntas[c] = q;
  });
  if (Object.keys(preguntas).length !== campos.length) throw new Error("Google creó el formulario pero no devolvió todas las preguntas. Bórralo en Google Forms y vuelve a intentarlo.");
  const p = Pedido.parse({
    id: `f-${randomBytes(6).toString("hex")}`,
    referencia: n.referencia,
    formId: creado.formId,
    enlace: creado.responderUri,
    editar: `https://docs.google.com/forms/d/${encodeURIComponent(creado.formId)}/edit`,
    zona: n.zona,
    tipo: n.tipo,
    preguntas,
    creado: new Date().toISOString(),
  });
  await guardarPedido(p);
  return p;
}

interface Respuesta {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  answers?: Record<string, { questionId?: string; textAnswers?: { answers?: { value?: string }[] } }>;
}

const nombreATipo = new Map(TIPOS.map((t) => [TIPOS_INFO[t].nombre.toLowerCase(), t]));

/** Fecha de Google («2026-12-15», o «12-15» si la pregunta no llevaba año) → «YYYY-MM-DD». */
function fechaDe(v: string, zona: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const c = /^(\d{2})-(\d{2})/.exec(v);
  if (!c) return undefined;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const anio = Number(hoy.slice(0, 4));
  const f = `${anio}-${c[1]}-${c[2]}`;
  return f < hoy ? `${anio + 1}-${c[1]}-${c[2]}` : f;
}

function horaDe(v: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})/.exec(v);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : undefined;
}

/**
 * Respuesta del formulario → datos de invitación. Lo opcional que no sirve (un enlace de mapa raro, pases
 * que no son número) se deja fuera con un aviso; lo obligatorio que no sirve queda en `problemas`.
 */
export function entradaDeRespuesta(p: Pick<Pedido, "preguntas" | "zona" | "tipo">, r: Respuesta): { entrada: Record<string, unknown>; avisos: string[]; idea?: string } {
  const valor = (campo: string) => {
    const q = p.preguntas[campo];
    const a = q ? r.answers?.[q]?.textAnswers?.answers : undefined;
    const v = a?.map((x) => x.value ?? "").join(", ").trim();
    return v ? v : undefined;
  };
  const avisos: string[] = [];
  const tipo = p.tipo ?? nombreATipo.get((valor("tipo") ?? "").toLowerCase()) ?? "otro";
  const mapa = valor("mapa");
  const mapaOk = mapa && /^https:\/\/\S+$/.test(mapa) ? mapa : undefined;
  if (mapa && !mapaOk) avisos.push("El enlace del mapa no era un enlace (https://…): se usa la dirección para «Cómo llegar».");
  const pasesTxt = valor("pases");
  const pasesNum = pasesTxt ? Number(/\d+/.exec(pasesTxt)?.[0]) : undefined;
  const pases = pasesNum && pasesNum >= 1 && pasesNum <= 20 ? pasesNum : undefined;
  if (pasesTxt && !pases) avisos.push(`Los pases («${pasesTxt}») no eran un número del 1 al 20: no se muestran.`);
  const musica = valor("musica");
  const recorta = (v: string | undefined, max: number) => (v && v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v);
  const idea = recorta(valor("idea"), 300);
  const entrada: Record<string, unknown> = {
    tipo,
    nombres: recorta(valor("nombres"), 80),
    titulo: recorta(valor("titulo"), 60),
    fecha: fechaDe(valor("fecha") ?? "", p.zona),
    hora: horaDe(valor("hora") ?? "") ?? "18:00",
    zona: p.zona,
    lugar: { nombre: recorta(valor("lugar"), 100), direccion: recorta(valor("direccion"), 200), mapa: mapaOk },
    whatsapp: valor("whatsapp") ?? "",
    mensaje: recorta(valor("mensaje"), 600),
    musicaEnlace: musica,
    dressCode: { estilo: recorta(valor("dressEstilo"), 40), colores: [], evitar: recorta(valor("dressEvitar"), 120) },
    confirmarAntes: valor("confirmarAntes") ? fechaDe(valor("confirmarAntes")!, p.zona) : undefined,
    pases,
    regalos: recorta(valor("regalos"), 300),
    hashtag: recorta(valor("hashtag")?.replace(/\s+/g, ""), 40),
  };
  if (idea) {
    entrada.plantilla = "tema";
    entrada.tema = { ...temaPorPalabras(idea, tipo), idea };
  }
  return { entrada, avisos, idea };
}

/** Errores de la validación → frases para la persona. */
function problemasDe(e: z.ZodError): string[] {
  const nombre: Record<string, string> = { nombres: "los nombres", fecha: "la fecha", hora: "la hora", whatsapp: "el WhatsApp", lugar: "el lugar", confirmarAntes: "la fecha para confirmar" };
  return e.issues.map((i) => {
    const campo = String(i.path[0] ?? "");
    return `${nombre[campo] ? `En ${nombre[campo]}: ` : ""}${i.message}`;
  });
}

export interface Revision {
  pedido: Pedido;
  /** Hubo una respuesta nueva y se hizo o actualizó la invitación. */
  nueva: boolean;
}

/** Lee la última respuesta del formulario y, si es nueva, arma la invitación. */
export async function revisarPedido(id: string): Promise<Revision> {
  const p = await leerPedido(id);
  const lista = await forms<{ responses?: Respuesta[] }>(`/forms/${encodeURIComponent(p.formId)}/responses`);
  const ultima = (lista.responses ?? []).sort((a, b) => (b.lastSubmittedTime ?? b.createTime ?? "").localeCompare(a.lastSubmittedTime ?? a.createTime ?? ""))[0];
  const revisado = new Date().toISOString();
  const enviada = ultima ? (ultima.lastSubmittedTime ?? ultima.createTime ?? "") : "";
  if (!ultima || (p.respuesta?.id === ultima.responseId && p.respuesta.enviada === enviada)) {
    const sigue = Pedido.parse({ ...p, revisado });
    await guardarPedido(sigue);
    return { pedido: sigue, nueva: false };
  }
  const { entrada, avisos } = entradaDeRespuesta(p, ultima);
  const respuesta = { id: ultima.responseId, enviada };
  const valida = Entrada.safeParse(entrada);
  let siguiente: Pedido;
  if (!valida.success) {
    siguiente = Pedido.parse({ ...p, revisado, respuesta, problemas: problemasDe(valida.error), avisos, borrador: entrada });
  } else {
    // Si la invitación ya existía (el cliente corrigió su respuesta), se actualiza la misma.
    const existe = p.slug ? await leerInvitacion(p.slug).then(() => true, () => false) : false;
    try {
      const guardar = (e: Record<string, unknown>) => guardarInvitacion(e, {}, existe ? p.slug : undefined, { formulario: p.id });
      const { inv, avisos: deConstruir } = await guardar(entrada).catch((e: unknown) => {
        // Una canción que no se reconoce no frena la invitación: sale sin música y con aviso.
        if (!entrada.musicaEnlace || !/enlace de música/.test(String(e))) throw e;
        avisos.push(`No reconocí el enlace de la canción («${String(entrada.musicaEnlace).slice(0, 80)}»): la invitación quedó sin música. Agrégala en «Cambiar datos».`);
        return guardar({ ...entrada, musicaEnlace: undefined });
      });
      siguiente = Pedido.parse({ ...p, revisado, respuesta, slug: inv.slug, problemas: [], avisos: [...avisos, ...deConstruir], borrador: undefined });
    } catch (e) {
      siguiente = Pedido.parse({ ...p, revisado, respuesta, problemas: [e instanceof Error ? e.message : String(e)], avisos, borrador: entrada });
    }
  }
  await guardarPedido(siguiente);
  return { pedido: siguiente, nueva: true };
}

/** Une un pedido con la invitación que se terminó de llenar a mano desde su borrador. */
export async function enlazarPedido(id: string, inv: Invitacion): Promise<void> {
  const p = await leerPedido(id).catch(() => null);
  if (!p) return;
  await guardarPedido(Pedido.parse({ ...p, slug: inv.slug, problemas: [], borrador: undefined }));
}
