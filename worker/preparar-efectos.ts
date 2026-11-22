/**
 * Prepara de una vez los sonidos listos que faltan en la biblioteca (GPU-05): encola un solo trabajo
 * «Preparar los sonidos listos», que corre en la fila de la tarjeta gráfica con una sola carga del modelo.
 * No usa la tarjeta por su cuenta: el worker lo corre cuando le toca, como cualquier otro trabajo.
 *
 * Uso: pnpm exec tsx worker/preparar-efectos.ts [--dry-run]
 */
import { encolar } from "@/lib/cola";
import { prepararDb } from "@/lib/db";
import { presetsQueFaltan } from "@/lib/efectos-sonido";

async function main() {
  const faltan = await presetsQueFaltan();
  if (!faltan.length) {
    console.log("Los sonidos listos ya están todos en la biblioteca.");
    return;
  }
  console.log(`Faltan ${faltan.length} sonidos listos: ${faltan.map((f) => f.nombre).join(", ")}`);
  if (process.argv.includes("--dry-run")) {
    console.log("(--dry-run: no se encola nada)");
    return;
  }
  await prepararDb();
  const t = await encolar(null, "efectos.preparar", {});
  console.log(`Encolado el trabajo ${t.id}: míralo en Trabajos.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
