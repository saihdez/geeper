/**
 * Candado de GPU compartido con el estudio (~/dev/video-tools/bin/gpu-lock, flock): un trabajo de
 * GPU a la vez entre MPT, OpenMontage, Wan y Geeper. Geeper lanza `gpu-lock bash -c 'echo LISTO; read'`
 * y retiene el candado mientras el stdin de ese proceso siga abierto; si el worker muere, el stdin se
 * cierra, `read` termina y el kernel suelta el flock.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { GPU_LOCK_BIN, GPU_LOCK_FILE } from "./rutas";

export interface Candado {
  liberar(): void;
}

export interface OpcionesCandado {
  /** Si es false y la GPU está ocupada, devuelve null en vez de esperar. */
  esperar: boolean;
  /** Se llama cada vez que gpu-lock avisa que está esperando. */
  alEsperar?: (quien: string) => void;
  signal?: AbortSignal;
  /**
   * Por defecto, cancelar suelta el candado. Con false, cancelar sólo corta la espera: una vez tomado, lo
   * suelta quien llama, p. ej. cuando MPT de verdad terminó con lo que tenía en la tarjeta (GPU-03).
   */
  soltarAlCancelar?: boolean;
}

export function tomarGpu(descripcion: string, op: OpcionesCandado): Promise<Candado | null> {
  // Sin el gpu-lock del estudio (Windows, macOS, la app de escritorio): candado propio por archivo.
  if (process.env.GEEPER_GPU_LOCK_PROPIO === "1" || !existsSync(GPU_LOCK_BIN)) return candadoArchivo(GPU_LOCK_FILE, descripcion, op);
  return new Promise((ok, mal) => {
    let hijo: ChildProcess;
    try {
      hijo = spawn(GPU_LOCK_BIN, ["bash", "-c", "echo LISTO; read -r _", `geeper:${descripcion}`], {
        stdio: ["pipe", "pipe", "pipe"],
        // Grupo propio: al rendirse se mata también el `flock` que espera dentro de gpu-lock.
        detached: true,
      });
    } catch (e) {
      mal(e as Error);
      return;
    }
    let resuelto = false;
    const matarGrupo = () => {
      try {
        if (hijo.pid) process.kill(-hijo.pid, "SIGTERM");
      } catch {
        /* ya terminó */
      }
    };
    const liberar = () => {
      hijo.stdin?.end();
      setTimeout(matarGrupo, 3000).unref();
    };
    hijo.stdout?.on("data", (d: Buffer) => {
      if (!resuelto && d.toString().includes("LISTO")) {
        resuelto = true;
        ok({ liberar });
      }
    });
    hijo.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      if (resuelto || !s.includes("ocupada")) return;
      const quien = s.replace(/^.*ocupada por: /s, "").replace(/\. Esperando.*$/s, "").trim();
      if (!op.esperar) {
        resuelto = true;
        matarGrupo();
        ok(null);
      } else op.alEsperar?.(quien);
    });
    hijo.on("error", (e) => {
      if (!resuelto) {
        resuelto = true;
        mal(e);
      }
    });
    hijo.on("close", (codigo) => {
      if (!resuelto) {
        resuelto = true;
        mal(new Error(`gpu-lock terminó sin dar el candado (código ${codigo})`));
      }
    });
    op.signal?.addEventListener("abort", () => {
      if (!resuelto) {
        resuelto = true;
        matarGrupo();
        mal(new Error("Cancelado mientras esperaba la GPU"));
      } else if (op.soltarAlCancelar !== false) liberar();
    });
  });
}

interface DuenoCandado {
  pid: number;
  quien: string;
  desde: string;
}

/** Cada cuánto el dueño renueva el candado, y cuánto sin renovar lo da por abandonado. */
const LATIDO_GPU_MS = 10_000;
const VENCE_GPU_MS = 60_000;

/** Un candado recién creado puede leerse vacío o a medio escribir: hasta esta edad cuenta como ocupado. */
const ESCRIBIENDO_MS = 5000;

/** Lee el dueño del candado; null si no existe o no se puede leer (vacío, a medio escribir, roto). */
async function leerDueno(archivo: string): Promise<DuenoCandado | null> {
  try {
    const d = JSON.parse(await fs.readFile(archivo, "utf8")) as DuenoCandado;
    return d && typeof d.pid === "number" ? d : null;
  } catch {
    return null;
  }
}

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Candado por archivo, para donde no hay gpu-lock: se crea en exclusiva (`wx`), lleva el PID y un
 * latido (la hora de modificación). Si el dueño murió o dejó de latir, se considera abandonado y se toma.
 */
export async function candadoArchivo(archivo: string, descripcion: string, op: OpcionesCandado): Promise<Candado | null> {
  await fs.mkdir(path.dirname(archivo), { recursive: true });
  const yo: DuenoCandado = { pid: process.pid, quien: `geeper:${descripcion}`, desde: new Date().toISOString() };
  for (;;) {
    if (op.signal?.aborted) throw new Error("Cancelado mientras esperaba la GPU");
    try {
      const h = await fs.open(archivo, "wx");
      await h.writeFile(JSON.stringify(yo));
      await h.close();
      const latido = setInterval(() => {
        const ahora = new Date();
        void fs.utimes(archivo, ahora, ahora).catch(() => {});
      }, LATIDO_GPU_MS);
      latido.unref();
      let suelto = false;
      const liberar = () => {
        if (suelto) return;
        suelto = true;
        clearInterval(latido);
        void (async () => {
          // Sólo se borra si sigue siendo nuestro.
          const d = await leerDueno(archivo);
          if (d?.pid === yo.pid && d.desde === yo.desde) await fs.rm(archivo, { force: true });
        })().catch(() => {});
      };
      if (op.soltarAlCancelar !== false) op.signal?.addEventListener("abort", liberar, { once: true });
      return { liberar };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const [dueno, st] = await Promise.all([leerDueno(archivo), fs.stat(archivo).catch(() => null)]);
    if (!st) continue; // se soltó entre medio
    const edad = Date.now() - st.mtimeMs;
    // Ilegible y recién creado: otro lo está escribiendo (antes daba «Unexpected end of JSON input»).
    const abandonado = dueno ? !vivo(dueno.pid) || edad > VENCE_GPU_MS : edad > ESCRIBIENDO_MS;
    if (abandonado) {
      await fs.rm(archivo, { force: true });
      continue;
    }
    if (!op.esperar) return null;
    op.alEsperar?.(dueno?.quien ?? "otro trabajo");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
