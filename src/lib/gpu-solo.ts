/**
 * Lanzador común de `gpu-solo` (~/dev/video-tools/bin): le da toda la tarjeta a un comando y, al terminar,
 * vuelve a encender la IA de MPT. Lo usan Wan2GP y ComfyUI (y debería usarlo el de efectos de sonido).
 */
import { GPU_SOLO_BIN } from "./rutas";

/**
 * Comando y argumentos para correr `cmd args` dentro de gpu-solo.
 *
 * gpu-solo escribe en stderr después de cada `docker start`. Si quien leía esa salida (el worker) murió o
 * salió antes, la escritura lo mataría por SIGPIPE a mitad de restaurar y la IA de MPT quedaría apagada
 * (WRK-01). Se lanza con SIGPIPE ignorado: lo ignorado se hereda a través de `exec` y bash no lo puede
 * volver a activar, así que sirve aunque el gpu-solo instalado no lo ignore por su cuenta.
 */
export function comandoGpuSolo(cmd: string, args: string[], bin = GPU_SOLO_BIN): { cmd: string; args: string[] } {
  if (process.platform === "win32") return { cmd: bin, args: [cmd, ...args] };
  return { cmd: "sh", args: ["-c", 'trap "" PIPE; exec "$@"', "sh", bin, cmd, ...args] };
}
