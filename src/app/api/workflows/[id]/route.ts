import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { encolar } from "@/lib/cola";
import { COMFYUI_DIR, estadoModelos, leerCatalogo, leerWorkflowJson, modelosDeWorkflow, notasDeWorkflow, textosDeWorkflow } from "@/lib/comfyui";
import { json, manejar } from "@/lib/http";
import { borrarRecibidos, recibirMultipart } from "@/lib/multipart-flujo";
import { revisarComfyui } from "@/lib/instalar-comfyui";
import { infoNodos, permitirNodos } from "@/lib/nodos-comfy";
import { aviso, bloqueo, dirCorrida, entradasSinArchivo, escribirCorrida, espacioLibre, hayEjemplo, nuevaCorrida, PedidoWorkflow, textoFaltaArchivo } from "@/lib/workflows";
import { bytesPorBajar } from "@/lib/workflows-texto";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const MAX_ARCHIVO = 500 * 1024 ** 2;
/** Lo que el formulario agrega a los archivos (separadores y los otros campos). */
const MARGEN = 1024 ** 2;
const EXT: Record<string, string[]> = { image: [".png", ".jpg", ".jpeg", ".webp"], video: [".mp4", ".mov", ".webm"], audio: [".wav", ".mp3", ".flac", ".m4a", ".ogg"] };

async function buscar(id: string) {
  const { workflows, archivos } = await leerCatalogo();
  const w = workflows.find((x) => x.id === id);
  if (!w) throw new Error("Ese workflow no está en esta versión de ComfyUI.");
  // El ejemplo sólo cuenta si existe de verdad (UX-04): si no, hay que subir el archivo antes de crear.
  const conEjemplo = (archivo: string | null) => hayEjemplo(archivo, archivos ?? {}, (n) => existsSync(path.join(COMFYUI_DIR, "input", n)));
  return { w, conEjemplo };
}

/** Lo que pide el workflow: archivos, textos, modelos (y cuáles faltan) y notas del autor. */
export async function GET(_: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    if (revisarComfyui().falta) throw new Error("ComfyUI no está instalado");
    const { w, conEjemplo } = await buscar(id);
    const grafo = await leerWorkflowJson(w.id);
    const modelos = estadoModelos(modelosDeWorkflow(grafo));
    const faltan = modelos.filter((m) => !m.listo).length;
    // Lo que ya está en el disco se descuenta del tamaño del índice; con el espacio libre, la página
    // pregunta antes de bajar más de 10 GB o avisa si no cabe (UX-36).
    const yaBajados = modelos.filter((m) => m.listo).reduce((s, m) => s + (statSync(m.ruta, { throwIfNoEntry: false })?.size ?? 0), 0);
    return json({
      workflow: { ...w, bloqueo: bloqueo(w), aviso: aviso(w), miniaturas: w.miniaturas.map((m) => `/api/workflows/archivo/${encodeURIComponent(m)}`) },
      textos: textosDeWorkflow(grafo),
      notas: notasDeWorkflow(grafo),
      modelos: modelos.map((m) => ({ nombre: m.nombre, carpeta: m.carpeta, listo: m.listo })),
      faltan,
      porBajar: bytesPorBajar(w.tamano, faltan, yaBajados),
      libre: await espacioLibre(COMFYUI_DIR),
      nodos: (await infoNodos(w.complementos)).map((n) => ({
        id: n.id,
        nombre: n.fijado?.nombre ?? n.id,
        version: n.fijado?.version ?? null,
        autor: n.fijado?.autor ?? "",
        repo: n.fijado?.repo ?? "",
        licencia: n.fijado?.licencia ?? "",
        megas: n.fijado ? Math.max(1, Math.round(n.fijado.bytes / 1024 ** 2)) : 0,
        motivo: n.motivo,
        instalado: n.instalado,
        permitido: n.permitido,
      })),
      entradas: w.entradas.map((e) => ({ ...e, ejemplo: conEjemplo(e.archivo) ? `/api/workflows/archivo/${encodeURIComponent(e.archivo!)}` : null })),
    });
  });
}

/**
 * Crea una corrida: multipart con `textos` (JSON) y un archivo por entrada (`archivo-<nodo>`). Los archivos
 * llegan en flujo a la carpeta de la corrida, con el tope de 500 MB mirado mientras llegan (SRV-01).
 */
export async function POST(req: Request, ctx: Ctx) {
  return manejar(async () => {
    const { id } = await ctx.params;
    if (revisarComfyui().falta) throw new Error("ComfyUI no está instalado");
    const { w, conEjemplo } = await buscar(id);
    const motivo = bloqueo(w);
    if (motivo) throw new Error(motivo);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_ARCHIVO * Math.max(1, w.entradas.length) + MARGEN) throw new Error("El archivo pasa de 500 MB");
    const corrida = nuevaCorrida(w.id);
    const dir = dirCorrida(corrida);
    const entradas = path.join(dir, "entradas");
    let creada = false;
    try {
      const { campos, archivos } = await recibirMultipart(req, {
        dir: entradas,
        archivo: (campo, nombre) => {
          const e = w.entradas.find((x) => campo === `archivo-${x.nodo}`);
          if (!e) return null;
          const ext = path.extname(nombre).toLowerCase();
          if (!(EXT[e.medio] ?? EXT.image!).includes(ext)) throw new Error(`Ese archivo no sirve aquí: hace falta ${e.medio === "video" ? "un video" : e.medio === "audio" ? "un audio" : "una imagen"}.`);
          return { tope: MAX_ARCHIVO, mensaje: "El archivo pasa de 500 MB" };
        },
      });
      try {
        if (w.complementos.length) {
          if (campos.get("permitirNodos") === "1") await permitirNodos(w.complementos);
          const sin = (await infoNodos(w.complementos)).filter((n) => !n.permitido);
          if (sin.length) throw new Error("Para usar este workflow, marca la casilla que permite instalar su código de la comunidad.");
        }
        const textos = z.array(z.object({ nodo: z.string(), indice: z.number().int(), valor: z.string().max(5000) })).max(20).parse(JSON.parse(campos.get("textos") ?? "[]"));
        const usados: { nodo: number; nombre: string }[] = [];
        for (const e of w.entradas) {
          const f = archivos.find((a) => a.campo === `archivo-${e.nodo}`);
          if (!f || !f.bytes) continue; // sin archivo: queda el ejemplo de la plantilla (si lo trae)
          const nombre = `entrada-${e.nodo}${path.extname(f.nombre).toLowerCase()}`;
          await fs.rename(f.ruta, path.join(entradas, nombre));
          usados.push({ nodo: e.nodo, nombre });
        }
        // Sin ejemplo, ComfyUI rechazaría el pedido recién después de bajar los modelos (UX-04): se avisa ya.
        const faltan = entradasSinArchivo(w.entradas, usados.map((u) => u.nodo), (e) => conEjemplo(e.archivo));
        if (faltan.length) throw new Error(`${textoFaltaArchivo(faltan.map((e) => e.medio))} Esta receta no trae un ejemplo y lo necesita para empezar.`);
        const pedido = PedidoWorkflow.parse({ workflow: w.id, textos, archivos: usados });
        await escribirCorrida({ id: corrida, workflow: w.id, titulo: w.titulo, creada: new Date().toISOString(), estado: "preparada", salidas: [] });
        creada = true;
        const t = await encolar(null, "workflow.correr", { corrida, pedido });
        return json({ corrida, trabajo: t.id }, 201);
      } finally {
        await borrarRecibidos(archivos);
      }
    } catch (e) {
      // Si no llegó a crearse, no queda una carpeta de corrida a medias.
      if (!creada) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  });
}
