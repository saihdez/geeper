/**
 * Chequeos del doctor para la evidencia (C2 y D3 de docs/STACK-AGENTICO.md): SBOM al día, avisos de
 * `pnpm audit` y cambios en las imágenes Docker de MPT. Todos son avisos: no impiden trabajar.
 *
 * No importa la librería de CycloneDX (es de desarrollo): sólo lee el JSON del SBOM.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sha256Archivo } from "./archivos";
import type { Chequeo } from "./doctor";
import { revisarImagenes } from "./imagenes";
import { correr } from "./proceso";
import { RAIZ_REPO } from "./rutas";

const RUTA_SBOM = "docs/sbom/geeper.cdx.json";
const PROPIEDAD_LOCK = "geeper:pnpm-lock:sha256";

export async function chequeoSbom(raiz = RAIZ_REPO): Promise<Chequeo> {
  const nombre = "SBOM (CycloneDX)";
  let sbom: { metadata?: { timestamp?: string; properties?: { name: string; value: string }[] } };
  try {
    sbom = JSON.parse(await fs.readFile(path.join(raiz, RUTA_SBOM), "utf8"));
  } catch {
    return { nombre, ok: false, aviso: true, detalle: `falta ${RUTA_SBOM}`, arreglo: "pnpm run sbom" };
  }
  const lock = sbom.metadata?.properties?.find((p) => p.name === PROPIEDAD_LOCK)?.value;
  const actual = await sha256Archivo(path.join(raiz, "pnpm-lock.yaml")).catch(() => null);
  const fecha = sbom.metadata?.timestamp?.slice(0, 10) ?? "?";
  if (!lock || lock !== actual) {
    return { nombre, ok: true, aviso: true, detalle: `del ${fecha}, de antes del último cambio de dependencias`, arreglo: "pnpm run sbom   (y commitea docs/sbom/geeper.cdx.json)" };
  }
  return { nombre, ok: true, detalle: `al día (${fecha})` };
}

interface Auditoria {
  metadata?: { vulnerabilities?: Record<string, number> };
  advisories?: Record<string, { module_name: string; severity: string; title: string; patched_versions?: string }>;
}

/** Resume `pnpm audit --prod --json` (función pura). */
export function resumirAuditoria(a: Auditoria): Chequeo {
  const v = a.metadata?.vulnerabilities ?? {};
  const graves = (v.high ?? 0) + (v.critical ?? 0);
  const lista = Object.values(a.advisories ?? {})
    .filter((x) => x.severity === "high" || x.severity === "critical")
    .map((x) => `${x.module_name} (${x.severity}${x.patched_versions ? `, arreglado en ${x.patched_versions}` : ""})`);
  const otras = (v.moderate ?? 0) + (v.low ?? 0);
  if (!graves) return { nombre: "Dependencias (pnpm audit)", ok: true, aviso: otras > 0, detalle: otras ? `sin altas ni críticas; ${otras} moderada(s) o baja(s)` : "sin vulnerabilidades conocidas" };
  return {
    nombre: "Dependencias (pnpm audit)",
    ok: true,
    aviso: true,
    detalle: `${graves} alta(s) o crítica(s): ${[...new Set(lista)].join(", ")}`,
    arreglo: "pnpm audit --prod   para el detalle; actualiza la dependencia (o la que la trae) y corre las pruebas",
  };
}

export async function chequeoAuditoria(raiz = RAIZ_REPO): Promise<Chequeo> {
  const r = await correr("pnpm", ["audit", "--prod", "--json"], { cwd: raiz, permitirFallo: true, timeout: 60_000 }).catch(() => null);
  try {
    return resumirAuditoria(JSON.parse(r?.stdout ?? "") as Auditoria);
  } catch {
    return { nombre: "Dependencias (pnpm audit)", ok: true, aviso: true, detalle: "no se pudo consultar (¿sin internet?)" };
  }
}

export async function chequeoImagenes(): Promise<Chequeo> {
  const nombre = "Imágenes Docker de MPT (digest)";
  const r = await revisarImagenes().catch(() => null);
  if (!r) return { nombre, ok: true, aviso: true, detalle: "Docker no responde: no se pudo revisar", arreglo: "Abre Docker Desktop y vuelve a correr el doctor." };
  const n = Object.keys(r.actuales).length;
  if (r.cambios.length) {
    return {
      nombre,
      ok: true,
      aviso: true,
      detalle: `cambió la imagen de ${r.cambios.map((c) => `${c.contenedor} (${c.antes.slice(7, 19)} → ${c.ahora.slice(7, 19)})`).join(", ")}`,
      arreglo: "MPT se actualizó por debajo: lo generado desde ahora puede salir distinto. Anótalo y regenera el SBOM (pnpm run sbom).",
    };
  }
  return { nombre, ok: true, detalle: r.primeraVez ? `${n} registrada(s) por primera vez` : `${n} sin cambios` };
}

/** Firma de la procedencia (C4): cosign y una clave local. Opcional: sin ellos, la procedencia va sin firmar. */
export async function chequeoFirma(): Promise<Chequeo> {
  const { COSIGN, dirClaves } = await import("./procedencia");
  const nombre = "Firma de la procedencia (cosign)";
  const clave = path.join(dirClaves(), "cosign.key");
  const bin = await correr(COSIGN, ["version"], { permitirFallo: true, timeout: 10_000 }).catch(() => null);
  if (!bin || bin.codigo !== 0) {
    return { nombre, ok: true, aviso: true, detalle: "cosign no está: la procedencia de cada render va sin firmar", arreglo: "Opcional: instala cosign en ~/.local/bin (release fijada y SHA-256, ver DECISIONES §30)." };
  }
  const v = bin.stdout.match(/GitVersion:\s*(\S+)/)?.[1] ?? "?";
  const hay = await fs.access(clave).then(() => true, () => false);
  if (!hay) {
    return {
      nombre, ok: true, aviso: true, detalle: `cosign ${v}, pero sin clave`,
      arreglo: `mkdir -p ${dirClaves()} && cd ${dirClaves()} && COSIGN_PASSWORD= ${COSIGN} generate-key-pair && chmod 600 cosign.key`,
    };
  }
  return { nombre, ok: true, detalle: `cosign ${v} con clave local (sin Rekor)` };
}
