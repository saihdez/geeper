/**
 * Genera docs/esquemas/*.schema.json (JSON Schema 2020-12) desde los esquemas Zod.
 *
 *   pnpm run esquemas            escribe los archivos
 *   pnpm run esquemas --revisar  sólo dice si alguno está desactualizado (código 1 si sí)
 *
 * Ver src/lib/contratos.ts y docs/STACK-AGENTICO.md (A2).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CONTRATOS, rutaRelativaEsquema, textoEsquema } from "../src/lib/contratos";

const RAIZ = path.resolve(__dirname, "..");
const revisar = process.argv.includes("--revisar");

async function main() {
  let viejos = 0;
  for (const c of CONTRATOS) {
    const relativa = rutaRelativaEsquema(c.nombre);
    const ruta = path.join(RAIZ, relativa);
    const nuevo = textoEsquema(c);
    const actual = await fs.readFile(ruta, "utf8").catch(() => null);
    if (actual === nuevo) {
      console.log(`  igual       ${relativa}`);
      continue;
    }
    viejos++;
    if (revisar) {
      console.log(`  desactualizado ${relativa}`);
      continue;
    }
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    await fs.writeFile(ruta, nuevo);
    console.log(`  escrito     ${relativa}`);
  }
  if (revisar && viejos) {
    console.error(`\n${viejos} esquema(s) desactualizado(s): corre «pnpm run esquemas».`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
