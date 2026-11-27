/**
 * Instala Blender con un clic (Sistema o la página «Escenas 3D»): el archivo oficial de blender.org de la
 * versión fijada (blender.ts), verificado con su SHA-256 publicado, con el instalador genérico de
 * instalar-craft.ts. Después baja la luz de estudio (HDRI CC0) y Rhubarb Lip Sync (rhubarb.ts) para que la
 * primera escena no espere.
 */
import { archivoBlender, asegurarHdri, BLENDER_DIR, BLENDER_VERSION, URL_BLENDER, versionBlender } from "./blender";
import { crearInstalador, type EstadoInstalacion } from "./instalar-craft";
import { asegurarRhubarb } from "./rhubarb";
import { SISTEMA } from "./plataforma";

const A = archivoBlender(SISTEMA, process.arch);

const g = globalThis as unknown as { __instaladorBlender?: ReturnType<typeof crearInstalador> | null };
const instalador = () =>
  (g.__instaladorBlender ??= A
    ? crearInstalador({
        app: "blender",
        version: BLENDER_VERSION,
        base: URL_BLENDER,
        sumas: `blender-${BLENDER_VERSION}.sha256`,
        archivo: A.archivo,
        raiz: A.raiz,
        extraer: A.extraer,
        carpeta: BLENDER_DIR,
        verificar: async () => {
          const v = await versionBlender();
          if (v) await asegurarHdri(() => {});
          // Lo que mueve la boca de los personajes: se baja de una vez, sin esperarlo (si falla, se baja al usarlo).
          if (v) void asegurarRhubarb(() => {}).catch(() => {});
          return v;
        },
      })
    : null);

export interface EstadoBlender extends EstadoInstalacion {
  /** false si este sistema no tiene instalación automática. */
  disponible: boolean;
  /** Tamaño aproximado de la descarga en MB. */
  mb: number | null;
}

export function estadoInstalacionBlender(): EstadoBlender {
  const i = instalador();
  const base = i?.estado() ?? { fase: "inactiva" as const, progreso: 0, detalle: "" };
  return { ...base, disponible: !!i, mb: A?.mb ?? null };
}

/** Arranca la instalación (si no hay otra en curso) y vuelve enseguida. */
export function iniciarInstalacionBlender(): EstadoBlender {
  const i = instalador();
  if (!i) throw new Error("En este equipo Blender no se instala solo: bájalo de blender.org.");
  i.iniciar();
  return estadoInstalacionBlender();
}
