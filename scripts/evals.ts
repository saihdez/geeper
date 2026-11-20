/**
 * pnpm run evals [suite…] [--falso]  — corre las suites de Promptfoo de evals/ (C3 de STACK-AGENTICO.md).
 *
 * Usa la GPU (gpu-lock, espera su turno): no va en CI. Compara gemma4:26b y gemma4:12b con aserciones
 * deterministas (esquema, largos, idioma, inventos) y un juez local (gemma4:26b). Guarda JSON y HTML en
 * ~/dev/video-tools/pruebas/evals/<fecha>/ e imprime una tabla para anotar en MODELOS.md.
 * Suites: ganchos, titulos, anuncios, director (por defecto, todas).
 * --falso: el proveedor responde sin modelo (prueba la tubería, no los modelos).
 * --modelo gemma4:12b: sólo ese modelo, y también como juez (cuando el otro no cabe en la GPU).
 * Promptfoo va fijado y con la telemetría, las actualizaciones y el «compartir» apagados.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { correr } from "../src/lib/proceso";
import { ESTUDIO } from "../src/lib/rutas";

export const PROMPTFOO = "promptfoo@0.125.1";
const SUITES = ["ganchos", "titulos", "anuncios", "director"];
const RAIZ = path.resolve(__dirname, "..");

interface Resultado {
  results: { results: { provider: { label?: string; id: string }; success: boolean; score: number; error?: string }[] };
}

async function main() {
  const args = process.argv.slice(2);
  const falso = args.includes("--falso");
  const iModelo = args.indexOf("--modelo");
  const modelo = iModelo >= 0 ? args[iModelo + 1] : undefined;
  if (iModelo >= 0 && !modelo) throw new Error("--modelo pide un nombre, p. ej. gemma4:12b");
  const elegidas = args.filter((a, i) => !a.startsWith("--") && !(iModelo >= 0 && i === iModelo + 1));
  const suites = elegidas.length ? elegidas : SUITES;
  const malas = suites.filter((s) => !SUITES.includes(s));
  if (malas.length) throw new Error(`Suites desconocidas: ${malas.join(", ")} (hay: ${SUITES.join(", ")})`);
  const fecha = new Date().toISOString().slice(0, 16).replace(":", "");
  const dir = falso ? fs.mkdtempSync(path.join(os.tmpdir(), "geeper-evals-")) : path.join(ESTUDIO, "pruebas", "evals", fecha);
  fs.mkdirSync(dir, { recursive: true });
  const env = {
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
    PROMPTFOO_DISABLE_SHARING: "1",
    PROMPTFOO_DISABLE_REMOTE_GENERATION: "1",
    ...(falso ? { GEEPER_EVALS_FALSO: "1" } : {}),
    ...(modelo ? { GEEPER_EVALS_JUEZ: modelo } : {}),
  };
  const filtro = modelo ? ["--filter-providers", modelo.replace(":", "-")] : [];
  const filas: string[] = ["| Suite | Modelo | Pasan | Puntaje medio | Errores |", "|---|---|---|---|---|"];
  for (const s of suites) {
    console.error(`▶ ${s}${falso ? " (falso)" : ""}`);
    const salida = path.join(dir, `${s}.json`);
    await correr("npx", ["-y", PROMPTFOO, "eval", "-c", `evals/${s}.yaml`, "--no-cache", "--no-write", "--no-progress-bar", ...filtro, "-o", salida, "-o", path.join(dir, `${s}.html`)], {
      cwd: RAIZ,
      env,
      timeout: 4 * 3600_000,
      permitirFallo: true, // Promptfoo sale con 100 si alguna prueba falla: igual hay resultados.
      log: (l) => console.error(`  ${l}`),
    });
    if (!fs.existsSync(salida)) throw new Error(`Promptfoo no dejó resultados de ${s}`);
    const r = JSON.parse(fs.readFileSync(salida, "utf8")) as Resultado;
    const por = new Map<string, { n: number; ok: number; puntaje: number; errores: number }>();
    for (const x of r.results.results) {
      const k = x.provider.label ?? x.provider.id;
      const a = por.get(k) ?? { n: 0, ok: 0, puntaje: 0, errores: 0 };
      a.n++;
      if (x.success) a.ok++;
      if (x.error && !x.success && /exit|código|Error:/i.test(x.error)) a.errores++;
      a.puntaje += x.score ?? 0;
      por.set(k, a);
    }
    for (const [k, a] of por) filas.push(`| ${s} | ${k} | ${a.ok}/${a.n} | ${(a.puntaje / a.n).toFixed(2)} | ${a.errores} |`);
  }
  console.log(filas.join("\n"));
  console.log(`\nResultados (JSON y HTML) en ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
