import { z } from "zod";
import { leerAvatar, listarAvatares, vistaAvatar } from "@/lib/avatares";
import { encolar } from "@/lib/cola";
import { db } from "@/lib/db";
import { Marco } from "@/lib/esquema";
import { json, manejar } from "@/lib/http";
import { zonasDelVideo } from "@/lib/caras-zonas";
import { metricas } from "@/lib/formatos";
import { revisarWan2gp } from "@/lib/instalar-wan2gp";
import { CALIDADES, estadoPresentador, MAX_SEGUNDOS, planearPresentador, type OpcionesPresentador } from "@/lib/presentador";
import { guardarProyecto } from "@/lib/almacen";
import { clipBurbuja, notaReubicar, reubicarPresentador } from "@/lib/presentador-ubicar";
import { versionDeProyecto } from "@/lib/render";

export const dynamic = "force-dynamic";

const Opciones = z.object({
  avatar: z.string().regex(/^[a-z0-9-]+$/),
  modo: z.enum(["pantalla", "burbuja"]),
  escenas: z.array(z.string().min(1).max(64)).max(200).optional(),
  calidad: z.enum(Object.keys(CALIDADES) as [keyof typeof CALIDADES, ...(keyof typeof CALIDADES)[]]).optional(),
  marco: Marco.partial().optional(),
  prompt: z.string().max(500).optional(),
  semilla: z.number().int().min(0).max(2147483647).optional(),
}).strict();

const activos = (id: string) =>
  db.trabajo.findMany({ where: { proyectoId: id, tipo: "presentador.generar", estado: { in: ["pendiente", "corriendo"] } }, select: { id: true, estado: true, etapa: true, progreso: true } });

/** Lo que necesita el panel: avatares, qué se va a generar con estas opciones y si ya hay uno en curso. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const crudo = new URL(req.url).searchParams.get("opciones");
    const w = revisarWan2gp();
    const { p } = await versionDeProyecto(id);
    let plan = null;
    let error = null;
    if (crudo) {
      try {
        const op = Opciones.parse(JSON.parse(crudo)) as OpcionesPresentador;
        await leerAvatar(op.avatar);
        const x = planearPresentador(p, op);
        plan = { modo: x.modo, escenas: x.escenas, segundos: x.segundos, resolucion: x.resolucion, notas: x.notas, avisos: x.avisos, marco: x.marco };
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return json({
      wan2gp: { listo: !w.falta, falta: w.falta, instalando: w.corriendo },
      avatares: (await listarAvatares()).map(vistaAvatar),
      formato: p.formato,
      // Para que la vista previa de la burbuja haga la misma cuenta que el video: banda segura de las
      // redes elegidas y caras de las escenas (esquina «auto», marco-auto.ts).
      plataformas: p.plataformas,
      zonas: zonasDelVideo(p, metricas(p.formato).W, metricas(p.formato).H),
      vozVideo: { motor: p.voz.motor, voz: p.voz.voz, idioma: p.voz.idioma },
      maxSegundos: MAX_SEGUNDOS,
      calidades: Object.entries(CALIDADES).map(([k, c]) => ({ id: k, nombre: c.nombre })),
      estado: estadoPresentador(p),
      // Dónde está ahora la burbuja: si sólo cambia esto, se mueve al instante (PATCH) sin generar.
      marcoActual: clipBurbuja(p)?.marco ?? null,
      plan,
      error,
      trabajos: await activos(id),
    });
  });
}

/** Encola el presentador (`presentador.generar`, usa toda la GPU). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const { opciones } = z.object({ opciones: Opciones }).parse(await req.json());
    if (revisarWan2gp().falta) throw new Error("Falta instalar Wan2GP: ve a Sistema y pulsa «Instalar» en «Wan2GP».");
    const fila = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (fila.versionActual < 1) throw new Error("El proyecto todavía no tiene geeper.json");
    await leerAvatar(opciones.avatar);
    const { p } = await versionDeProyecto(id);
    planearPresentador(p, opciones as OpcionesPresentador); // valida antes de encolar
    if ((await activos(id)).length) throw new Error("Ya se está generando un presentador en este proyecto: mira el avance en Trabajos.");
    const voz = await db.trabajo.count({ where: { proyectoId: id, tipo: { in: ["voz.regenerar", "proyecto.importar"] }, estado: { in: ["pendiente", "corriendo"] } } });
    if (voz) throw new Error("Se está diciendo la voz del video de nuevo: espera a que termine y después pon el presentador (si no, la boca seguiría a la voz vieja).");
    const t = await encolar(id, "presentador.generar", { opciones, cadena: [] });
    return json({ trabajo: t }, 201);
  });
}

/** Mueve la burbuja ya generada (esquina, tamaño o forma): versión nueva al instante, sin GPU. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return manejar(async () => {
    const { id } = await ctx.params;
    const { marco } = z.object({ marco: Marco.partial() }).strict().parse(await req.json());
    const { p } = await versionDeProyecto(id);
    const antes = clipBurbuja(p)?.marco;
    const nuevo = reubicarPresentador(p, marco);
    const version = await guardarProyecto(id, nuevo, notaReubicar(Marco.parse(antes ?? {}), clipBurbuja(nuevo)!.marco!));
    return json({ version, marco: clipBurbuja(nuevo)!.marco });
  });
}
