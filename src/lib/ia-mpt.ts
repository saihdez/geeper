/**
 * La IA de MPT (Ollama y el servidor de imágenes) vive en contenedores que `gpu-solo` apaga mientras otro
 * trabajo usa toda la tarjeta y vuelve a encender al terminar. Si ese trabajo se cortó (reinicio de
 * Windows, worker caído), quedan apagados y nada los enciende (GPU-02). Esta función los enciende.
 *
 * Sólo se llama con el candado de la tarjeta tomado: así nadie los tiene apagados a propósito en ese
 * momento. No se fía de la nota de gpu-solo (la borra si arranca con ellos ya parados): mira su estado.
 */
import { correr } from "./proceso";

export const OLLAMA_MPT = "mpt-ollama";
export const IMAGENES_MPT = "mpt-image-server";
export const CONTENEDORES_IA_MPT = [OLLAMA_MPT, IMAGENES_MPT] as const;

export interface OpcionesEncender {
  contenedores?: readonly string[];
  log?: (l: string) => void;
  /** Para las pruebas: otro binario en lugar de `docker`. */
  docker?: string;
  /** Cuánto esperar a que Ollama responda tras encenderlo (ms). */
  esperarMs?: number;
}

export interface Encendido {
  /** Los que estaban parados y se encendieron. */
  encendidos: string[];
  /** Los que no existen en esta PC (MPT sin instalar o sin ese servicio). */
  faltan: string[];
  /** Si Docker no respondió. */
  sinDocker?: boolean;
}

/** Enciende los contenedores de la IA de MPT que estén parados y espera a que Ollama responda. */
export async function encenderIaMpt(op: OpcionesEncender = {}): Promise<Encendido> {
  const docker = op.docker ?? "docker";
  const r: Encendido = { encendidos: [], faltan: [] };
  for (const c of op.contenedores ?? CONTENEDORES_IA_MPT) {
    let estado;
    try {
      estado = await correr(docker, ["inspect", "-f", "{{.State.Running}}", c], { permitirFallo: true, timeout: 15_000 });
    } catch {
      return { ...r, sinDocker: true };
    }
    if (estado.codigo !== 0) {
      const err = estado.stderr.toLowerCase();
      if (err.includes("no such")) r.faltan.push(c);
      else return { ...r, sinDocker: true };
      continue;
    }
    if (estado.stdout.trim() === "true") continue;
    op.log?.(`La IA de MPT (${c}) estaba apagada: se enciende`);
    const s = await correr(docker, ["start", c], { permitirFallo: true, timeout: 60_000 }).catch(() => null);
    if (s?.codigo === 0) r.encendidos.push(c);
  }
  if (r.encendidos.includes(OLLAMA_MPT)) {
    const limite = Date.now() + (op.esperarMs ?? 30_000);
    while (Date.now() < limite) {
      const l = await correr(docker, ["exec", OLLAMA_MPT, "ollama", "list"], { permitirFallo: true, timeout: 10_000 }).catch(() => null);
      if (l?.codigo === 0) break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
  return r;
}
