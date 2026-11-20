/**
 * pnpm run sbom → docs/sbom/geeper.cdx.json (CycloneDX 1.7), validado contra el esquema oficial.
 * Lee: `pnpm licenses list --prod`, el sha256 de los pesos locales, las imágenes de MPT (Docker si
 * responde; si no, lo último que vio el doctor), ffmpeg y el commit. Ver src/lib/sbom.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Spec, Validation } from "@cyclonedx/cyclonedx-library";
import { imagenesConocidas, leerImagenes } from "../src/lib/imagenes";
import { huellaPesos } from "../src/lib/modelos";
import { correr } from "../src/lib/proceso";
import { FFMPEG } from "../src/lib/rutas";
import { sha256Archivo } from "../src/lib/archivos";
import { construirSbom, MODELOS_SBOM, RUTA_SBOM_RELATIVA, serializarSbom, type LicenciasPnpm } from "../src/lib/sbom";

const RAIZ = path.resolve(__dirname, "..");
const RUTA_SBOM = path.join(RAIZ, RUTA_SBOM_RELATIVA);

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(RAIZ, "package.json"), "utf8")) as { version: string };
  const lic = await correr("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: RAIZ, timeout: 120_000 });
  const paquetes = JSON.parse(lic.stdout) as LicenciasPnpm;
  const commit = (await correr("git", ["rev-parse", "HEAD"], { cwd: RAIZ, permitirFallo: true })).stdout.trim() || null;
  const pesos: Record<string, string | null> = {};
  for (const m of MODELOS_SBOM) if (m.pesos) pesos[m.pesos] = await huellaPesos(m.pesos);
  const imagenes = (await leerImagenes().catch(() => null)) ?? (await imagenesConocidas())?.imagenes ?? null;
  const ff = await correr(FFMPEG, ["-version"], { permitirFallo: true, timeout: 10_000 }).catch(() => null);
  const ffmpeg = ff?.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? null;

  const texto = serializarSbom(construirSbom({ version: pkg.version, commit, paquetes, pesos, imagenes, ffmpeg, fecha: new Date(), lock: await sha256Archivo(path.join(RAIZ, "pnpm-lock.yaml")) }));
  const errores = await new Validation.JsonStrictValidator(Spec.Version.v1dot7).validate(texto);
  if (errores) throw new Error(`El SBOM no cumple el esquema de CycloneDX 1.7: ${JSON.stringify(errores).slice(0, 800)}`);
  await fs.mkdir(path.dirname(RUTA_SBOM), { recursive: true });
  await fs.writeFile(RUTA_SBOM, texto);
  const d = JSON.parse(texto) as { components: { type: string }[] };
  const por = d.components.reduce<Record<string, number>>((a, c) => ({ ...a, [c.type]: (a[c.type] ?? 0) + 1 }), {});
  console.log(`SBOM CycloneDX 1.7 válido → ${path.relative(RAIZ, RUTA_SBOM)}`);
  console.log(`  ${Object.entries(por).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (!imagenes) console.log("  Sin imágenes de MPT: Docker no responde y el doctor todavía no las registró.");
  const sinHash = MODELOS_SBOM.filter((m) => m.pesos && !pesos[m.pesos]).map((m) => m.id);
  if (sinHash.length) console.log(`  Pesos no encontrados (sin sha256): ${sinHash.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
