/**
 * pnpm run respaldo — copia de seguridad ahora (la base con VACUUM INTO y la carpeta de datos al otro disco).
 * Destino: GEEPER_RESPALDO o /mnt/d/geeper-respaldo. `--solo-base` no copia al otro disco.
 * Para probar sin tocar los datos reales: GEEPER_DATA=/tmp/x GEEPER_DB=/tmp/x/geeper.db GEEPER_RESPALDO=/tmp/y.
 */
import { destinoRespaldo, respaldar } from "../src/lib/respaldo";

async function main() {
  const soloBase = process.argv.includes("--solo-base");
  const r = await respaldar({ destino: soloBase ? null : destinoRespaldo() });
  console.log(`Base respaldada: ${r.base}`);
  if (r.copia) console.log(`Copia en ${r.copia.ruta}: ${r.copia.archivos} archivos (${r.copia.copiados} copiados, ${r.copia.enlazados} sin cambios).`);
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
