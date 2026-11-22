/**
 * Uso: pnpm tsx scripts/importar-clip.ts <fuente-id> <inicio> <fin> [--encuadre react|cara|contener|cubrir]
 *        [--idioma es] [--formato 9:16] [--plantilla gta-vi-shorts] [--titulo "…"] [--gancho "…"]
 *        [--permiso "campaña X en Whop, 2026-11-19"] [--glosario "GTA VI, Lucia, Vice City"]
 *        [--campania campania.json] [--sin-render]
 *
 * Crea un proyecto de Geeper con un tramo de una fuente (la de `scripts/momentos.ts`) y lo encola:
 * importar → render → QC. El worker (`pnpm run dev:up`) hace el trabajo.
 * `campania.json`: { "nombre", "minSegundos", "maxSegundos", "hashtags": ["#a"], "mencion": "@x" }.
 */
import fs from "node:fs/promises";
import { Campania } from "../src/lib/clips";
import { db } from "../src/lib/db";
import { Formato } from "../src/lib/esquema";
import { leerFuente } from "../src/lib/fuentes";
import { ENCUADRES } from "../src/lib/importador-clip";
import { crearClip } from "../src/lib/servicios";

function opcion(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const [fuenteId, ini, fin] = args;
  if (!fuenteId || ini === undefined || fin === undefined) {
    console.error('Uso: pnpm tsx scripts/importar-clip.ts <fuente-id> <inicio> <fin> [--encuadre react|cara|contener|cubrir] [--titulo "…"] [--gancho "…"] [--permiso "…"] [--glosario "A, B"] [--campania c.json] [--sin-render]');
    process.exit(2);
  }
  const encuadre = opcion(args, "--encuadre") ?? "react";
  if (!(ENCUADRES as readonly string[]).includes(encuadre)) throw new Error(`--encuadre debe ser ${ENCUADRES.join(" | ")}`);
  const f = await leerFuente(fuenteId);
  const rutaCampania = opcion(args, "--campania");
  const campania = rutaCampania ? Campania.parse(JSON.parse(await fs.readFile(rutaCampania, "utf8"))) : undefined;
  const p = await crearClip(
    {
      fuenteId,
      inicio: Number(ini),
      fin: Number(fin),
      encuadre: encuadre as (typeof ENCUADRES)[number],
      idioma: opcion(args, "--idioma") ?? "es",
      formato: Formato.parse(opcion(args, "--formato") ?? "9:16"),
      plantilla: opcion(args, "--plantilla") ?? "gta-vi-shorts",
      titulo: opcion(args, "--titulo"),
      gancho: opcion(args, "--gancho"),
      permiso: opcion(args, "--permiso"),
      glosario: opcion(args, "--glosario"),
      campania,
      renderizar: !args.includes("--sin-render"),
    },
    f.info.titulo,
  );
  console.log(`Proyecto ${p.slug} (${p.id}) en cola: http://localhost:3300/proyectos/${p.id}`);
  if (!opcion(args, "--permiso")) console.log("Aviso: sin --permiso la licencia queda «revisar»; no lo marques de uso comercial sin el permiso del creador.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
