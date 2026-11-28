/** Los trabajos de la cola de una invitación (foto del sobre, fondo realista y QR con dibujo): pedirlos y correrlos. */
import { z } from "zod";
import { encolar } from "../cola";
import { db } from "../db";
import type { Avance } from "../wan2gp";
import { dirInvitacion, leerInvitacion } from "./construir";
import { ajustesFondo, ajustesFoto, arteDe, generarFotos, generarQrArte, type ContextoImagen } from "./imagenes";

export const PedidoImagen = z.discriminatedUnion("que", [
  z.object({ que: z.literal("foto"), descripcion: z.string().trim().max(400).default("") }),
  z.object({ que: z.literal("fondo"), descripcion: z.string().trim().max(400).default("") }),
  // `legible`: el dibujo más suave y el QR más marcado (fuerza 1,5 / ruido 0,85, como sugiere qr-arte).
  z.object({ que: z.literal("qr"), legible: z.boolean().default(false), descripcion: z.string().trim().max(300).default("") }),
]);
export type PedidoImagen = z.infer<typeof PedidoImagen>;

const TIPO = { foto: "invitacion.foto", fondo: "invitacion.fondo", qr: "invitacion.qr" } as const;
const QUE_DE_TIPO: Record<string, TrabajoImagen["que"]> = { [TIPO.foto]: "foto", [TIPO.fondo]: "fondo", [TIPO.qr]: "qr" };

export async function pedirImagen(slug: string, pedido: PedidoImagen) {
  const inv = await leerInvitacion(slug);
  if (pedido.que === "qr" && !inv.urlPublica) throw new Error("Primero publícala y guarda su dirección: el QR la lleva adentro.");
  const enCurso = await trabajosDe(slug);
  if (enCurso.some((t) => t.que === pedido.que && (t.estado === "pendiente" || t.estado === "corriendo"))) throw new Error("Ya se está creando: espera a que termine.");
  return encolar(null, TIPO[pedido.que], { slug, ...pedido });
}

export interface TrabajoImagen {
  id: string;
  que: "foto" | "fondo" | "qr";
  estado: string;
  etapa: string | null;
  progreso: number;
  error: string | null;
}

/** Los trabajos recientes de esta invitación (en curso o que fallaron en la última hora). */
export async function trabajosDe(slug: string): Promise<TrabajoImagen[]> {
  const filas = await db.trabajo.findMany({
    where: { tipo: { in: [TIPO.foto, TIPO.fondo, TIPO.qr] }, OR: [{ estado: { in: ["pendiente", "corriendo"] } }, { estado: { in: ["fallido", "interrumpido"] }, creado: { gt: new Date(Date.now() - 3_600_000) } }] },
    orderBy: { creado: "desc" },
    take: 30,
    select: { id: true, tipo: true, estado: true, etapa: true, progreso: true, error: true, payload: true },
  });
  return filas
    .filter((f) => (f.payload as { slug?: string } | null)?.slug === slug)
    .map((f) => ({ id: f.id, que: QUE_DE_TIPO[f.tipo] ?? "foto", estado: f.estado, etapa: f.etapa, progreso: f.progreso, error: f.error }));
}

const slugDe = (payload: unknown) => z.object({ slug: z.string() }).parse(payload).slug;

export async function generarFotosInvitacion(ctx: { log: (l: string) => void; signal?: AbortSignal; alAvanzar?: (a: Avance) => void }, payload: unknown) {
  const slug = slugDe(payload);
  const p = PedidoImagen.parse(payload);
  const inv = await leerInvitacion(slug);
  const fotos = await generarFotos({ ...ctx, avanzar: () => {} }, dirInvitacion(slug), ajustesFoto(p.descripcion, arteDe(inv)));
  return { slug, fotos };
}

export async function generarFondosInvitacion(ctx: { log: (l: string) => void; signal?: AbortSignal; alAvanzar?: (a: Avance) => void }, payload: unknown) {
  const slug = slugDe(payload);
  const p = PedidoImagen.parse(payload);
  const inv = await leerInvitacion(slug);
  // Sin descripción, usa la idea de tema que escribió la persona.
  const idea = p.descripcion || inv.tema?.idea || "";
  const fondos = await generarFotos({ ...ctx, avanzar: () => {} }, dirInvitacion(slug), ajustesFondo(idea, arteDe(inv)), "fondo");
  return { slug, fondos };
}

export async function generarQrInvitacion(ctx: ContextoImagen, payload: unknown) {
  const slug = slugDe(payload);
  const p = PedidoImagen.parse(payload);
  const inv = await leerInvitacion(slug);
  if (!inv.urlPublica) throw new Error("La invitación no tiene dirección publicada.");
  const legible = p.que === "qr" && p.legible;
  const extra = p.descripcion ? `${p.descripcion}, ` : "";
  return generarQrArte(ctx, dirInvitacion(slug), {
    url: inv.urlPublica,
    prompt: `${extra}${arteDe(inv)}`,
    fuerza: legible ? 1.5 : 1.35,
    ruido: legible ? 0.85 : 0.9,
  });
}
