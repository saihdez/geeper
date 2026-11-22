/**
 * Prueba de la UI en el navegador (1440 px y teléfono): recorre las páginas, guarda capturas y
 * falla si hay errores en la consola. Uso: pnpm tsx scripts/ui/capturas.ts <dir-salida> [proyectoId]
 */
import fs from "node:fs";
import path from "node:path";
import { rutaChrome } from "../../src/lib/navegador";
import { chromium } from "playwright-core";

const BASE = process.env.GEEPER_URL ?? "http://localhost:3300";

async function main() {
  const [salida = "capturas", proyecto] = process.argv.slice(2);
  fs.mkdirSync(salida, { recursive: true });
  const navegador = await chromium.launch({ executablePath: rutaChrome() });
  const errores: string[] = [];
  const rutas = ["/", "/nuevo", "/clips", "/anuncios", "/trabajos", "/plantillas", "/cuentas", "/sistema", ...(proyecto ? [`/proyectos/${proyecto}`] : [])];
  for (const [ancho, alto, nombre] of [[1440, 1000, "escritorio"], [390, 844, "telefono"]] as const) {
    const pagina = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    pagina.on("console", (m) => m.type() === "error" && errores.push(`${nombre} ${pagina.url()}: ${m.text()}`));
    pagina.on("pageerror", (e) => errores.push(`${nombre} ${pagina.url()}: ${e.message}`));
    for (const r of rutas) {
      await pagina.goto(BASE + r, { waitUntil: "domcontentloaded" });
      await pagina.waitForTimeout(r === "/sistema" ? 8000 : 1500);
      const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (desborde > 1) errores.push(`${nombre} ${r}: desborde horizontal de ${desborde}px`);
      const archivo = path.join(salida, `${nombre}${r.replace(/\//g, "_") || "_inicio"}.png`);
      await pagina.screenshot({ path: archivo, fullPage: true });
      console.log(archivo);
    }
    await pagina.close();
  }
  await navegador.close();
  if (errores.length) {
    console.error("Errores:\n" + errores.join("\n"));
    process.exit(1);
  }
}
void main();
