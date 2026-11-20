/**
 * Mide el QC visual con IA sobre las hojas de contacto que ya existen (E1 de STACK-AGENTICO.md), para
 * decidir modelo y si algún día bloquea. Usa la GPU (espera su turno con gpu-lock).
 *
 *   pnpm tsx scripts/medir-qc-vision.ts <modelo> [<modelo>…] [--max 30]
 *
 * Deja en ~/dev/video-tools/pruebas/qc-vision/<fecha>/ una tabla por modelo con lo que marcó en cada
 * render y una columna «¿real?» para que una persona la llene mirando la hoja. Con eso se cuentan los
 * falsos positivos (la regla no bloquea hasta medirlos en 30 renders).
 */
import fs from "node:fs";
import path from "node:path";
import { revisarHojaVisual } from "../src/lib/qc-vision";
import { dirDatos, ESTUDIO } from "../src/lib/rutas";

interface Hoja {
  render: string;
  hoja: string;
  fotos: { nota: string }[];
}

function hojas(max: number): Hoja[] {
  const salida: Hoja[] = [];
  for (const proyecto of fs.readdirSync(dirDatos()).sort()) {
    const renders = path.join(dirDatos(), proyecto, "renders");
    if (!fs.existsSync(renders)) continue;
    for (const qc of fs.readdirSync(renders).filter((a) => a.endsWith(".qc.json")).sort()) {
      const informe = JSON.parse(fs.readFileSync(path.join(renders, qc), "utf8")) as { hojaContacto?: string; fotogramas?: { nota: string }[] };
      const hoja = informe.hojaContacto && path.join(dirDatos(), proyecto, informe.hojaContacto);
      if (!hoja || !fs.existsSync(hoja) || !informe.fotogramas?.length) continue;
      salida.push({ render: `${proyecto}/${qc.replace(/\.qc\.json$/, "")}`, hoja, fotos: informe.fotogramas });
      if (salida.length >= max) return salida;
    }
  }
  return salida;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--max");
  const max = i >= 0 ? Number(args[i + 1]) : 30;
  const modelos = args.filter((a, k) => !a.startsWith("--") && !(i >= 0 && k === i + 1));
  if (!modelos.length) throw new Error("Uso: <modelo> [<modelo>…] [--max 30]");
  const lista = hojas(max);
  if (!lista.length) throw new Error(`No hay hojas de contacto en ${dirDatos()}: renderiza algo primero.`);
  const dir = path.join(ESTUDIO, "pruebas", "qc-vision", new Date().toISOString().slice(0, 16).replace(":", ""));
  fs.mkdirSync(dir, { recursive: true });
  for (const modelo of modelos) {
    const filas = ["| Render | Marcó | Detalle | ¿Real? (sí/no/en parte) |", "|---|---|---|---|"];
    let marcados = 0;
    let fallidos = 0;
    const t0 = Date.now();
    for (const h of lista) {
      console.error(`▶ ${modelo} · ${h.render}`);
      const r = await revisarHojaVisual(h.hoja, h.fotos, { modelo });
      const revisado = (r?.medido as { revisado?: boolean } | undefined)?.revisado !== false;
      if (!revisado) fallidos++;
      else if (r && !r.ok) marcados++;
      filas.push(`| ${h.render} | ${!revisado ? "no se pudo" : r?.ok ? "nada" : "sí"} | ${(r?.detalle ?? "").replace(/\|/g, "/")} |  |`);
    }
    const resumen = `${modelo}: ${lista.length} hojas, marcó ${marcados}, sin revisar ${fallidos}, ${((Date.now() - t0) / 1000 / lista.length).toFixed(1)} s por hoja`;
    fs.writeFileSync(path.join(dir, `${modelo.replace(/[^a-z0-9.-]/gi, "_")}.md`), `# QC visual: ${resumen}\n\n${filas.join("\n")}\n`);
    console.log(resumen);
  }
  console.log(`Tablas para revisar a mano en ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
