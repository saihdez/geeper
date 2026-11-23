/** Relanza desde la página Trabajos el primer trabajo «interrumpido» con «Volver a intentar» (como lo haría una persona). */
import { rutaChrome } from "../../src/lib/navegador";
import { chromium } from "playwright-core";

async function main() {
  const b = await chromium.launch({ executablePath: rutaChrome() });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${process.env.GEEPER_URL ?? "http://localhost:3300"}/trabajos`, { waitUntil: "domcontentloaded" });
  await p.getByText("interrumpido").first().waitFor({ timeout: 20_000 });
  const fila = p.locator("li", { hasText: "interrumpido" }).first();
  console.log((await fila.innerText()).split("\n").slice(0, 3).join(" | "));
  await fila.getByRole("button", { name: "Volver a intentar" }).click();
  await p.waitForTimeout(2500);
  await b.close();
}
void main();
