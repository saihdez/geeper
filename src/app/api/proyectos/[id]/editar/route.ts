import { guardarProyecto } from "@/lib/almacen";
import { db } from "@/lib/db";
import { aplicarEdicion, Edicion } from "@/lib/ediciones";
import { json, manejar } from "@/lib/http";
import { versionDeProyecto } from "@/lib/render";

const NOTAS: Record<Edicion["tipo"], string> = {
  corregirSubtitulo: "Subtítulo corregido",
  quitarCorreccion: "Corrección quitada",
  quitarEscena: "Escena quitada",
  moverEscena: "Escenas reordenadas",
  cambiarFormato: "Formato cambiado",
  cambiarPlantilla: "Plantilla cambiada",
  cambiarMostrar: "«Mostrar» cambiado",
  ajusteVisual: "Encuadre cambiado",
  renombrar: "Renombrado",
  cambiarVoz: "Voz cambiada",
  recortarPalabras: "Palabras recortadas",
  restaurarPalabras: "Palabras restauradas",
  confirmarPalabras: "Palabras revisadas: suenan bien",
  quitarSilencios: "Silencios largos acortados",
  quitarMuletillas: "Muletillas quitadas",
  quitarRecortes: "Recortes deshechos",
  efectosVisual: "Efectos del plano cambiados",
  agregarTexto: "Texto agregado",
  editarTexto: "Texto editado",
  quitarTexto: "Texto quitado",
  agregarClipLibre: "Superposición o efecto agregado",
  quitarClipLibre: "Superposición o efecto quitado",
  editarClipLibre: "Superposición ajustada",
  estiloVideo: "Estilo del video cambiado",
  cambiarDestino: "Destino cambiado",
  cambiarCta: "Botón final cambiado",
  fijarMusica: "Música alineada",
};

/** Aplica una o varias ediciones (sólo geeper.json, sin GPU) y guarda una Version nueva. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const cuerpo = (await req.json()) as { ediciones?: unknown[]; edicion?: unknown };
    const lista = (cuerpo.ediciones ?? [cuerpo.edicion]).map((e) => Edicion.parse(e));
    if (!lista.length) throw new Error("Sin ediciones");
    if (lista.some((e) => e.tipo === "cambiarPlantilla")) {
      const slug = lista.find((e) => e.tipo === "cambiarPlantilla")!;
      if (slug.tipo === "cambiarPlantilla" && !(await db.plantilla.findUnique({ where: { slug: slug.plantilla } }))) throw new Error("No existe esa plantilla");
    }
    let { p } = await versionDeProyecto(id);
    const antes = JSON.stringify(p);
    for (const e of lista) p = aplicarEdicion(p, e);
    // UX-18: si nada cambió (no había muletillas ni pausas largas), no se crea una versión igual.
    if (JSON.stringify(p) === antes) return json({ sinCambios: true });
    const nota = [...new Set(lista.map((e) => NOTAS[e.tipo]))].join(", ");
    const numero = await guardarProyecto(id, p, nota);
    return json({ version: numero });
  });
}
