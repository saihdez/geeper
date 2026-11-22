/**
 * Encuentra qué elementos se salen del ancho de la página (desborde horizontal) en una ruta.
 * Uso: GEEPER_URL=http://localhost:3300 pnpm tsx scripts/ui/desborde.ts /proyectos/<id> [ancho=390]
 */
import { rutaChrome } from "../../src/lib/navegador";
import { chromium } from "playwright-core";

async function main() {
  const [ruta = "/", ancho = "390"] = process.argv.slice(2);
  const base = process.env.GEEPER_URL ?? "http://localhost:3300";
  const navegador = await chromium.launch({ executablePath: rutaChrome() });
  const pagina = await navegador.newPage({ viewport: { width: Number(ancho), height: 844 } });
  await pagina.goto(base + ruta, { waitUntil: "networkidle" });
  await pagina.waitForTimeout(1500);
  const culpables = await pagina.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && r.width > 0) {
        // Sólo el más externo de cada rama: si el padre ya se sale, el hijo no aporta.
        const padre = el.parentElement?.getBoundingClientRect();
        if (padre && padre.right > W + 1) continue;
        const clase = typeof el.className === "string" ? el.className.slice(0, 80) : "";
        out.push(`${el.tagName.toLowerCase()}.${clase} → right ${Math.round(r.right)} (ancho ${Math.round(r.width)}) «${(el.textContent ?? "").trim().slice(0, 50)}»`);
      }
    }
    return { W, total: document.documentElement.scrollWidth, out: out.slice(0, 15) };
  });
  console.log(`ancho ${culpables.W}, scroll ${culpables.total}`);
  for (const c of culpables.out) console.log(c);
  await navegador.close();
}

void main();
