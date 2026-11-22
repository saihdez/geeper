import { spawn, type SpawnOptions } from "node:child_process";

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
  /** Señal para cancelar (mata el proceso). */
  signal?: AbortSignal;
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

/** Corre un comando sin shell, registra su salida línea por línea y devuelve stdout/stderr. */
export function correr(cmd: string, argsPedidos: string[], op: OpcionesCorrer = {}): Promise<Resultado> {
  const args = argsPython(cmd, argsPedidos);
  const texto = [cmd, ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");
  op.log?.(`$ ${texto}`);
  return new Promise((ok, mal) => {
    const hijo = spawn(cmd, args, {
      cwd: op.cwd,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...op.env },
      stdio: [op.entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      signal: op.signal,
      timeout: op.timeout,
      killSignal: "SIGTERM",
    });
    let stdout = "";
    let stderr = "";
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
    hijo.on("error", mal);
    hijo.on("close", (codigo) => {
      const r = { codigo: codigo ?? -1, stdout, stderr };
      if (r.codigo !== 0 && !op.permitirFallo) mal(new ErrorDeComando(texto, r));
      else ok(r);
    });
  });
}
