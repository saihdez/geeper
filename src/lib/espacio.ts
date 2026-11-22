/**
 * Espacio libre en disco (DSC-05, DSC-06): cuánto queda donde se va a escribir y el aviso antes de bajar,
 * subir o renderizar algo grande.
 *
 * En WSL, `df /` engaña: el disco de Linux es un archivo (ext4.vhdx) que vive en C: y sólo crece mientras
 * quede lugar ahí. Lo que vale es el menor entre lo que dice Linux y lo libre en C: (`/mnt/c`, o
 * `GEEPER_DISCO_WINDOWS` si el disco de WSL se movió a otra unidad). Queda corto por lo que el .vhdx ya
 * tiene reservado y sin usar (unos 14 GiB medidos), que es el lado seguro. Las rutas de `/mnt/<letra>/`
 * son discos de Windows y se miden tal cual.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { faltaParaUsar, MARGEN_DISCO, textoSinEspacio, type MedidaDisco } from "./espacio-texto";
import { esWsl } from "./plataforma";

export type { MedidaDisco } from "./espacio-texto";

type StatFs = (ruta: string) => Promise<{ bavail: number | bigint; bsize: number | bigint; blocks: number | bigint }>;

export interface OpcionesEspacio {
  /** Para las pruebas: cómo leer un disco. */
  statfs?: StatFs;
  /** Para las pruebas: si corre en WSL. */
  wsl?: boolean;
  /** Dónde está montado el disco de Windows que guarda el de Linux (por omisión /mnt/c). */
  montajeWindows?: string;
}

const statfsNode: StatFs = (r) => fs.statfs(r);

/** La carpeta existente más cercana (lo que se va a crear todavía no existe). */
async function existente(ruta: string): Promise<string> {
  let r = path.resolve(ruta);
  for (;;) {
    if (await fs.stat(r).then(() => true, () => false)) return r;
    const arriba = path.dirname(r);
    if (arriba === r) return r;
    r = arriba;
  }
}

async function medir(statfs: StatFs, ruta: string) {
  const s = await statfs(ruta);
  return { libre: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
}

/** Letra del disco: «C:» para /mnt/c/… (WSL) o C:\… (Windows); null si no es de Windows. */
export function letraDe(ruta: string): string | null {
  const wsl = /^\/mnt\/([a-z])(\/|$)/i.exec(ruta);
  if (wsl) return `${wsl[1]!.toUpperCase()}:`;
  const win = /^([a-z]):[\\/]?/i.exec(ruta);
  return win ? `${win[1]!.toUpperCase()}:` : null;
}

/** Cuánto queda libre donde se va a escribir `ruta` (aunque todavía no exista). */
export async function espacioLibre(ruta: string, o: OpcionesEspacio = {}): Promise<MedidaDisco> {
  const statfs = o.statfs ?? statfsNode;
  const donde = await existente(ruta);
  const propio = await medir(statfs, donde);
  const letra = letraDe(donde);
  const wsl = o.wsl ?? esWsl();
  if (wsl && !letra) {
    const montaje = o.montajeWindows ?? process.env.GEEPER_DISCO_WINDOWS ?? "/mnt/c";
    const windows = await medir(statfs, montaje).catch(() => null);
    if (windows && windows.libre < propio.libre) return { libre: windows.libre, total: propio.total, disco: letraDe(montaje) ?? "el disco", enWindows: true };
  }
  return { ...propio, disco: letra ?? "el disco", enWindows: false };
}

/** Se lanza cuando no alcanza el disco: el mensaje ya es para la persona. */
export class ErrorSinEspacio extends Error {
  constructor(
    mensaje: string,
    readonly medida: MedidaDisco,
    readonly necesario: number,
  ) {
    super(mensaje);
    this.name = "ErrorSinEspacio";
  }
}

/** Margen configurable (`GEEPER_MARGEN_DISCO_GB`); por omisión, 20 GB. */
export function margenDisco(env: Record<string, string | undefined> = process.env): number {
  const gb = Number(env.GEEPER_MARGEN_DISCO_GB);
  return Number.isFinite(gb) && gb >= 0 && env.GEEPER_MARGEN_DISCO_GB !== "" ? gb * 1e9 : MARGEN_DISCO;
}

/**
 * Antes de escribir algo grande: lanza `ErrorSinEspacio` si, después de escribir `necesario` bytes en
 * `ruta`, quedaría menos que la reserva. `para` dice qué se quería hacer («bajar los modelos»).
 * Devuelve lo medido, por si sirve para el registro.
 */
export async function exigirEspacio(ruta: string, necesario: number, para: string, o: OpcionesEspacio & { margen?: number } = {}): Promise<MedidaDisco> {
  const m = await espacioLibre(ruta, o);
  const margen = o.margen ?? margenDisco();
  if (faltaParaUsar(m, necesario, margen) > 0) throw new ErrorSinEspacio(textoSinEspacio(m, necesario, para, margen), m, necesario);
  return m;
}
