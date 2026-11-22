import { z } from "zod";
import { guardarProyecto, registrarAssetsEnDb } from "@/lib/almacen";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { PRESETS, agregarEfecto, efectosInstalados, idEfecto, listarEfectos } from "@/lib/efectos-sonido";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";
import { dirProyecto } from "@/lib/rutas";

const Pedido = z.object({
  inicio: z.number().min(0),
  /** Uno de los tres: un efecto de la biblioteca, uno de los listos o una descripción propia. */
  biblioteca: z.string().regex(/^sfx-[0-9a-f]{12}$/).optional(),
  preset: z.string().optional(),
  descripcion: z.string().trim().min(3).max(300).optional(),
  segundos: z.number().min(1).max(30).optional(),
});

/**
 * Agrega un efecto de sonido al video en el segundo `inicio`. Si ya está en la biblioteca, al instante;
 * si hay que crearlo, encola el trabajo (usa la tarjeta gráfica) y responde 202.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const d = Pedido.parse(await req.json());
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El video todavía no está armado.");
    const biblioteca = await listarEfectos();
    const preset = PRESETS.find((p) => p.id === d.preset);
    const segundos = d.segundos ?? preset?.segundos ?? 3;
    const yaHecho = d.biblioteca
      ? biblioteca.find((e) => e.id === d.biblioteca)
      : preset
        ? biblioteca.find((e) => e.id === idEfecto(preset.prompt, segundos))
        : undefined;
    if (d.biblioteca && !yaHecho) throw new Error("Ese sonido ya no está en la biblioteca.");
    if (yaHecho) {
      const { p } = await versionDeProyecto(id);
      const nuevo = await agregarEfecto(dirProyecto(fila.slug), p, yaHecho, d.inicio);
      const version = await guardarProyecto(id, nuevo, `Efecto de sonido «${yaHecho.nombre}» en ${d.inicio.toFixed(1)} s`);
      await registrarAssetsEnDb(id, nuevo);
      return json({ listo: true, version, efecto: yaHecho.nombre });
    }
    if (!preset && !d.descripcion) throw new Error("Elige un sonido o descríbelo.");
    if (!efectosInstalados()) throw new Error("Los efectos de sonido no están instalados en esta computadora.");
    const t = await encolar(id, "efecto.generar", {
      nombre: preset?.nombre ?? d.descripcion!.slice(0, 80),
      prompt: preset?.prompt ?? "",
      descripcion: d.descripcion ?? "",
      segundos,
      inicio: d.inicio,
    });
    return json({ listo: false, trabajo: t.id }, 202);
  });
}
