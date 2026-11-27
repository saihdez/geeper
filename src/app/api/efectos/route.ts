import { json, manejar } from "@/lib/http";
import { efectosLibres, GRUPOS_EFECTO } from "@/lib/audio-libre";
import { PRESETS, efectosInstalados, listarEfectos } from "@/lib/efectos-sonido";

export const dynamic = "force-dynamic";

/**
 * Sonidos listos para elegir: los libres (CC0, vienen con Geeper, sin tarjeta de video), los que se crean
 * con MOSS y los que ya están en la biblioteca (con su archivo para escucharlos).
 */
export async function GET() {
  return manejar(async () => {
    const biblioteca = (await listarEfectos()).map((e) => ({ id: e.id, nombre: e.nombre, segundos: e.segundos, licencia: e.licencia, muestra: `efectos/${e.id}.wav` }));
    const libres = efectosLibres().map((s) => ({ id: s.id, nombre: s.nombre, grupo: s.grupo, segundos: s.segundos, muestra: `/api/audio-libre/${s.id}` }));
    return json({ instalado: efectosInstalados(), grupos: GRUPOS_EFECTO, libres, presets: PRESETS.map((p) => ({ id: p.id, nombre: p.nombre, segundos: p.segundos })), biblioteca });
  });
}
