/**
 * Cómo usa la tarjeta el render de Hyperframes. Cambios de la auditoría que necesitan probarse con
 * la tarjeta puesta, así que quedan apagados por defecto detrás de una variable de entorno:
 *
 * - REN-01 (`GEEPER_RENDER_CAPTURA_AUTO=1`): sin NVENC, no pasar `--no-browser-gpu` en Linux (esa
 *   bandera elige la captura lenta por capturas de pantalla) y dar a Chrome `LIBGL_ALWAYS_SOFTWARE=1`
 *   para que use la captura «beginframe» con GPU por software. Probar: un render sin `--gpu` y sin
 *   `--quiet` debe decir «beginframe capture · software gpu».
 */
import type { Sistema } from "./plataforma";

type Entorno = Record<string, string | undefined>;

export const capturaAuto = (env: Entorno = process.env) => env.GEEPER_RENDER_CAPTURA_AUTO === "1";

/** Banderas y entorno extra del render según use NVENC o no. */
export function banderasRender(gpu: boolean, sistema: Sistema, env: Entorno = process.env): { args: string[]; env: Record<string, string> } {
  if (gpu) return { args: ["--gpu"], env: {} };
  if (sistema === "linux" && capturaAuto(env)) return { args: [], env: { LIBGL_ALWAYS_SOFTWARE: "1" } };
  return { args: ["--no-browser-gpu"], env: {} };
}
