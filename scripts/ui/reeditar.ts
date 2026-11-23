/**
 * Prueba de reedición desde la UI (como lo haría una persona): corrige dos subtítulos, quita una
 * escena, cambia a 16:9 y pide el render. Uso: pnpm tsx scripts/ui/reeditar.ts <proyectoId> <dir-capturas>
 */
import fs from "node:fs";
import path from "node:path";
import { rutaChrome } from "../../src/lib/navegador";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.GEEPER_URL ?? "http://localhost:3300";

async function esperarGuardado(p: Page) {
  await p.getByText("Guardado como versión nueva").first().waitFor({ timeout: 20_000 });
}

async function main() {
  const [id, salida = "capturas"] = process.argv.slice(2);
  fs.mkdirSync(salida, { recursive: true });
  const b = await chromium.launch({ executablePath: rutaChrome() });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("dialog", (d) => void d.accept());
  await p.goto(`${BASE}/proyectos/${id}`, { waitUntil: "domcontentloaded" });
  await p.getByRole("heading", { name: "Escenas" }).waitFor();

  // 1 y 2: corregir dos subtítulos.
  const cambios: string[] = [];
  for (const n of [0, 3]) {
    const campo = p.getByRole("textbox", { name: /^Subtítulo en/ }).nth(n);
    const antes = await campo.inputValue();
    // Correcciones realistas: misma longitud (mayúsculas), como arreglar una errata.
    const despues = n === 0 ? antes.replace(/(^|\s)(\p{Ll})/gu, (_m, a: string, c: string) => a + c.toUpperCase()) : antes.toUpperCase();
    await campo.fill(despues);
    await campo.locator("xpath=following-sibling::button[1]").click();
    await esperarGuardado(p);
    cambios.push(`«${antes}» → «${despues}»`);
    await p.waitForTimeout(3500); // deja que la vista se refresque con la versión nueva
  }

  // 3: quitar la escena 3.
  const tarjetas = p.locator("ol > li");
  const totalAntes = await tarjetas.count();
  await tarjetas.nth(2).getByRole("button", { name: "Quitar" }).click();
  await esperarGuardado(p);
  await p.waitForFunction((n) => document.querySelectorAll("ol > li").length === n - 1, totalAntes, { timeout: 20_000 });

  // 4: cambiar a 16:9.
  await p.getByLabel("Forma del video").selectOption("16:9");
  await esperarGuardado(p);
  await p.waitForTimeout(3500);

  // 5: crear el video (no genera nada con la tarjeta de video).
  await p.getByRole("button", { name: /^Crear el video \(sin usar/ }).click();
  await p.getByText("Quedó en cola").waitFor({ timeout: 20_000 });
  await p.screenshot({ path: path.join(salida, "reedicion-pedida.png"), fullPage: true });
  console.log(JSON.stringify({ subtitulos: cambios, escenas: `${totalAntes} → ${totalAntes - 1}`, formato: "16:9" }, null, 1));
  await b.close();
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
