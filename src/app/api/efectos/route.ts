import { json, manejar } from "@/lib/http";
import { PRESETS, efectosInstalados, listarEfectos } from "@/lib/efectos-sonido";

export const dynamic = "force-dynamic";

/** Sonidos listos para elegir y los que ya están en la biblioteca (con su archivo para escucharlos). */
export async function GET() {
  return manejar(async () => {
    const biblioteca = (await listarEfectos()).map((e) => ({ id: e.id, nombre: e.nombre, segundos: e.segundos, licencia: e.licencia, muestra: `efectos/${e.id}.wav` }));
    return json({ instalado: efectosInstalados(), presets: PRESETS.map((p) => ({ id: p.id, nombre: p.nombre, segundos: p.segundos })), biblioteca });
  });
}
