/**
 * pnpm run test:reales — todas las pruebas, también las que hacen trabajo de verdad (whisper, PhotoCraft,
 * VectorCraft, la paridad con el estudio; ver tests/ayudas/reales.ts). `pnpm test` las salta (ESC-05).
 *
 * Es un script de node y no `GEEPER_PRUEBAS_REALES=1 vitest run` para que funcione igual en Windows, donde
 * la terminal no entiende esa forma de poner variables. Los argumentos pasan a vitest:
 *   pnpm run test:reales -- tests/whisper.test.ts
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(raiz, "node_modules", "vitest", "vitest.mjs");
const args = process.argv.slice(2).filter((a) => a !== "--");

const hijo = spawn(process.execPath, [vitest, "run", ...args], {
  cwd: raiz,
  stdio: "inherit",
  env: { ...process.env, GEEPER_PRUEBAS_REALES: "1" },
});
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => hijo.kill(s));
hijo.on("error", (e) => {
  console.error(`No se pudo lanzar vitest: ${e.message}`);
  process.exit(1);
});
hijo.on("exit", (codigo, senal) => process.exit(codigo ?? (senal ? 1 : 0)));
