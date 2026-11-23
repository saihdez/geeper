/** UX-41: Trabajos se agrupa por lo que pide de la persona y dice cuándo pasó cada cosa. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agruparTrabajos, cercaDelFinal, MAX_TERMINADOS } from "@/components/lista-trabajos";

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
    expect(s).toContain("if (el && pegado.current)"); // y no baja a quien subió a leer
  });

  it("el registro sigue el final sólo si la persona no subió a leer", () => {
    expect(cercaDelFinal({ scrollHeight: 1000, scrollTop: 600, clientHeight: 384 })).toBe(true); // a 16 px del final
    expect(cercaDelFinal({ scrollHeight: 1000, scrollTop: 200, clientHeight: 384 })).toBe(false); // subió a leer
    expect(cercaDelFinal({ scrollHeight: 300, scrollTop: 0, clientHeight: 300 })).toBe(true); // cabe entero
  });
});

describe("«Cambiar el link» en Trabajos (UX-17)", () => {
  it("va junto a «Volver a intentar» sólo cuando lo ofrece ofreceCambiarLink", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/lista-trabajos.tsx"), "utf8");
    expect(s).toContain('import { CambiarLink, ofreceCambiarLink } from "./cambiar-link";');
    const i = s.indexOf(">Volver a intentar</button>");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 400)).toContain("{ofreceCambiarLink(t) && <CambiarLink trabajoId={t.id} />}");
  });
});

describe("el intento anterior se ve en Trabajos (UX-41)", () => {
  it("cada fila dice qué pasó con el intento anterior, con lo que da /api/trabajos", async () => {
    const { textoIntentos } = await import("@/lib/intentos");
    expect(textoIntentos([{ estado: "fallido", error: "x", iniciado: "2026-11-23T10:00:00Z", terminado: "2026-11-23T10:06:36Z" }])).toBe("2.º intento (el 1.º falló a los 6 min 36 s)");
    const s = fs.readFileSync(path.join(process.cwd(), "src/components/lista-trabajos.tsx"), "utf8");
    expect(s).toContain("textoIntentos(t.anteriores)");
    const api = fs.readFileSync(path.join(process.cwd(), "src/app/api/trabajos/route.ts"), "utf8");
    expect(api).toContain("anteriores: true");
  });
});
