import { describe, expect, it } from "vitest";
import { filtrar, type AccionPaleta } from "@/components/paleta";
import { DESTINOS, destinoActual } from "@/lib/destinos";

const irA: AccionPaleta[] = DESTINOS.map((d) => ({ id: d.ruta, titulo: d.titulo, grupo: "Ir a", palabras: d.palabras, hacer: () => {} }));

describe("secciones de la barra y del buscador", () => {
  it("el buscador encuentra Clips, Avatares y Workflows (antes respondía «No encontré nada»)", () => {
    expect(filtrar(irA, "clips")[0]?.id).toBe("/clips");
    expect(filtrar(irA, "avatares")[0]?.id).toBe("/avatares");
    expect(filtrar(irA, "workflows")[0]?.id).toBe("/workflows");
    expect(filtrar(irA, "  ").length).toBe(DESTINOS.length);
  });

  it("marca la sección actual, también dentro de sus páginas", () => {
    expect(destinoActual("/")?.ruta).toBe("/");
    expect(destinoActual("/proyectos/faros")?.ruta).toBe("/");
    expect(destinoActual("/anuncios/abc")?.ruta).toBe("/anuncios");
    expect(destinoActual("/clipsx")).toBeNull();
    expect(destinoActual("/trabajos")?.ruta).toBe("/trabajos");
  });

  it("no repite rutas", () => {
    expect(new Set(DESTINOS.map((d) => d.ruta)).size).toBe(DESTINOS.length);
  });
});
