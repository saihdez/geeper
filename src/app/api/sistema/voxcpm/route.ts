import { json, manejar } from "@/lib/http";
import { instalarVoxcpm, revisarVoxcpm } from "@/lib/instalar-voxcpm";

export const dynamic = "force-dynamic";

/** Si las voces diseñadas (VoxCPM2) están instaladas y cómo va la instalación. */
export async function GET() {
  return manejar(async () => json(revisarVoxcpm()));
}

/** Instala VoxCPM2 (Python, PyTorch, voxcpm y el modelo). Vuelve enseguida; el avance se lee con GET. */
export async function POST() {
  return manejar(async () => json(instalarVoxcpm(), 202));
}
