/**
 * Lo que el asistente recomienda para un proyecto (lo mismo que el panel «Asistente» del editor).
 *
 *   pnpm tsx scripts/recomendar.ts <slug>          lista legible
 *   pnpm tsx scripts/recomendar.ts <slug> --json   JSON (para agentes: cada recomendación con sus
 *                                                   `ediciones`, que se pasan tal cual a proponer.ts)
 *
 * Sólo lee: no cambia el proyecto ni usa la GPU.
 */
import { asistenteDe } from "../src/lib/asistente";
import { db } from "../src/lib/db";

const ETIQUETA = { bloquea: "BLOQUEA", mejora: "mejora ", idea: "idea   " } as const;

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) throw new Error("Uso: <slug> [--json]");
  const informe = await asistenteDe({ slug });
  await db.$disconnect();
  if (!informe) throw new Error(`No existe el proyecto «${slug}»`);
  if (args.includes("--json")) {
    console.log(JSON.stringify(informe, null, 2));
    return;
  }
  const { proyecto, recomendaciones } = informe;
  console.log(`${proyecto.nombre} (${proyecto.slug}), versión ${proyecto.version}: ${recomendaciones.length} recomendaciones\n`);
  for (const r of recomendaciones) {
    console.log(`[${ETIQUETA[r.prioridad]}] ${r.titulo}${r.efecto ? ` (${r.efecto})` : ""}${r.gpu ? " · usa la GPU" : ""}`);
    console.log(`           ${r.porque}`);
    if (r.ediciones) console.log(`           ediciones: ${JSON.stringify(r.ediciones)}`);
    if (r.accion) console.log(`           acción: ${r.accion}`);
    if (r.ir) console.log(`           dónde: ${r.ir}`);
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
