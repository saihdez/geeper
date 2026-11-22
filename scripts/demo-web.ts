/**
 * Demo de producto desde una URL (idea de cap-demo de Cap, rehecha para Geeper; ver src/lib/demo-web.ts
 * y HEREDADO.md «Cap»). En la web es «Nuevo → Desde una página web» (con voz y QC); esto es la versión de
 * terminal, que sólo hace el video de la página.
 *
 *   pnpm tsx scripts/demo-web.ts <url> [opciones]
 *
 * Opciones: --formato 16:9|9:16 (9:16 graba la versión móvil) · --estilo 3d|plano (plano: sin
 *   perspectiva, zoom en cada clic) · --historia clic|scroll (por defecto, clic si hay un botón que
 *   lleva a contenido) · --fondo RRGGBB,RRGGBB (degradado a ojo: en sitios claros o con degradados el
 *   color medido miente) · --max 12 (segundos) · --salida DIR · --slug NOMBRE · --solo-toma (no
 *   renderiza) · --retratar (sólo vuelve a componer y renderizar una toma ya hecha).
 *
 * Sale en <salida>/<slug>-demo.mp4 (por defecto ~/geeper-data/demos/<slug>/), sin audio, con qa-*.jpg
 * (fotogramas de los momentos clave) para revisarlos antes de usarlo.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { hex, leerHex, type EstiloDemo, type FormatoDemo, type Historia, type RegistroDemo } from "../src/lib/demo-web";
import { renderDemo, tomarDemo } from "../src/lib/demo-web-toma";
import { dirDatos } from "../src/lib/rutas";

function leerBanderas(args: string[]) {
  const pos: string[] = [];
  const op: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) pos.push(a);
    else if (["--solo-toma", "--retratar"].includes(a)) op[a.slice(2)] = "1";
    else {
      const v = args[++i];
      if (v === undefined) throw new Error(`Falta el valor de ${a}`);
      op[a.slice(2)] = v;
    }
  }
  return { pos, op };
}

async function main() {
  const { pos, op } = leerBanderas(process.argv.slice(2));
  const [url] = pos;
  if (!url || !/^https?:\/\//.test(url)) throw new Error("Uso: pnpm tsx scripts/demo-web.ts <https://…> [--formato 16:9|9:16] [--estilo 3d|plano] [--historia clic|scroll] [--fondo RRGGBB,RRGGBB] [--max 12] [--salida DIR] [--slug NOMBRE] [--solo-toma] [--retratar]");
  const formato = (op.formato ?? "16:9") as FormatoDemo;
  if (!["16:9", "9:16"].includes(formato)) throw new Error("--formato es 16:9 o 9:16");
  const estilo = (op.estilo ?? "3d") as EstiloDemo;
  if (!["3d", "plano"].includes(estilo)) throw new Error("--estilo es 3d o plano");
  const historia = op.historia as Historia | undefined;
  if (historia && !["clic", "scroll"].includes(historia)) throw new Error("--historia es clic o scroll");
  const maximo = Number(op.max ?? 12);
  if (!(maximo >= 4 && maximo <= 60)) throw new Error("--max va de 4 a 60 s");
  const slug = op.slug ?? `${new URL(url).host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${formato.replace(":", "x")}`;
  const dir = path.resolve(op.salida ?? path.join(dirDatos(), "demos", slug));
  await fsp.mkdir(dir, { recursive: true });
  const log = (l: string) => console.log(l);

  const r: RegistroDemo = op.retratar
    ? (JSON.parse(await fsp.readFile(path.join(dir, "toma.json"), "utf8")) as RegistroDemo)
    : await tomarDemo(url, dir, { formato, historia, duracionMin: maximo + 3, log });
  if (op["solo-toma"]) {
    console.log(`Toma en ${path.join(dir, "toma.mp4")} (registro: ${path.join(dir, "toma.json")})`);
    return;
  }
  let fondo: { desde: string; hasta: string } | undefined;
  if (op.fondo) {
    const [a, b] = op.fondo.split(",");
    if (!a || !b) throw new Error("--fondo es RRGGBB,RRGGBB");
    fondo = { desde: hex(leerHex(a)), hasta: hex(leerHex(b)) };
  }
  const salida = path.join(dir, `${slug}-demo.mp4`);
  await renderDemo(dir, r, { estilo, maximo, fondo, salida, log, fotogramas: true });
  console.log(`Listo: ${salida}\nRevisar: ${dir}/qa-*.jpg`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
