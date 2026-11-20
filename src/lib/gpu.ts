/**
 * Candado de GPU compartido con el estudio (~/dev/video-tools/bin/gpu-lock, flock): un trabajo de
 * GPU a la vez entre MPT, OpenMontage, Wan y Geeper. Geeper lanza `gpu-lock bash -c 'echo LISTO; read'`
 * y retiene el candado mientras el stdin de ese proceso siga abierto; si el worker muere, el stdin se
 * cierra, `read` termina y el kernel suelta el flock.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { GPU_LOCK_BIN } from "./rutas";
import { enSpan } from "./trazas";

export interface Candado {
  liberar(): void;
}

export interface OpcionesCandado {
  /** Si es false y la GPU está ocupada, devuelve null en vez de esperar. */
  esperar: boolean;
  /** Se llama cada vez que gpu-lock avisa que está esperando. */
  alEsperar?: (quien: string) => void;
  signal?: AbortSignal;
}

/** Toma el candado; la espera queda en la traza (`geeper.gpu.espera_ms`). */
export function tomarGpu(descripcion: string, op: OpcionesCandado): Promise<Candado | null> {
  const t0 = Date.now();
  let ocupadaPor = "";
  return enSpan("gpu-lock", { "geeper.gpu.para": descripcion, "geeper.gpu.esperar": op.esperar }, async (span) => {
    const c = await tomarGpuSinTraza(descripcion, {
      ...op,
      alEsperar: (quien) => {
        ocupadaPor = quien;
        op.alEsperar?.(quien);
      },
    });
    span.setAttributes({ "geeper.gpu.espera_ms": Date.now() - t0, "geeper.gpu.obtenida": c !== null, ...(ocupadaPor ? { "geeper.gpu.ocupada_por": ocupadaPor } : {}) });
    return c;
  });
}

function tomarGpuSinTraza(descripcion: string, op: OpcionesCandado): Promise<Candado | null> {
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
      } else liberar();
    });
  });
}
