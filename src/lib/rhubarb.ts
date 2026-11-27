/**
 * Rhubarb Lip Sync 1.14.0 (MIT; sus dependencias son BSD/Boost/MIT): lee una voz y dice qué forma de boca
 * va en cada momento (A–H y X), para los personajes 3D que hablan (py/blender/personaje3d.py). Corre en el
 * procesador y tarda menos de un segundo por cada diez de voz. Se usa con el reconocedor «phonetic», que no
 * depende del idioma (el otro es sólo para inglés).
 *
 * No viaja dentro de Geeper: se baja de su release de GitHub la primera vez que hace falta (unos 87 MB),
 * verificado con la suma SHA-256 fijada aquí (la release no publica sumas), a `<herramientas>/rhubarb/<versión>`.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { crearInstalador, type EstadoInstalacion } from "./instalar-craft";
import { SISTEMA, type Sistema } from "./plataforma";
import { correr, type Registro } from "./proceso";
import { ESTUDIO } from "./rutas";

export const RHUBARB_VERSION = "1.14.0";
export const RHUBARB_DIR = process.env.GEEPER_RHUBARB_DIR ?? path.join(ESTUDIO, "rhubarb");
export const LICENCIA_RHUBARB = "MIT (Rhubarb Lip Sync, Daniel Wolf)";
const BASE = `https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${RHUBARB_VERSION}`;

/** El zip oficial de cada sistema con su suma (función pura). En macOS el binario es x64 (corre con Rosetta en arm64). */
export function archivoRhubarb(sistema: Sistema, version = RHUBARB_VERSION): { archivo: string; raiz: string; sha256: string; ejecutable: string } | null {
  const sumas: Record<string, string> = {
    "1.14.0:linux": "a9a9074862cff47b2d59b8bf399a678a3b0b74f9452ad6ad94cb292913dd8667",
    "1.14.0:windows": "62fa416a8d5e382a3828ee4bef358ce520d0b4cabdeaea75a7ac266d098d1fe3",
    "1.14.0:mac": "f991deacac6c973a14a4431a16a58b842f436531e120cfaea142c87c0d3ab4c5",
  };
  const nombre = { linux: "Linux", windows: "Windows", mac: "macOS" }[sistema];
  const sha256 = sumas[`${version}:${sistema}`];
  if (!nombre || !sha256) return null;
  const raiz = `Rhubarb-Lip-Sync-${version}-${nombre}`;
  return { archivo: `${raiz}.zip`, raiz, sha256, ejecutable: sistema === "windows" ? "rhubarb.exe" : "rhubarb" };
}

export function binRhubarb(): string {
  if (process.env.GEEPER_RHUBARB) return process.env.GEEPER_RHUBARB;
  const a = archivoRhubarb(SISTEMA);
  return path.join(RHUBARB_DIR, "actual", a?.ejecutable ?? "rhubarb");
}

export async function versionRhubarb(): Promise<string | null> {
  const bin = binRhubarb();
  if (!existsSync(bin)) return null;
  const r = await correr(bin, ["--version"], { permitirFallo: true, timeout: 30_000 }).catch(() => null);
  const m = /version\s+(\d+\.\d+\.\d+)/i.exec(`${r?.stdout ?? ""}${r?.stderr ?? ""}`);
  return r?.codigo === 0 && m ? `Rhubarb Lip Sync ${m[1]}` : null;
}

const A = archivoRhubarb(SISTEMA);
const g = globalThis as unknown as { __instaladorRhubarb?: ReturnType<typeof crearInstalador> | null };
const instalador = () =>
  (g.__instaladorRhubarb ??= A
    ? crearInstalador({ app: "rhubarb", version: RHUBARB_VERSION, base: BASE, archivo: A.archivo, sha256: A.sha256, raiz: A.raiz, extraer: "zip", carpeta: RHUBARB_DIR, verificar: versionRhubarb })
    : null);

export function estadoInstalacionRhubarb(): EstadoInstalacion | null {
  return instalador()?.estado() ?? null;
}

/** Lo instala si falta (una vez; si ya se está bajando, espera a esa). Devuelve el ejecutable. */
export async function asegurarRhubarb(log: Registro, avanzar?: (detalle: string, progreso: number) => void): Promise<string> {
  if (await versionRhubarb()) return binRhubarb();
  const i = instalador();
  if (!i) throw new Error("En este equipo no se puede instalar solo lo que mueve la boca de los personajes.");
  log(`Instalando Rhubarb Lip Sync ${RHUBARB_VERSION} (una sola vez, unos 87 MB)…`);
  const vigilar = avanzar ? setInterval(() => { const e = i.estado(); avanzar(e.detalle, e.progreso); }, 1000) : null;
  try {
    const e = await i.esperar();
    if (e.fase !== "lista") throw new Error(`No se pudo instalar lo que mueve la boca: ${e.detalle}`);
  } finally {
    if (vigilar) clearInterval(vigilar);
  }
  return binRhubarb();
}

export const FormaBoca = z.object({ start: z.number(), end: z.number(), value: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "X"]) });
export type FormaBoca = z.infer<typeof FormaBoca>;

/** Las formas de boca de una voz (WAV o MP3; se pasa a WAV mono de 16 kHz antes). */
export async function formasDeBoca(audioWav16k: string, salidaJson: string, log: Registro, signal?: AbortSignal): Promise<FormaBoca[]> {
  const bin = await asegurarRhubarb(log);
  await correr(bin, ["-q", "-r", "phonetic", "-f", "json", "-o", salidaJson, audioWav16k], { log, signal, timeout: 15 * 60_000 });
  const j = JSON.parse(await fs.readFile(salidaJson, "utf8")) as { mouthCues?: unknown };
  return z.array(FormaBoca).parse(j.mouthCues ?? []);
}
