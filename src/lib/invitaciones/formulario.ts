/** Lee el multipart del formulario de invitaciones (`datos` en JSON + foto y audio opcionales). */
import type { Subidas } from "./construir";

export async function leerFormulario(req: Request): Promise<{ datos: unknown; subidas: Subidas }> {
  const fd = await req.formData();
  const crudo = fd.get("datos");
  if (typeof crudo !== "string") throw new Error("Faltan los datos de la invitación");
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    throw new Error("Los datos de la invitación no se pudieron leer");
  }
  const archivo = (n: string) => {
    const v = fd.get(n);
    return v instanceof File && v.size > 0 ? v : null;
  };
  return {
    datos,
    subidas: {
      foto: archivo("foto"),
      audio: archivo("audio"),
      audioInicio: Number(fd.get("audioInicio") ?? 0) || 0,
      quitarFoto: fd.get("quitarFoto") === "1",
      quitarAudio: fd.get("quitarAudio") === "1",
      permisoAudio: fd.get("permisoAudio") === "1",
    },
  };
}
