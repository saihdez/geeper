import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import path from "node:path";

export interface Registro {
  (linea: string): void;
}

export interface Resultado {
  codigo: number;
  stdout: string;
  stderr: string;
}

export class ErrorDeComando extends Error {
  constructor(
    public readonly comando: string,
    public readonly resultado: Resultado,
  ) {
    const cola = (resultado.stderr || resultado.stdout).trim().split("\n").slice(-12).join("\n");
    super(`Falló (${resultado.codigo}): ${comando}\n${cola}`);
  }
}

export interface OpcionesCorrer extends Pick<SpawnOptions, "cwd"> {
  env?: Record<string, string>;
  log?: Registro;
  /** No lanzar error si el código de salida no es 0. */
  permitirFallo?: boolean;
  /**
   * Señal para cancelar (mata el proceso). Si no se pasa, vale la del trabajo en curso (`enTrabajo`), así
   * cancelar llega también a los ffmpeg y ffprobe de las funciones que no la reciben. `null`: no cancelar
   * nunca (limpiezas que deben correr aunque el trabajo se haya cancelado).
   */
  signal?: AbortSignal | null;
  /** Límite en ms. */
  timeout?: number;
  /** Guardar stdout completo (si no, sólo los últimos 2 MB). */
  entrada?: string;
}

const MAX = 2_000_000;

/** ¿Es un intérprete de Python? (python, python3, python3.12, python.exe). */
export const esPython = (cmd: string) => /^python(\d+(\.\d+)?)?(\.exe)?$/i.test(cmd.split(/[\\/]/).pop() ?? "");

/**
 * Python siempre en UTF-8: en Windows escribe en la página de códigos del sistema y las tildes que
 * devuelve (subtítulos alineados, mensajes) llegarían rotas. `-X utf8` vale aunque vaya `-I` (que ignora
 * las variables PYTHON*); la variable cubre a los Python que lance ese Python.
 */
export function argsPython(cmd: string, args: string[]): string[] {
  return esPython(cmd) && !args.includes("utf8") ? ["-X", "utf8", ...args] : args;
}

const trabajo = new AsyncLocalStorage<{ signal: AbortSignal }>();

/** Corre `fn` como parte de un trabajo: todo `correr()` que haga sin señal propia usa `signal` (WRK-05). */
export function enTrabajo<T>(signal: AbortSignal, fn: () => T): T {
  return trabajo.run({ signal }, fn);
}

/** La señal de cancelar del trabajo en curso, si se corre dentro de uno. */
export const senalDelTrabajo = (): AbortSignal | undefined => trabajo.getStore()?.signal;

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patrón de `pkill -f` para los procesos lanzados con ese intérprete (su línea de comando empieza por él). */
export const patronComando = (cmd: string) => `^${escaparRegex(cmd)}( |$)`;

const grupoVivo = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

export interface OpcionesMatar {
  /** Cuánto se espera tras SIGTERM antes de SIGKILL (ms). */
  graciaMs?: number;
  /**
   * Con gpu-solo, el SIGKILL va sólo a los procesos del grupo que calcen con este patrón (`pkill -f`):
   * matar el bash de gpu-solo antes de su `trap` dejaría detenida la IA de MPT.
   */
  patronDuro?: string;
}

/**
 * Corta un proceso lanzado con `detached` (grupo propio en POSIX) y todo lo que lanzó: npx, gpu-lock y
 * gpu-solo lanzan a su vez al que hace el trabajo, y la señal al hijo directo no le llegaba (WRK-03).
 * SIGTERM a todo el grupo; si a los `graciaMs` el grupo sigue vivo (se mira el grupo, no el hijo directo,
 * que suele ser un envoltorio que ya murió), SIGKILL. En Windows, `taskkill /T /F` sobre el árbol.
 */
export function matarArbol(hijo: ChildProcess, op: OpcionesMatar = {}): void {
  const pid = hijo.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    if (hijo.exitCode === null && hijo.signalCode === null) spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
    return;
  }
  if (!grupoVivo(pid)) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* ya terminó */
  }
  setTimeout(() => {
    if (!grupoVivo(pid)) return;
    if (op.patronDuro) {
      spawn("pkill", ["-KILL", "-g", String(pid), "-f", op.patronDuro], { stdio: "ignore" }).on("error", () => {});
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* ya terminó */
    }
  }, op.graciaMs ?? 5000).unref();
}

/** Si el comando pasa por gpu-solo, el patrón del que corre dentro (lo único que puede recibir SIGKILL). */
function patronTrasGpuSolo(partes: string[]): string | undefined {
  const i = partes.findIndex((a) => path.basename(a) === "gpu-solo");
  if (i < 0) return undefined;
  const dentro = partes[i + 1];
  // Sin comando reconocible no se manda SIGKILL a nadie: un patrón imposible.
  return dentro ? patronComando(dentro) : "^$^";
}

const errorCancelado = () => Object.assign(new Error("Cancelado"), { name: "AbortError", code: "ABORT_ERR" });

/** Tras matar el árbol, si un nieto escapado del grupo sigue con la salida abierta, no se espera más que esto. */
const ESPERA_TRAS_SALIR_MS = 2000;

/** Corre un comando sin shell, registra su salida línea por línea y devuelve stdout/stderr. */
export function correr(cmd: string, argsPedidos: string[], op: OpcionesCorrer = {}): Promise<Resultado> {
  const args = argsPython(cmd, argsPedidos);
  const texto = [cmd, ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");
  op.log?.(`$ ${texto}`);
  const senal = op.signal === null ? undefined : (op.signal ?? senalDelTrabajo());
  if (senal?.aborted) return Promise.reject(errorCancelado());
  // Sólo lo que se puede cortar va en grupo propio: así cancelar o el límite llegan a todo el árbol.
  const cortable = !!senal || !!op.timeout;
  return new Promise((ok, mal) => {
    const hijo = spawn(cmd, args, {
      cwd: op.cwd,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...op.env },
      stdio: [op.entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: cortable && process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let cortado: "cancelado" | "tiempo" | null = null;
    let listo = false;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const cortar = (por: "cancelado" | "tiempo") => {
      if (cortado || listo || hijo.exitCode !== null || hijo.signalCode !== null) return;
      cortado = por;
      op.log?.(por === "cancelado" ? "(cancelado: se detiene el comando y lo que lanzó)" : `(pasó el límite de ${Math.round((op.timeout ?? 0) / 1000)} s: se detiene)`);
      matarArbol(hijo, { patronDuro: patronTrasGpuSolo([cmd, ...args]) });
    };
    const alCancelar = () => cortar("cancelado");
    senal?.addEventListener("abort", alCancelar, { once: true });
    if (op.timeout) reloj = setTimeout(() => cortar("tiempo"), op.timeout);
    const terminar = (codigo: number | null) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      senal?.removeEventListener("abort", alCancelar);
      if (cortado === "cancelado") return mal(errorCancelado());
      const r = { codigo: codigo ?? -1, stdout, stderr };
      if (r.codigo !== 0 && !op.permitirFallo) mal(new ErrorDeComando(texto, r));
      else ok(r);
    };
    const lineas = (fuente: "out" | "err") => {
      let resto = "";
      return (d: Buffer) => {
        const s = d.toString();
        if (fuente === "out") stdout = (stdout + s).slice(-MAX);
        else stderr = (stderr + s).slice(-MAX);
        if (!op.log) return;
        resto += s;
        const partes = resto.split(/\r?\n|\r/);
        resto = partes.pop() ?? "";
        for (const p of partes) if (p.trim()) op.log(p);
      };
    };
    hijo.stdout?.on("data", lineas("out"));
    hijo.stderr?.on("data", lineas("err"));
    // Si el comando sale sin leer toda la entrada, escribir da EPIPE: sin esto, el error tumba el proceso.
    hijo.stdin?.on("error", () => {});
    if (op.entrada !== undefined) hijo.stdin?.end(op.entrada);
    hijo.on("error", (e) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      senal?.removeEventListener("abort", alCancelar);
      mal(e);
    });
    // Se resuelve cuando la salida se cierra; si se cortó y un nieto escapado la mantiene abierta, poco después de salir.
    hijo.on("exit", (codigo) => {
      if (cortado) setTimeout(() => terminar(codigo), ESPERA_TRAS_SALIR_MS).unref();
    });
    hijo.on("close", (codigo) => terminar(codigo));
  });
}
