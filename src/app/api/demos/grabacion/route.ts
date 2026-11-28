import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { MAX_CARACTERES_DEMO } from "@/lib/demo-web";
import { exigirEspacio } from "@/lib/espacio";
import { json, manejar } from "@/lib/http";
import { dirDatos } from "@/lib/rutas";
import { crearDemo } from "@/lib/servicios";

export const dynamic = "force-dynamic";

const VIDEO = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);
const MAX = 4 * 1024 ** 3;

const Pedido = z.object({
  nombre: z.string().min(1),
  url: z.string().trim().max(2000).default(""),
  formato: z.enum(["9:16", "16:9"]),
  estilo: z.enum(["3d", "plano"]),
  texto: z.string().trim().min(3, "Escribe qué quieres que diga el video").max(MAX_CARACTERES_DEMO, `El texto es muy largo (hasta ${MAX_CARACTERES_DEMO} caracteres, unos 45 s)`),
  plantilla: z.string().min(1),
  propio: z.enum(["0", "1"]).default("0"),
});

/**
 * «Desde una página web» con una grabación de pantalla propia: el cuerpo es el video tal cual (en flujo,
 * no se carga en memoria) y lo demás va en la URL. Queda en ~/geeper-data/_subidos/ y se encola la
 * demo, que usa esa grabación en vez de grabar la página.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const u = new URL(req.url);
    const d = Pedido.parse(Object.fromEntries(u.searchParams));
    const nombre = path.basename(d.nombre).trim();
    const ext = path.extname(nombre).toLowerCase();
    if (!VIDEO.has(ext)) throw new Error(`Ese archivo no parece un video (${ext || "sin extensión"}). Sirven MP4, MOV, WEBM…`);
    const largo = Number(req.headers.get("content-length") ?? 0);
    if (largo > MAX) throw new Error("La grabación pasa de 4 GB: graba sólo la parte que quieres mostrar.");
    if (!req.body) throw new Error("No llegó la grabación");
    const dir = path.join(dirDatos(), "_subidos");
    await fs.mkdir(dir, { recursive: true });
    if (largo > 0) await exigirEspacio(dir, largo, "subir esta grabación");
    const seguro = nombre.replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/^\.+/, "").slice(0, 80) || `grabacion${ext}`;
    const tmp = path.join(dir, `.subiendo-${randomBytes(4).toString("hex")}`);
    const hash = createHash("sha1");
    try {
      const entrada = Readable.fromWeb(req.body as import("node:stream/web").ReadableStream);
      entrada.on("data", (b: Buffer) => hash.update(b));
      await pipeline(entrada, createWriteStream(tmp));
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw new Error(`La subida se cortó: ${(e as Error).message}`);
    }
    const final = path.join(dir, `${hash.digest("hex").slice(0, 8)}-${seguro}`);
    await fs.rename(tmp, final);
    const url = d.url && !/^https?:\/\//i.test(d.url) ? `https://${d.url}` : d.url;
    const proyecto = await crearDemo({ url, formato: d.formato, estilo: d.estilo, texto: d.texto, plantilla: d.plantilla, propio: d.propio === "1", grabacion: final });
    return json({ proyecto }, 201);
  });
}
