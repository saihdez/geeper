/**
 * Blender (GPL, se baja de blender.org al instalarlo: no viaja dentro de Geeper) para las escenas 3D
 * (escenas3d.ts). Versión fija con su suma SHA-256 oficial; se instala con un clic desde Sistema o desde la
 * página «Escenas 3D» (instalar-blender.ts) en `<herramientas>/blender/<versión>`, con `actual` apuntando ahí.
 *
 * Geeper lo usa sólo en modo fondo (`blender -b --factory-startup`): no toca las preferencias ni los
 * complementos de un Blender que la persona use aparte.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SISTEMA, type Sistema } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { ESTUDIO } from "./rutas";

/** 5.2.5 LTS (2026-11-24). Subirla: versión y las tres sumas de `blender-<v>.sha256` de blender.org. */
export const BLENDER_VERSION = "5.2.5";
export const BLENDER_DIR = process.env.GEEPER_BLENDER_DIR ?? path.join(ESTUDIO, "blender");
export const URL_BLENDER = `https://download.blender.org/release/Blender${BLENDER_VERSION.split(".").slice(0, 2).join(".")}`;

export interface ArchivoBlender {
  archivo: string;
  /** Carpeta de adentro a la que apunta `actual` ("" = la carpeta donde quedó). */
  raiz: string;
  extraer: "tar-auto" | "dmg";
  /** Ejecutable, relativo a `actual`. */
  ejecutable: string;
  /** Tamaño aproximado de la descarga, para avisar antes. */
  mb: number;
}

/** El archivo oficial para cada sistema (función pura). null: no hay instalación automática. */
export function archivoBlender(sistema: Sistema, arch: string, version = BLENDER_VERSION): ArchivoBlender | null {
  if (sistema === "windows" && arch === "x64") return { archivo: `blender-${version}-windows-x64.zip`, raiz: `blender-${version}-windows-x64`, extraer: "tar-auto", ejecutable: "blender.exe", mb: 420 };
  if (sistema === "windows" && arch === "arm64") return { archivo: `blender-${version}-windows-arm64.zip`, raiz: `blender-${version}-windows-arm64`, extraer: "tar-auto", ejecutable: "blender.exe", mb: 400 };
  if (sistema === "linux" && arch === "x64") return { archivo: `blender-${version}-linux-x64.tar.xz`, raiz: `blender-${version}-linux-x64`, extraer: "tar-auto", ejecutable: "blender", mb: 410 };
  if (sistema === "mac" && arch === "arm64") return { archivo: `blender-${version}-macos-arm64.dmg`, raiz: "", extraer: "dmg", ejecutable: path.join("Blender.app", "Contents", "MacOS", "Blender"), mb: 330 };
  return null;
}

/** Ejecutable de Blender: GEEPER_BLENDER, o el instalado por Geeper. */
export function binBlender(): string {
  if (process.env.GEEPER_BLENDER) return process.env.GEEPER_BLENDER;
  const a = archivoBlender(SISTEMA, process.arch);
  return path.join(BLENDER_DIR, "actual", a?.ejecutable ?? (SISTEMA === "windows" ? "blender.exe" : "blender"));
}

/** Versión instalada («Blender 5.2.5 LTS») o null si no está o no arranca. */
export async function versionBlender(): Promise<string | null> {
  const bin = binBlender();
  if (!existsSync(bin)) return null;
  const r = await correr(bin, ["-b", "--factory-startup", "--version"], { permitirFallo: true, timeout: 60_000 }).catch(() => null);
  const linea = r?.stdout.split("\n").find((l) => /^Blender \d/.test(l.trim()));
  return r?.codigo === 0 && linea ? linea.trim() : null;
}

/** Variables para correr Blender sin que mire internet ni la configuración de la persona. */
export function entornoBlender(): Record<string, string> {
  return { BLENDERMCP_NO_UPDATE_CHECK: "1", PYTHONNOUSERSITE: "1" };
}

/**
 * HDRI de estudio para los reflejos: «Studio Small 09» de Poly Haven (CC0, Sergej Majboroda), 1k, 1,6 MB.
 * Opcional: sin él, las escenas usan una luz gris y siguen funcionando.
 */
export const HDRI = {
  url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr",
  archivo: "studio_small_09_1k.hdr",
  sha256: "e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45",
  licencia: "CC0 (Poly Haven, Sergej Majboroda)",
} as const;

export const rutaHdri = () => path.join(BLENDER_DIR, "hdri", HDRI.archivo);

/** Baja el HDRI si falta (verificado). Devuelve su ruta o null si no se pudo (no es grave). */
export async function asegurarHdri(log: Registro): Promise<string | null> {
  const destino = rutaHdri();
  if (existsSync(destino)) return destino;
  try {
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const r = await fetch(HDRI.url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok || !r.body) throw new Error(`respondió ${r.status}`);
    const tmp = `${destino}.${process.pid}.tmp`;
    const hash = createHash("sha256");
    const cuerpo = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
    cuerpo.on("data", (d: Buffer) => hash.update(d));
    await pipeline(cuerpo, createWriteStream(tmp));
    if (hash.digest("hex") !== HDRI.sha256) {
      await fs.rm(tmp, { force: true });
      throw new Error("no coincide con la suma esperada");
    }
    await fs.rename(tmp, destino);
    return destino;
  } catch (e) {
    log(`Sin la luz de estudio de Poly Haven (${e instanceof Error ? e.message : String(e)}): sigo con luz simple.`);
    return null;
  }
}
