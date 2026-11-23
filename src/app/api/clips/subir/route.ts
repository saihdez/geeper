import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { encolar } from "@/lib/cola";
import { exigirEspacio } from "@/lib/espacio";
import { json, manejar } from "@/lib/http";
import { dirDatos } from "@/lib/rutas";

export const dynamic = "force-dynamic";

const VIDEO = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".ts", ".flv"]);
const MAX = 20 * 1024 ** 3;

/**
 * Sube un video propio (el cuerpo es el archivo tal cual, en flujo: no se carga en memoria) a
 * ~/geeper-data/_subidos/ y encola la búsqueda de momentos. Nombre e idioma van en la URL.
 */
export async function POST(req: Request) {
  return manejar(async () => {
    const u = new URL(req.url);
    const nombre = path.basename(u.searchParams.get("nombre") ?? "").trim();
    const ext = path.extname(nombre).toLowerCase();
    if (!VIDEO.has(ext)) throw new Error(`Ese archivo no parece un video (${ext || "sin extensión"}). Sirven MP4, MOV, MKV, WEBM…`);
    const largo = Number(req.headers.get("content-length") ?? 0);
    if (largo > MAX) throw new Error("El video pasa de 20 GB: córtalo antes o usa un enlace.");
    if (!req.body) throw new Error("No llegó el archivo");
    const opciones = z.object({
      idioma: z.string().min(2).max(5).default("es"),
      min: z.coerce.number().min(3).max(120).default(15),
      max: z.coerce.number().min(3).max(180).default(40),
    }).parse(Object.fromEntries(u.searchParams));
    const dir = path.join(dirDatos(), "_subidos");
    await fs.mkdir(dir, { recursive: true });
    // Antes de recibir el archivo (DSC-05): si no cabe con la reserva, se dice y no se llena el disco.
    if (largo > 0) await exigirEspacio(dir, largo, "subir este video");
    const seguro = nombre.replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/^\.+/, "").slice(0, 80) || `video${ext}`;
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
    const t = await encolar(null, "clip.momentos", { src: final, top: 8, ...opciones });
    return json({ trabajo: t.id, archivo: path.basename(final) }, 201);
  });
}
