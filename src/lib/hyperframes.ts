/**
 * Cómo se ejecuta Hyperframes. En desarrollo, el paquete `hyperframes` de node_modules si está instalado en
 * la versión fijada (sin npx: no depende de la caché de npm ni de la red y ahorra 0,5–2 s por llamada,
 * WRK-11); si no, `npx hyperframes@<versión fijada>` (lo de siempre). En la
 * app de escritorio viene empaquetado: la carcasa pasa su CLI en GEEPER_HYPERFRAMES_CLI y se corre con el
 * Node de Electron (ELECTRON_RUN_AS_NODE ya está puesto en el servidor y el worker), apuntando al ffmpeg,
 * al Python de la voz, al whisper-cli incluido y a una caché dentro de la carpeta de herramientas.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ESCRITORIO } from "./plataforma";
import { correr, type OpcionesCorrer, type Resultado } from "./proceso";
import { CACHE_HF, FFMPEG, FFPROBE, HYPERFRAMES_VERSION, PYTHON_VOZ, RAIZ_REPO, WHISPER_CLI } from "./rutas";

const SIN_TELEMETRIA = { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };

/**
 * El CLI de `hyperframes` instalado en `<raiz>/node_modules`, si su versión es la fijada; si no, null.
 */
export function cliLocalHf(raiz = RAIZ_REPO, version = HYPERFRAMES_VERSION): string | null {
  try {
    const dir = path.join(raiz, "node_modules", "hyperframes");
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string; bin?: string | Record<string, string> };
    if (pkg.version !== version) return null;
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.hyperframes;
    return bin ? path.join(dir, bin) : null;
  } catch {
    return null;
  }
}

let cliLocal: string | null | undefined;

/** Comando, argumentos y entorno para correr `hyperframes <args>`. */
export function comandoHf(args: string[]): { cmd: string; args: string[]; env: Record<string, string> } {
  const cli = process.env.GEEPER_HYPERFRAMES_CLI;
  if (ESCRITORIO && cli) {
    return {
      cmd: process.execPath,
      args: [cli, ...args],
      env: {
        ...SIN_TELEMETRIA,
        ELECTRON_RUN_AS_NODE: "1",
        HYPERFRAMES_FFMPEG_PATH: FFMPEG,
        FFMPEG_PATH: FFMPEG,
        HYPERFRAMES_FFPROBE_PATH: FFPROBE,
        FFPROBE_PATH: FFPROBE,
        HYPERFRAMES_PYTHON: PYTHON_VOZ,
        HYPERFRAMES_CACHE_DIR: CACHE_HF,
        ...(WHISPER_CLI ? { HYPERFRAMES_WHISPER_PATH: WHISPER_CLI } : {}),
      },
    };
  }
  cliLocal ??= cliLocalHf();
  if (cliLocal) return { cmd: process.execPath, args: [cliLocal, ...args], env: SIN_TELEMETRIA };
  return { cmd: "npx", args: ["--yes", `hyperframes@${HYPERFRAMES_VERSION}`, ...args], env: SIN_TELEMETRIA };
}

/** `correr` con Hyperframes: el entorno propio se suma al que pida quien llama. */
export function correrHf(args: string[], op: OpcionesCorrer = {}): Promise<Resultado> {
  const c = comandoHf(args);
  return correr(c.cmd, c.args, { ...op, env: { ...c.env, ...op.env } });
}
