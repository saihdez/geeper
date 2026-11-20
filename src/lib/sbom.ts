/**
 * SBOM de Geeper en CycloneDX 1.7 (C2 de docs/STACK-AGENTICO.md; PRODUCTO.md §9).
 *
 * Un solo documento con lo que entra en un video: los paquetes de npm de producción (con su licencia,
 * de `pnpm licenses list`), los modelos (los de Geeper con el sha256 de sus pesos; los de dentro de MPT
 * por nombre), las imágenes Docker de MPT con su digest (D3), las apps Craft con su release fijada, y
 * ffmpeg y Hyperframes con su versión. Se genera con `pnpm run sbom` → docs/sbom/geeper.cdx.json y se
 * valida contra el esquema oficial de CycloneDX 1.7.
 */
import { Enums, Models, Serialize, SPDX, Spec } from "@cyclonedx/cyclonedx-library";
import { PackageURL } from "packageurl-js";
import { APPS_CRAFT, paginaRelease } from "./craft-web";
import { YUNET } from "./caras";
import type { ImagenContenedor } from "./imagenes";
import { HYPERFRAMES_VERSION, PHOTOCRAFT_VERSION, VECTORCRAFT_VERSION } from "./rutas";

/** Un modelo que usa Geeper. La licencia y el nombre deben coincidir con MODELOS.md (una prueba lo revisa). */
export interface ModeloSbom {
  id: string;
  /** Como aparece en la tabla de MODELOS.md. */
  nombre: string;
  version: string;
  /** Identificador SPDX o nombre de la licencia. */
  licencia: string;
  donde: "geeper" | "mpt";
  /** Clave en PESOS (src/lib/modelos.ts) si Geeper ve el archivo de pesos. */
  pesos?: string;
  origen?: string;
}

export const MODELOS_SBOM: ModeloSbom[] = [
  { id: "whisper-medium", nombre: "whisper `medium` (ggml)", version: "ggml-medium", licencia: "MIT", donde: "geeper", pesos: "whisper-medium", origen: "https://github.com/ggml-org/whisper.cpp" },
  { id: "kokoro-82m-onnx", nombre: "Kokoro-82M", version: "v1.0-onnx", licencia: "Apache-2.0", donde: "geeper", pesos: "kokoro-82m-onnx", origen: "https://huggingface.co/hexgrad/Kokoro-82M" },
  { id: YUNET.id, nombre: "YuNet 2023mar", version: "2023mar", licencia: "MIT", donde: "geeper", pesos: YUNET.id, origen: YUNET.url },
  { id: "parakeet-tdt-0.6b-v3", nombre: "Parakeet TDT 0.6B v3", version: "v3-int8", licencia: "CC-BY-4.0", donde: "geeper", origen: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3" },
  { id: "z-image-turbo", nombre: "Z-Image-Turbo", version: "bf16", licencia: "Apache-2.0", donde: "mpt", origen: "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo" },
  { id: "realvisxl-v5-lightning", nombre: "RealVisXL V5 Lightning", version: "v5.0-lightning", licencia: "OpenRAIL++-M", donde: "mpt", origen: "https://huggingface.co/SG161222/RealVisXL_V5.0_Lightning" },
  { id: "gemma4-26b", nombre: "Gemma 4 26B MoE", version: "26b-q4_k_m", licencia: "Apache-2.0", donde: "mpt", origen: "https://ollama.com/library/gemma4" },
  { id: "gemma4-12b", nombre: "Gemma 4 12B", version: "12b", licencia: "Apache-2.0", donde: "mpt", origen: "https://ollama.com/library/gemma4" },
  { id: "faster-whisper-large-v3", nombre: "faster-whisper `large-v3`", version: "large-v3", licencia: "MIT", donde: "mpt", origen: "https://huggingface.co/Systran/faster-whisper-large-v3" },
];

/** Paquetes de `pnpm licenses list --json`: licencia → paquetes. */
export type LicenciasPnpm = Record<string, { name: string; versions: string[]; homepage?: string; description?: string }[]>;

export interface DatosSbom {
  version: string;
  commit: string | null;
  paquetes: LicenciasPnpm;
  /** id del modelo → sha256 de sus pesos (los que Geeper ve). */
  pesos: Record<string, string | null>;
  imagenes: Record<string, ImagenContenedor> | null;
  ffmpeg: string | null;
  fecha: Date;
  /** sha256 de pnpm-lock.yaml: el doctor avisa si cambió desde que se generó el SBOM. */
  lock: string;
}

export const PROPIEDAD_LOCK = "geeper:pnpm-lock:sha256";
export const RUTA_SBOM_RELATIVA = "docs/sbom/geeper.cdx.json";

// Envuelto: el type guard de la librería deja `never` en la rama del else.
const esSpdx = (x: string): boolean => SPDX.isSupportedSpdxId(x);

function licencia(texto: string): Models.License | null {
  const t = texto.trim();
  if (!t || /^unknown$/i.test(t)) return null;
  if (esSpdx(t)) return new Models.SpdxLicense(t);
  // «MIT and ISC» (pnpm) → expresión SPDX con el operador en mayúsculas.
  const expr = t.replace(/\s+(and|or|with)\s+/gi, (_m, op: string) => ` ${op.toUpperCase()} `);
  if (/\s(AND|OR|WITH)\s/.test(expr)) return new Models.LicenseExpression(expr.startsWith("(") ? expr : `(${expr})`);
  return new Models.NamedLicense(t);
}

function conLicencia(c: Models.Component, texto: string): Models.Component {
  const l = licencia(texto);
  if (l) c.licenses.add(l);
  return c;
}

/** Arma el documento (función pura sobre los datos ya leídos). */
export function construirSbom(d: DatosSbom): Models.Bom {
  const bom = new Models.Bom();
  bom.metadata.timestamp = d.fecha;
  bom.metadata.tools.components.add(new Models.Component(Enums.ComponentType.Application, "geeper-sbom", { version: d.version }));
  const raiz = new Models.Component(Enums.ComponentType.Application, "geeper", {
    version: d.commit ? `${d.version}+${d.commit.slice(0, 12)}` : d.version,
    bomRef: "geeper",
    description: "Estudio de video local de Dimerso (uso interno).",
  });
  bom.metadata.component = raiz;
  bom.metadata.properties.add(new Models.Property(PROPIEDAD_LOCK, d.lock));

  for (const [lic, lista] of Object.entries(d.paquetes)) {
    for (const p of lista) {
      for (const v of p.versions) {
        const purl = new PackageURL("npm", p.name.startsWith("@") ? p.name.split("/")[0]! : undefined, p.name.replace(/^@[^/]+\//, ""), v, undefined, undefined).toString();
        const c = new Models.Component(Enums.ComponentType.Library, p.name, { version: v, bomRef: `npm:${p.name}@${v}`, purl });
        bom.components.add(conLicencia(c, lic));
      }
    }
  }

  for (const m of MODELOS_SBOM) {
    const c = new Models.Component(Enums.ComponentType.MachineLearningModel, m.id, {
      version: m.version,
      bomRef: `modelo:${m.id}`,
      description: m.donde === "mpt" ? `${m.nombre}: corre dentro de MoneyPrinterTurbo; Geeper no ve sus pesos.` : m.nombre,
    });
    const h = m.pesos ? d.pesos[m.pesos] : null;
    if (h) c.hashes.set(Enums.HashAlgorithm["SHA-256"], h);
    if (m.origen) c.externalReferences.add(new Models.ExternalReference(m.origen, Enums.ExternalReferenceType.Distribution));
    bom.components.add(conLicencia(c, m.licencia));
  }

  for (const i of Object.values(d.imagenes ?? {})) {
    const c = new Models.Component(Enums.ComponentType.Container, i.imagen, {
      version: i.digest ?? i.id,
      bomRef: `contenedor:${i.contenedor}`,
      description: `Imagen del contenedor ${i.contenedor} (MoneyPrinterTurbo).${i.digest ? "" : " Construida en local: la versión es el id de la imagen."}`,
    });
    const hex = (i.digest ?? i.id).replace(/^sha256:/, "");
    if (/^[a-f0-9]{64}$/.test(hex)) c.hashes.set(Enums.HashAlgorithm["SHA-256"], hex);
    bom.components.add(c);
  }

  for (const a of APPS_CRAFT) {
    const c = new Models.Component(Enums.ComponentType.Application, a.app, { version: a.version, bomRef: `craft:${a.app}`, description: `${a.nombre} (storytold): ${a.que}` });
    c.externalReferences.add(new Models.ExternalReference(paginaRelease(a), Enums.ExternalReferenceType.Distribution));
    bom.components.add(c);
  }
  // Los CLI de PhotoCraft y VectorCraft fijados en rutas.ts (además de su versión web).
  for (const [app, v] of [["photocraft-cli", PHOTOCRAFT_VERSION], ["vectorcraft-cli", VECTORCRAFT_VERSION]] as const) {
    bom.components.add(new Models.Component(Enums.ComponentType.Application, app, { version: v, bomRef: `craft:${app}` }));
  }

  bom.components.add(conLicencia(new Models.Component(Enums.ComponentType.Application, "hyperframes", { version: HYPERFRAMES_VERSION, bomRef: "hyperframes", purl: new PackageURL("npm", undefined, "hyperframes", HYPERFRAMES_VERSION, undefined, undefined).toString() }), "Apache-2.0"));
  if (d.ffmpeg) bom.components.add(conLicencia(new Models.Component(Enums.ComponentType.Application, "ffmpeg", { version: d.ffmpeg, bomRef: "ffmpeg" }), "LGPL-2.1-or-later"));
  return bom;
}

export function serializarSbom(bom: Models.Bom): string {
  const s = new Serialize.JsonSerializer(new Serialize.JSON.Normalize.Factory(Spec.Spec1dot7));
  return `${s.serialize(bom, { sortLists: true, space: 2 })}\n`;
}
