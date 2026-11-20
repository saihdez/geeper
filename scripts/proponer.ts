/**
 * Propuestas de cambio a geeper.json (para Claude o a mano).
 *
 *   pnpm tsx scripts/proponer.ts <slug> propuesta.json            valida y muestra las diferencias
 *   pnpm tsx scripts/proponer.ts <slug> propuesta.json --aplicar  además la guarda como versión nueva
 *   ... --informe   un solo JSON en stdout: por paso su número, tipo y estado (ok, error u omitido),
 *                   las diferencias y si se aplicó. Para agentes (idea de `pdfcraft-cli run --report`).
 *
 * propuesta.json puede ser:
 *   - una lista de ediciones: [{"tipo":"quitarEscena","escena":"e03"}, ...]  (ver src/lib/ediciones.ts)
 *   - un geeper.json completo (se valida entero con el esquema).
 * Nada se aplica sin --aplicar, y nada se aplica si un paso falla: el error dice cuál.
 *
 * Un paso puede usar lo que creó otro: "$1.id" es el id que creó el paso 1 (un texto, un clip),
 * "$ultimo.id" el del paso anterior y "${1.id}" lo mete dentro de un texto. Ver src/lib/encadenar.ts.
 */
import fs from "node:fs";
import { guardarProyecto } from "../src/lib/almacen";
import { db } from "../src/lib/db";
import { evaluarPropuesta } from "../src/lib/propuestas";
import { versionDeProyecto } from "../src/lib/render";

async function main() {
  const args = process.argv.slice(2);
  const banderas = new Set(args.filter((a) => a.startsWith("--")));
  const [slug, ruta] = args.filter((a) => !a.startsWith("--"));
  const informe = banderas.has("--informe");
  if (!slug || !ruta) throw new Error("Uso: <slug> <propuesta.json> [--aplicar] [--informe]");
  const fila = await db.proyecto.findUniqueOrThrow({ where: { slug } });
  const { p: actual, numero } = await versionDeProyecto(fila.id);
  const entrada = JSON.parse(fs.readFileSync(ruta, "utf8")) as unknown;
  const { nuevo, pasos, diferencias, fallo, error } = evaluarPropuesta(actual, entrada);
  if (error) throw new Error(error);
  let aplicada: number | null = null;
  if (nuevo && banderas.has("--aplicar")) {
    aplicada = await guardarProyecto(fila.id, nuevo, "Propuesta aplicada desde la línea de comandos");
  }
  await db.$disconnect();

  if (informe) {
    console.log(JSON.stringify({ slug, version: numero, valida: !!nuevo, pasos, diferencias, aplicada }, null, 2));
  } else if (fallo) {
    for (const x of pasos) console.log(`  paso ${x.n} (${x.tipo}): ${x.estado}${x.error ? ` — ${x.error}` : ""}${x.resultado?.id ? ` → creó ${x.resultado.id}` : ""}`);
    console.error(`\nLa propuesta falla en el paso ${fallo.n} (${fallo.tipo}). No se aplicó nada.`);
  } else {
    console.log(`Proyecto ${slug}, versión actual ${numero}. Propuesta válida. Diferencias:`);
    for (const [k, d] of Object.entries(diferencias)) console.log(`\n## ${k}\n${d.join("\n")}`);
    console.log(aplicada !== null
      ? `\nAplicada como versión ${aplicada}. Renderiza desde la UI para verla.`
      : "\nNo se aplicó nada. Repite con --aplicar para guardarla como versión nueva.");
  }
  if (!nuevo) process.exitCode = 1;
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
