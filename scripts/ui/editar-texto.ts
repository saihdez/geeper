/**
 * Prueba de la edición por texto desde la UI: clic en la primera palabra de la escena 2, «Recortar»,
 * comprueba que la palabra queda tachada y la versión sube; después «Restaurar».
 * Uso: GEEPER_URL=http://localhost:3300 pnpm tsx scripts/ui/editar-texto.ts <proyectoId>
 */
import { rutaChrome } from "../../src/lib/navegador";
import { chromium } from "playwright-core";

async function version(base: string, id: string): Promise<number> {
  const r = (await (await fetch(`${base}/api/proyectos/${id}`)).json()) as { fila: { versionActual: number } };
  return r.fila.versionActual;
}

async function main() {
  const [id] = process.argv.slice(2);
  if (!id) throw new Error("Falta el id del proyecto");
  const base = process.env.GEEPER_URL ?? "http://localhost:3300";
  const navegador = await chromium.launch({ executablePath: rutaChrome() });
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 1000 } });
  const errores: string[] = [];
  pagina.on("pageerror", (e) => errores.push(e.message));
  await pagina.goto(`${base}/proyectos/${id}`, { waitUntil: "networkidle" });
  const escena = pagina.locator("li.tarjeta").nth(1);
  const palabra = escena.getByLabel("Palabras de la escena").getByRole("button").first();
  const texto = (await palabra.textContent())?.trim();
  const antes = await version(base, id);
  await palabra.click();
  await escena.getByRole("button", { name: /^Recortar/ }).click();
  await pagina.waitForFunction(
    () => Array.from(document.querySelectorAll("li.tarjeta"))[1]?.querySelector('[aria-label="Palabras de la escena"] button.line-through') != null,
    null,
    { timeout: 15_000 },
  );
  const despues = await version(base, id);
  console.log(`Recortar «${texto}»: versión ${antes} → ${despues}`);
  if (despues !== antes + 1) throw new Error("No se guardó una versión nueva");
  await escena.getByLabel("Palabras de la escena").getByRole("button").first().click();
  await escena.getByRole("button", { name: "Restaurar" }).click();
  await pagina.waitForFunction(
    () => Array.from(document.querySelectorAll("li.tarjeta"))[1]?.querySelector('[aria-label="Palabras de la escena"] button.line-through') === null,
    null,
    { timeout: 15_000 },
  );
  console.log(`Restaurar: versión ${await version(base, id)}`);
  if (errores.length) throw new Error(`Errores en la página: ${errores.join("; ")}`);
  await navegador.close();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
