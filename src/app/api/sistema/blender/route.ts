import { versionBlender } from "@/lib/blender";
import { json, manejar } from "@/lib/http";
import { estadoInstalacionBlender, iniciarInstalacionBlender } from "@/lib/instalar-blender";

export const dynamic = "force-dynamic";

/** Si Blender (escenas 3D) está instalado y cómo va su instalación. */
export async function GET() {
  return manejar(async () => json({ version: await versionBlender(), ...estadoInstalacionBlender() }));
}

/** Instala Blender (descarga oficial verificada con SHA-256). Vuelve enseguida; el avance se lee con GET. */
export async function POST() {
  return manejar(async () => json(iniciarInstalacionBlender(), 202));
}
