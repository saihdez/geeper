/** UX-41: Trabajos se agrupa por lo que pide de la persona y dice cuándo pasó cada cosa. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agruparTrabajos, MAX_TERMINADOS } from "@/components/lista-trabajos";

describe("Trabajos agrupado (UX-41)", () => {
  it("en curso, esperando, necesitan atención y terminados, sin perder ninguno y en el mismo orden", () => {
    const estados = ["hecho", "corriendo", "fallido", "pendiente", "cancelado", "interrumpido", "hecho", "pendiente"];
    const ts = estados.map((estado, i) => ({ id: String(i), estado }));
    const g = agruparTrabajos(ts);
    expect(g.map((x) => x.titulo)).toEqual(["En curso", "Esperando su turno", "Necesitan atención", "Terminados"]);
    expect(g[0]!.trabajos.map((t) => t.id)).toEqual(["1"]);
    expect(g[1]!.trabajos.map((t) => t.id)).toEqual(["3", "7"]);
    expect(g[2]!.trabajos.map((t) => t.id)).toEqual(["2", "5"]);
    expect(g[3]!.trabajos.map((t) => t.id)).toEqual(["0", "4", "6"]);
    expect(g.reduce((n, x) => n + x.trabajos.length, 0)).toBe(estados.length);
  });

  it("los terminados van plegados, con «Ver más» pasados 20, y cada fila dice cuándo", () => {
    expect(MAX_TERMINADOS).toBe(20);
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/lista-trabajos.tsx"), "utf8");
    expect(s).toMatch(/g\.id === "terminados" \? \(\s*<details/);
    expect(s).toContain("Ver más (");
    expect(s).toContain("haceCuanto(t.creado");
    expect(s).toContain("el.scrollTop = el.scrollHeight"); // el registro se abre por el final
  });
});
