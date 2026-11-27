/**
 * Lugar para Wan2GP en la app de escritorio. En WSL, `gpu-solo` para los contenedores de MoneyPrinterTurbo
 * que ocupan memoria (Ollama y el servidor de imágenes) mientras corre Wan, y los vuelve a levantar. En
 * Windows ese script no existe: sin esto, los dos contenedores retienen ~22 GB de RAM (14 del servidor de
 * imágenes, 8 de Ollama, medido el 2026-11-22) y Wan2GP se queda «Cargando el modelo» paginando a disco.
 *
 * - `pausarParaWan`: para los que estén corriendo y anota cuáles (en un archivo, por si el worker muere).
 * - `reanudarLuego`: los vuelve a levantar después de un rato sin Wan; un trabajo con varios pasos de Wan
 *   seguidos (avatar: pose → cuadro → hablar) no los levanta y para en cada paso (el servidor de imágenes
 *   tarda en cargar sus 14 GB).
 * - `asegurarMpt`: antes de pedirle algo a MPT, los levanta ya.
 * - `reanudarPendientes`: al arrancar el worker, levanta lo que quedó parado por un corte.
 *
 * Nunca falla por Docker: si no está o no responde, Wan corre igual (como antes).
 *
 * Sólo en la app de escritorio (GEEPER_ESCRITORIO=1): en desarrollo y en las pruebas no se toca Docker. Una
 * prueba que llegaba a Wan paraba los contenedores reales y anotaba la nota en su carpeta temporal, así que
 * nadie los volvía a levantar (pasó el 2026-11-22). Las pruebas de este archivo lo prenden con
 * GEEPER_LIBERAR_MPT=1 y un Docker simulado.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { correr } from "./proceso";
import { dirDatos } from "./rutas";

export const CONTENEDORES_MPT_PESADOS = ["mpt-ollama", "mpt-image-server"] as const;
/** Cuánto se espera sin Wan antes de volver a levantarlos. */
export const ESPERA_REANUDAR_MS = 3 * 60_000;

const nota = () => path.join(dirDatos(), ".mpt-pausados.json");
/** Se lee en cada llamada (no al importar): la carcasa y las pruebas fijan las variables antes. */
export const liberarMptActivo = () => process.env.GEEPER_ESCRITORIO === "1" || process.env.GEEPER_LIBERAR_MPT === "1";

interface Estado { timer?: ReturnType<typeof setTimeout> }
const g = globalThis as typeof globalThis & { __liberarMpt?: Estado };
const estado = (g.__liberarMpt ??= {});

async function docker(args: string[]): Promise<{ codigo: number; salida: string } | null> {
  const r = await correr("docker", args, { permitirFallo: true, timeout: 60_000 }).catch(() => null);
  return r ? { codigo: r.codigo, salida: r.stdout } : null;
}

async function leerNota(): Promise<string[]> {
  return fs.readFile(nota(), "utf8").then((t) => (JSON.parse(t) as string[]).filter((c) => (CONTENEDORES_MPT_PESADOS as readonly string[]).includes(c)), () => []);
}
async function escribirNota(lista: string[]) {
  if (!lista.length) return fs.rm(nota(), { force: true });
  await fs.mkdir(dirDatos(), { recursive: true });
  await fs.writeFile(nota(), JSON.stringify(lista));
}

/** Para los contenedores pesados de MPT que estén corriendo. Devuelve los que paró. */
export async function pausarParaWan(log?: (l: string) => void): Promise<string[]> {
  if (!liberarMptActivo()) return [];
  clearTimeout(estado.timer);
  const pausados = await leerNota();
  for (const c of CONTENEDORES_MPT_PESADOS) {
    const r = await docker(["inspect", "-f", "{{.State.Running}}", c]);
    if (r?.codigo !== 0 || !r.salida.includes("true")) continue;
    const s = await docker(["stop", "-t", "10", c]);
    if (s?.codigo === 0 && !pausados.includes(c)) pausados.push(c);
  }
  await escribirNota(pausados).catch(() => {});
  if (pausados.length) log?.(`Pausado ${pausados.join(" y ")} de MoneyPrinterTurbo para dejarle la memoria a Wan2GP (vuelven solos al terminar).`);
  return pausados;
}

/**
 * Levanta ya lo que se paró. Con `todos` (antes de pedirle un video a MPT, que los necesita), también los
 * que estén parados por otra cosa: un `docker stop` a mano o un corte con `unless-stopped` los deja
 * parados para siempre y MPT falla sin guion ni imágenes.
 */
export async function asegurarMpt(log?: (l: string) => void, { todos = false } = {}): Promise<void> {
  if (!liberarMptActivo()) return;
  clearTimeout(estado.timer);
  const pausados = await leerNota();
  if (todos) {
    for (const c of CONTENEDORES_MPT_PESADOS) {
      if (pausados.includes(c)) continue;
      const r = await docker(["inspect", "-f", "{{.State.Running}}", c]);
      if (r?.codigo === 0 && r.salida.includes("false")) pausados.push(c);
    }
  }
  if (!pausados.length) return;
  const quedan: string[] = [];
  for (const c of pausados) {
    const r = await docker(["start", c]);
    if (r?.codigo !== 0) quedan.push(c);
  }
  await escribirNota(quedan).catch(() => {});
  log?.(`MoneyPrinterTurbo de vuelta: ${pausados.filter((c) => !quedan.includes(c)).join(", ") || "nada"}.`);
}

/**
 * La API de MPT (y su web) montan archivos de WSL: cuando WSL se reinicia, se caen (código 127) y Docker
 * no las vuelve a levantar. Antes de pedirle algo a MPT se levantan las que estén paradas. Sólo la API y
 * su web: los pesados (IA e imágenes, ~22 GB de RAM) los enciende crearVideo con el candado de la tarjeta
 * tomado, para no despertarlos mientras Wan usa la tarjeta. Devuelve las que levantó.
 */
export const CONTENEDORES_MPT_API = ["moneyprinterturbo-api", "moneyprinterturbo-webui"] as const;
export async function levantarMptCaido(log?: (l: string) => void): Promise<string[]> {
  if (!liberarMptActivo()) return [];
  const levantados: string[] = [];
  for (const c of CONTENEDORES_MPT_API) {
    const r = await docker(["inspect", "-f", "{{.State.Running}}", c]);
    if (r?.codigo !== 0 || !r.salida.includes("false")) continue;
    if ((await docker(["start", c]))?.codigo === 0) levantados.push(c);
  }
  // Lo que estaba anotado como pausado por Wan ya está arriba.
  if (levantados.length) await escribirNota((await leerNota()).filter((c) => !levantados.includes(c))).catch(() => {});
  if (levantados.length) log?.(`MoneyPrinterTurbo estaba parado: levanté ${levantados.join(", ")}.`);
  return levantados;
}

/** Los levanta después de un rato sin Wan (si antes empieza otro paso de Wan, no). */
export function reanudarLuego(ms = ESPERA_REANUDAR_MS) {
  clearTimeout(estado.timer);
  if (!existsSync(nota())) return;
  estado.timer = setTimeout(() => void asegurarMpt().catch(() => {}), ms);
  estado.timer.unref?.();
}

/** Al arrancar el worker: lo que quedó parado por un corte vuelve. */
export const reanudarPendientes = () => asegurarMpt().catch(() => {});
