/**
 * Procedencia de cada render (C4 de docs/STACK-AGENTICO.md): qué entró en el video, en un documento
 * estándar y verificable. Una *Statement* de in-toto v1 cuyo `subject` es el MP4 (y el .srt y el
 * máster) con su sha256, y un `predicate` propio (`https://geeper.local/procedencia/v1`, con W3C PROV
 * como vocabulario de referencia): versión de Geeper, versión de geeper.json, cada asset con su origen,
 * licencia, modelo y pesos, las herramientas y el resultado del QC.
 *
 * Firma opcional y **local**: si hay `cosign` y una clave en `~/geeper-data/claves/cosign.key`, se
 * firma con `sign-blob` sin subir nada a Rekor (el registro de transparencia de Sigstore es público y
 * Geeper es interno). Sin cosign o sin clave, la declaración queda sin firmar y lo dice.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existe, sha256Archivo } from "./archivos";
import type { Proyecto } from "./esquema";
import { correr } from "./proceso";
import type { InformeQc } from "./qc";
import { dirDatos, FFMPEG, HYPERFRAMES_VERSION, RAIZ_REPO } from "./rutas";

export const TIPO_STATEMENT = "https://in-toto.io/Statement/v1";
export const TIPO_PREDICADO = "https://geeper.local/procedencia/v1";

export interface DatosProcedencia {
  archivos: string[];
  proyecto: { slug: string; version: number; hashVersion: string | null };
  p: Proyecto;
  assetsUsados: string[];
  qc: Pick<InformeQc, "aprobado" | "reglas">;
  geeper: { version: string; commit: string | null };
  herramientas: Record<string, string | null>;
  creado: Date;
}

export interface Statement {
  _type: typeof TIPO_STATEMENT;
  subject: { name: string; digest: { sha256: string } }[];
  predicateType: typeof TIPO_PREDICADO;
  predicate: Record<string, unknown>;
}

const texto = (v: unknown) => (typeof v === "string" ? v : null);

/** Arma la declaración (función pura, salvo por los sha256 que recibe ya calculados). */
export function declaracion(d: DatosProcedencia, hashes: Record<string, string>): Statement {
  const assets = d.assetsUsados
    .map((id) => d.p.assets[id])
    .filter((a) => a !== undefined)
    .map((a) => {
      const r = a.regenerar as Record<string, unknown>;
      const alineacion = r.alineacion as { modelo?: string; pesos?: string | null } | undefined;
      return {
        id: a.id,
        tipo: a.tipo,
        ruta: a.ruta,
        sha256: a.hash,
        // PROV: el asset fue generado por (source) con (modelo, pesos) y atribuido a (licencia).
        source: a.source,
        licencia: a.licencia,
        modelo: texto(r.modelo),
        pesos: texto(r.pesos) ?? alineacion?.pesos ?? null,
        prompt: texto(r.prompt),
        tareaMpt: texto(r.tareaMpt),
        imagenesMpt: (r.imagenesMpt as Record<string, string> | null | undefined) ?? null,
      };
    });
  return {
    _type: TIPO_STATEMENT,
    subject: d.archivos.map((a) => ({ name: path.basename(a), digest: { sha256: hashes[a]! } })),
    predicateType: TIPO_PREDICADO,
    predicate: {
      creado: d.creado.toISOString(),
      geeper: d.geeper,
      proyecto: { ...d.proyecto, formato: d.p.formato, plantilla: d.p.plantilla, comercial: d.p.comercial, plataformas: d.p.plataformas },
      assets,
      herramientas: d.herramientas,
      qc: { aprobado: d.qc.aprobado, reglas: d.qc.reglas.map((r) => ({ id: r.id, ok: r.ok, aviso: Boolean(r.aviso) })) },
    },
  };
}

let ffmpegVersion: string | null | undefined;
async function versionFfmpeg(): Promise<string | null> {
  if (ffmpegVersion === undefined) {
    const r = await correr(FFMPEG, ["-version"], { permitirFallo: true, timeout: 10_000 }).catch(() => null);
    ffmpegVersion = r?.stdout.match(/ffmpeg version (\S+)/)?.[1] ?? null;
  }
  return ffmpegVersion;
}

async function commitGeeper(): Promise<string | null> {
  const r = await correr("git", ["rev-parse", "HEAD"], { cwd: RAIZ_REPO, permitirFallo: true, timeout: 10_000 }).catch(() => null);
  return r?.codigo === 0 ? r.stdout.trim() : null;
}

export const dirClaves = () => path.join(dirDatos(), "claves");
export const COSIGN = process.env.GEEPER_COSIGN ?? path.join(os.homedir(), ".local", "bin", "cosign");

/** Firma la declaración con cosign y una clave local, sin Rekor. Devuelve la ruta de la firma o el motivo. */
export async function firmar(ruta: string): Promise<{ firma: string | null; motivo?: string }> {
  const clave = path.join(dirClaves(), "cosign.key");
  if (!(await existe(COSIGN))) return { firma: null, motivo: "cosign no está instalado" };
  if (!(await existe(clave))) return { firma: null, motivo: `no hay clave en ${clave} (cosign generate-key-pair)` };
  const bundle = `${ruta}.sigstore.json`;
  const r = await correr(COSIGN, ["sign-blob", "--yes", "--key", clave, "--tlog-upload=false", "--use-signing-config=false", "--bundle", bundle, ruta], {
    env: { COSIGN_PASSWORD: process.env.COSIGN_PASSWORD ?? "" },
    permitirFallo: true,
    timeout: 60_000,
  });
  if (r.codigo !== 0) return { firma: null, motivo: r.stderr.trim().split("\n").pop()?.slice(0, 200) ?? "cosign falló" };
  return { firma: bundle };
}

/**
 * Escribe `renders/<base>.procedencia.json` (y la firma si se puede). Nunca hace fallar el render:
 * devuelve null y lo registra si algo sale mal.
 */
export async function escribirProcedencia(
  base: string,
  d: Omit<DatosProcedencia, "geeper" | "herramientas" | "creado">,
  log: (l: string) => void,
): Promise<{ ruta: string; firma: string | null } | null> {
  try {
    const hashes: Record<string, string> = {};
    for (const a of d.archivos) hashes[a] = await sha256Archivo(a);
    const pkg = JSON.parse(await fs.readFile(path.join(RAIZ_REPO, "package.json"), "utf8").catch(() => '{"version":"?"}')) as { version: string };
    const st = declaracion(
      {
        ...d,
        geeper: { version: pkg.version, commit: await commitGeeper() },
        herramientas: { ffmpeg: await versionFfmpeg(), hyperframes: HYPERFRAMES_VERSION },
        creado: new Date(),
      },
      hashes,
    );
    const ruta = `${base}.procedencia.json`;
    await fs.writeFile(ruta, `${JSON.stringify(st, null, 2)}\n`);
    const f = await firmar(ruta);
    log(`Procedencia: ${path.basename(ruta)}${f.firma ? " (firmada con la clave local)" : ` (sin firmar: ${f.motivo})`}`);
    return { ruta, firma: f.firma };
  } catch (e) {
    log(`Procedencia: no se pudo escribir (${e instanceof Error ? e.message : e})`);
    return null;
  }
}
