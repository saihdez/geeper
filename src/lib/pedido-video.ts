/**
 * Lo que se pidió al crear el video y que el importador aplica al armar geeper.json (hoy, la frase del
 * final de una fila de la tabla: tabla-videos.ts). Vive en <proyecto>/pedido.json.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dirProyecto } from "./rutas";
import { MAX_CTA } from "./tabla-videos";

const Pedido = z.object({ cta: z.string().trim().min(1).max(MAX_CTA).optional() });
export type PedidoVideo = z.infer<typeof Pedido>;

export async function guardarPedido(slug: string, p: PedidoVideo): Promise<void> {
  await fs.mkdir(dirProyecto(slug), { recursive: true });
  await fs.writeFile(path.join(dirProyecto(slug), "pedido.json"), JSON.stringify(Pedido.parse(p), null, 2));
}

/** El pedido de la carpeta del proyecto; si no hay o está roto, vacío. */
export async function leerPedido(dir: string): Promise<PedidoVideo> {
  try {
    return Pedido.parse(JSON.parse(await fs.readFile(path.join(dir, "pedido.json"), "utf8")));
  } catch {
    return {};
  }
}
