/** WEB-13: las pantallas que sólo muestran datos de la base esperan los avisos en vez de preguntar cada 2–5 s. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");

const ESPERADO: [archivo: string, llamada: string][] = [
  ["lista-trabajos.tsx", '[proyectoId ? `trabajos:${proyectoId}` : "trabajos", "motor"]'],
  ["lista-proyectos.tsx", 'useSondeo<{ proyectos: Fila[] }>("/api/proyectos", 3000, ["proyecto", "trabajos"])'],
  ["editor-proyecto.tsx", "useSondeo<Vista>(`/api/proyectos/${id}`, 3000, [`proyecto:${id}`, `trabajos:${id}`])"],
  ["clips.tsx", 'useSondeo<Datos>("/api/clips", 3000, ["trabajos", "motor"])'],
  ["avatares.tsx", 'useSondeo<Datos>("/api/avatares", 5000, ["trabajos"])'],
  ["trabajos-flotantes.tsx", 'useSondeo<Datos>("/api/trabajos/activos", (d) => (d?.trabajos.length ? 2000 : 10_000), ["trabajos"])'],
  ["anuncios/conceptos.tsx", 'useSondeo<{ proyectos: ProyectoLista[] }>("/api/proyectos", 15000, ["proyecto", "trabajos"])'],
];

describe("pantallas con canal de avisos (WEB-13)", () => {
  it.each(ESPERADO)("%s dice a qué avisos responde", (archivo, llamada) => {
    expect(leer(archivo)).toContain(llamada);
  });

  it("las dos consultas de «Tu avatar» en el editor responden a los avisos de su proyecto", () => {
    expect(leer("panel-avatar.tsx").split("[`trabajos:${proyectoId}`, `proyecto:${proyectoId}`]")).toHaveLength(3);
  });

  it("lo que no sale de la base (instalaciones, ComfyUI, apps) sigue preguntando a su ritmo", () => {
    for (const f of ["workflows.tsx", "instalar-wan2gp.tsx", "instalar-herramienta.tsx", "media.tsx", "disenar-voz.tsx"]) {
      expect(leer(f), f).not.toMatch(/useSondeo<[^;]*,\s*\[\s*["`](trabajos|proyecto|motor)/);
    }
  });
});
