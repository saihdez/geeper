/**
 * Uso: pnpm tsx scripts/ui/vista-en-vivo.ts <proyectoId> [carpetaSalida]
 * Abre el proyecto, pasa a «En vivo», espera al <hyperframes-player>, salta a varios momentos y guarda
 * capturas. Falla si hay errores de consola o si el player no llega a estar listo.
 */
import fs from "node:fs";
import path from "node:path";
import { rutaChrome } from "../../src/lib/navegador";
import { chromium } from "playwright-core";

const BASE = process.env.GEEPER_URL ?? "http://localhost:3300";

async function main() {
  const [id, salida = "/tmp/vista-en-vivo"] = process.argv.slice(2);
  if (!id) throw new Error("Falta el id del proyecto");
  fs.mkdirSync(salida, { recursive: true });
  const nav = await chromium.launch({ executablePath: rutaChrome() });
  const pag = await nav.newPage({ viewport: { width: 1440, height: 1000 } });
  const errores: string[] = [];
  // Los ERR_ABORTED de los videos al saltar son normales (el navegador cancela lecturas por rango).
  pag.on("console", (m) => m.type() === "error" && !/ERR_ABORTED/.test(m.text()) && errores.push(m.text()));
  pag.on("pageerror", (e) => errores.push(e.message));
  await pag.goto(`${BASE}/proyectos/${id}`, { waitUntil: "domcontentloaded" });
  await pag.getByRole("tab", { name: "En vivo" }).click();
  const player = pag.locator("hyperframes-player");
  await player.waitFor({ timeout: 30_000 });
  const t0 = Date.now();
  // Fragmentos como texto: tsx inyecta `__name` en las funciones y el navegador no lo conoce.
  const duracion = (await pag.evaluate(`new Promise((ok, mal) => {
    const p = document.querySelector("hyperframes-player");
    const ver = () => { if (p.duration > 0) ok(p.duration); };
    p.addEventListener("ready", ver);
    setInterval(ver, 200);
    setTimeout(() => mal(new Error("el player no quedó listo en 30 s")), 30000);
  })`)) as number;
  console.log(`listo en ${Date.now() - t0} ms, duración ${duracion.toFixed(2)} s`);
  for (const t of [1, duracion / 2, duracion - 1.5]) {
    await pag.evaluate(`document.querySelector("hyperframes-player").seek(${t})`);
    await pag.waitForTimeout(1200);
    const f = path.join(salida, `t${t.toFixed(1)}.png`);
    await player.screenshot({ path: f });
    console.log(`captura ${f}`);
  }
  await nav.close();
  if (errores.length) {
    console.error(`Errores de consola:\n${errores.join("\n")}`);
    process.exit(1);
  }
  console.log("OK sin errores de consola");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
