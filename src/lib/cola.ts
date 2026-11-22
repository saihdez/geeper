/**
 * Cola de trabajos en SQLite, con lease.
 *
 * Estados: pendiente → corriendo → hecho | fallido | interrumpido | cancelado.
 * - Un ejecutor por motor reclama con un UPDATE condicionado (sólo si sigue «pendiente»).
 * - El latido renueva el lease; si la persona cancela, el latido lo nota y aborta el trabajo.
 * - Al terminar, en la misma transacción se marca «hecho» y se encola el siguiente de la cadena.
 * - Un trabajo «hecho» no se relanza (así la cadena nunca se bifurca); se relanzan los fallidos,
 *   interrumpidos o cancelados, y conservan su payload (p. ej. el task_id de MPT ya pedido).
 */
import os from "node:os";
import { db } from "./db";
import { detectarReinicio, type Reinicio } from "./reinicio";

export const LEASE_MS = 90_000;
export const LATIDO_MS = 15_000;

export const TIPOS = {
  "mpt.generar": { motor: "mpt", usaGpu: true, nombre: "Generar con MPT" },
  "proyecto.importar": { motor: "voz", usaGpu: false, nombre: "Importar y alinear" },
  "clip.momentos": { motor: "voz", usaGpu: false, nombre: "Buscar momentos de una fuente" },
  "clip.importar": { motor: "voz", usaGpu: false, nombre: "Importar clip de material largo" },
  "visual.reencuadrar": { motor: "voz", usaGpu: false, nombre: "Reencuadrar siguiendo la cara" },
  "demo.crear": { motor: "voz", usaGpu: false, nombre: "Demo de una página web" },
  // Con Kokoro va en CPU. Con una voz diseñada (VoxCPM2) espera la tarjeta: el ejecutor lo pasa a la fila
  // «tarjeta» (CambiarDeFila) para no frenar lo de CPU de esta fila (GPU-06).
  "voz.regenerar": { motor: "voz", usaGpu: false, nombre: "Regenerar voz" },
  // Fila «tarjeta» (GPU-06): esperan su turno en el gpu-lock (Gemma, VoxCPM2 ~6 GB). En la fila «voz»
  // frenaban importar, clips, reencuadres y demos mientras esperaban; aquí sólo se esperan entre ellos.
  "proyecto.traducir": { motor: "tarjeta", usaGpu: true, nombre: "Versión en otro idioma" },
  "voz.disenar": { motor: "tarjeta", usaGpu: true, nombre: "Diseñar una voz" },
  // Casi 16 GB de VRAM con gpu-solo: en la fila de MPT y Wan, que también usan toda la GPU.
  "efecto.generar": { motor: "mpt", usaGpu: true, nombre: "Crear efecto de sonido" },
  // Los sonidos listos que faltan, todos con una sola carga del modelo (GPU-05; worker/preparar-efectos.ts).
  "efectos.preparar": { motor: "mpt", usaGpu: true, nombre: "Preparar los sonidos listos" },
  // Mismo motor que MPT: los dos usan toda la GPU y así nunca corren a la vez.
  "plano.generar": { motor: "mpt", usaGpu: true, nombre: "Animar escena" },
  // Avatares (Wan2GP): también toda la GPU, en la misma fila.
  "avatar.proponer": { motor: "mpt", usaGpu: true, nombre: "Crear avatar" },
  "avatar.retocar": { motor: "mpt", usaGpu: true, nombre: "Retocar avatar" },
  "presentador.generar": { motor: "mpt", usaGpu: true, nombre: "Presentador (avatar que habla)" },
  "avatar.actuar": { motor: "mpt", usaGpu: true, nombre: "Tu avatar en una escena" },
  "avatar.streamer": { motor: "mpt", usaGpu: true, nombre: "Tu avatar como streamer" },
  // Después de importar un video nuevo con avatar: lo pone en las escenas propuestas (actuar.ts).
  "avatar.escenas": { motor: "mpt", usaGpu: true, nombre: "Tu avatar en el video nuevo" },
  // Video nuevo «Equilibrado» o «Lo más real posible»: anima cada escena con Wan (animar-escenas.ts).
  "escenas.animar": { motor: "mpt", usaGpu: true, nombre: "Animando las escenas" },
  "escena.rehacer": { motor: "mpt", usaGpu: true, nombre: "Rehacer la toma" },
  // ComfyUI (sección Workflows): toda la GPU, en la misma fila.
  "workflow.correr": { motor: "mpt", usaGpu: true, nombre: "Workflow de ComfyUI" },
  "render.entregar": { motor: "render", usaGpu: true, nombre: "Render y QC" },
  "publicar.subir": { motor: "red", usaGpu: false, nombre: "Publicar en red" },
} as const;
export type TipoTrabajo = keyof typeof TIPOS;
export const MOTORES = ["mpt", "voz", "render", "red", "tarjeta"] as const;
export type Motor = (typeof MOTORES)[number];

export type Payload = Record<string, unknown> & { cadena?: TipoTrabajo[] };

/**
 * Veces que un trabajo de CPU puede empezar antes de que, si el worker vuelve a caerse con él a medias,
 * quede «interrumpido» en vez de volver a la cola (WRK-09). Sin tope, uno que tumbe el worker se repetía
 * sin fin (y en desarrollo dev-up apagaba la web a la sexta caída).
 */
export const MAX_INTENTOS = 2;
export const CORTADO_DOS_VECES = "Se cortó dos veces. Revísalo antes de relanzar.";

export async function encolar(proyectoId: string | null, tipo: TipoTrabajo, payload: Payload, prioridad = 0) {
  const t = TIPOS[tipo];
  return db.trabajo.create({
    data: { proyectoId, tipo, motor: t.motor, usaGpu: t.usaGpu, payload: payload as object, prioridad, maxIntentos: MAX_INTENTOS },
  });
}

export async function reclamar(motor: Motor, workerId: string) {
  const candidatos = await db.trabajo.findMany({
    where: { motor, estado: "pendiente", OR: [{ noAntesDe: null }, { noAntesDe: { lte: new Date() } }] },
    orderBy: [{ prioridad: "desc" }, { creado: "asc" }],
    take: 5,
  });
  for (const c of candidatos) {
    const r = await db.trabajo.updateMany({
      where: { id: c.id, estado: "pendiente" },
      data: {
        estado: "corriendo",
        noAntesDe: null,
        workerId,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        intentos: { increment: 1 },
        iniciado: new Date(),
        terminado: null,
        error: null,
        etapa: "Empezando",
        progreso: 0,
      },
    });
    if (r.count === 1) return db.trabajo.findUniqueOrThrow({ where: { id: c.id } });
  }
  return null;
}

/** Renueva el lease. Devuelve false si el trabajo ya no es nuestro (cancelado o recuperado). */
export async function latido(id: string, workerId: string): Promise<boolean> {
  const r = await db.trabajo.updateMany({
    where: { id, workerId, estado: "corriendo" },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  return r.count === 1;
}

export async function marcarEtapa(id: string, etapa: string, progreso: number) {
  await db.trabajo.updateMany({ where: { id, estado: "corriendo" }, data: { etapa, progreso } });
}

export async function guardarPayload(id: string, payload: Payload) {
  await db.trabajo.update({ where: { id }, data: { payload: payload as object } });
}

export async function terminar(
  id: string,
  workerId: string,
  resultado: unknown,
  siguiente?: { tipo: TipoTrabajo; payload: Payload; proyectoId: string | null },
) {
  await db.$transaction(async (tx) => {
    const r = await tx.trabajo.updateMany({
      where: { id, workerId, estado: "corriendo" },
      data: { estado: "hecho", resultado: (resultado ?? null) as object, terminado: new Date(), progreso: 1, etapa: "Terminado", leaseUntil: null },
    });
    if (r.count !== 1) return; // cancelado mientras tanto: no se encadena
    if (siguiente) {
      const t = TIPOS[siguiente.tipo];
      await tx.trabajo.create({
        data: {
          proyectoId: siguiente.proyectoId,
          tipo: siguiente.tipo,
          motor: t.motor,
          usaGpu: t.usaGpu,
          payload: siguiente.payload as object,
          maxIntentos: MAX_INTENTOS,
        },
      });
    }
  });
}

export async function fallar(id: string, workerId: string, error: string, estado: "fallido" | "interrumpido" = "fallido") {
  await db.trabajo.updateMany({
    where: { id, workerId, estado: "corriendo" },
    data: { estado, error: error.slice(0, 8000), terminado: new Date(), leaseUntil: null },
  });
}

/**
 * Devuelve un trabajo corriendo a la cola sin gastar el intento: no se toma antes de `hasta`.
 * Lo usan los ejecutores que esperan algo externo (el VPN, la cuota diaria de una red).
 */
export async function esperar(id: string, workerId: string, hasta: Date, etapa: string): Promise<boolean> {
  const r = await db.trabajo.updateMany({
    where: { id, workerId, estado: "corriendo" },
    data: { estado: "pendiente", noAntesDe: hasta, workerId: null, leaseUntil: null, etapa, intentos: { decrement: 1 } },
  });
  return r.count === 1;
}

/**
 * Pasa un trabajo corriendo a otra fila sin gastar el intento (GPU-06): p. ej. «Regenerar voz» con una voz
 * diseñada, que en la fila «voz» frenaría lo de CPU mientras espera la tarjeta. Queda «pendiente» allí.
 */
export async function cambiarDeFila(id: string, workerId: string, motor: Motor, etapa: string): Promise<boolean> {
  const r = await db.trabajo.updateMany({
    where: { id, workerId, estado: "corriendo" },
    data: { estado: "pendiente", motor, usaGpu: motor === "tarjeta" || motor === "mpt", workerId: null, leaseUntil: null, etapa, intentos: { decrement: 1 } },
  });
  return r.count === 1;
}

/** Lo que lanza un ejecutor para que el worker llame a `cambiarDeFila` (GPU-06). */
export class CambiarDeFila extends Error {
  constructor(public motor: Motor, public etapa: string) {
    super(etapa);
    this.name = "CambiarDeFila";
  }
}

/** Lo que lanza un ejecutor para que el worker llame a `esperar` en vez de marcarlo fallido. */
export class Espera extends Error {
  constructor(public hasta: Date, public etapa: string) {
    super(etapa);
    this.name = "Espera";
  }
}

export async function relanzar(id: string) {
  const r = await db.trabajo.updateMany({
    where: { id, estado: { in: ["fallido", "interrumpido", "cancelado"] } },
    data: { estado: "pendiente", intentos: 0, error: null, leaseUntil: null, noAntesDe: null, workerId: null, etapa: "En cola", progreso: 0 },
  });
  if (r.count !== 1) throw new Error("Sólo se relanzan trabajos fallidos, interrumpidos o cancelados");
}

export async function cancelar(id: string) {
  const r = await db.trabajo.updateMany({
    where: { id, estado: { in: ["pendiente", "corriendo"] } },
    data: { estado: "cancelado", terminado: new Date(), leaseUntil: null, error: "Cancelado por la persona" },
  });
  if (r.count !== 1) throw new Error("Sólo se cancelan trabajos pendientes o corriendo");
}

const CLAVE_LATIDO = "worker.latido";

export async function guardarLatidoWorker() {
  const valor = new Date().toISOString();
  await db.sistema.upsert({ where: { clave: CLAVE_LATIDO }, create: { clave: CLAVE_LATIDO, valor }, update: { valor } });
}

export async function ultimoLatidoWorker(): Promise<Date | null> {
  const f = await db.sistema.findUnique({ where: { clave: CLAVE_LATIDO } });
  return f ? new Date(f.valor) : null;
}

/**
 * Al arrancar el worker: si Windows se reinició desde el último latido, todo lo que estaba
 * «corriendo» pasa a «interrumpido». Si no, los de lease vencido: los de GPU a «interrumpido»
 * (nunca se reintentan solos) y los demás vuelven a «pendiente», salvo que ya hayan empezado
 * `maxIntentos` veces: entonces quedan «interrumpidos» (WRK-09).
 */
export async function recuperarAlArrancar(): Promise<{ reinicio: Reinicio; interrumpidos: number; reencolados: number }> {
  const reinicio = await detectarReinicio(await ultimoLatidoWorker());
  const ahora = new Date();
  const corriendo = await db.trabajo.findMany({ where: { estado: "corriendo" } });
  let interrumpidos = 0;
  let reencolados = 0;
  for (const t of corriendo) {
    const vencido = !t.leaseUntil || t.leaseUntil < ahora;
    if (!reinicio.hubo && !vencido) continue; // otro worker vivo lo tiene
    if (reinicio.hubo || t.usaGpu) {
      await db.trabajo.update({
        where: { id: t.id },
        data: {
          estado: "interrumpido",
          leaseUntil: null,
          terminado: ahora,
          error: reinicio.hubo ? `Interrumpido: ${reinicio.motivo}. Relánzalo cuando quieras.` : "Interrumpido: el worker se detuvo a mitad. Relánzalo cuando quieras.",
        },
      });
      interrumpidos++;
    } else if (agotado(t)) {
      await db.trabajo.update({ where: { id: t.id }, data: { estado: "interrumpido", leaseUntil: null, terminado: ahora, error: CORTADO_DOS_VECES } });
      interrumpidos++;
    } else {
      await db.trabajo.update({ where: { id: t.id }, data: { estado: "pendiente", leaseUntil: null, workerId: null, etapa: "En cola (recuperado)" } });
      reencolados++;
    }
  }
  return { reinicio, interrumpidos, reencolados };
}

/** Ya empezó tantas veces como permite su fila (`maxIntentos`). */
function agotado(t: { intentos: number; maxIntentos: number }): boolean {
  return t.intentos >= t.maxIntentos;
}

export function nuevoWorkerId(): string {
  return `${os.hostname()}:${process.pid}:${Date.now().toString(36)}`;
}

/**
 * Durante la marcha: trabajos «corriendo» cuyo lease venció (su worker murió sin avisar, p. ej. kill -9).
 * Los de GPU quedan «interrumpidos» (los relanza la persona); los demás vuelven a la cola hasta
 * `maxIntentos` veces (WRK-09).
 */
export async function recuperarVencidos(): Promise<number> {
  const vencidos = await db.trabajo.findMany({ where: { estado: "corriendo", leaseUntil: { lt: new Date() } } });
  for (const t of vencidos) {
    await db.trabajo.updateMany({
      where: { id: t.id, estado: "corriendo", leaseUntil: { lt: new Date() } },
      data: t.usaGpu
        ? { estado: "interrumpido", leaseUntil: null, terminado: new Date(), error: "Interrumpido: el worker que lo corría dejó de responder. Relánzalo cuando quieras." }
        : agotado(t)
          ? { estado: "interrumpido", leaseUntil: null, terminado: new Date(), error: CORTADO_DOS_VECES }
          : { estado: "pendiente", leaseUntil: null, workerId: null, etapa: "En cola (recuperado)" },
    });
  }
  return vencidos.length;
}
