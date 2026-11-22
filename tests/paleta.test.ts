import { describe, expect, it } from "vitest";
import { filtrar, type AccionPaleta } from "@/components/paleta";

const a = (id: string, titulo: string, palabras = ""): AccionPaleta => ({ id, titulo, grupo: "Este proyecto", palabras, hacer: () => {} });
const acciones = [
  a("silencios", "Acortar silencios largos", "pausas quitar silencio"),
  a("formato", "Cambiar a horizontal 16:9 (YouTube)", "formato youtube"),
  a("render", "Renderizar el video", "exportar terminar"),
];

describe("buscador de acciones", () => {
  it("ignora tildes y mayúsculas, y acepta las palabras en cualquier orden", () => {
    expect(filtrar(acciones, "SILENCIOS acortar").map((x) => x.id)).toEqual(["silencios"]);
    expect(filtrar(acciones, "vídeo").map((x) => x.id)).toEqual(["render"]);
  });

  it("encuentra por sinónimos y ordena primero lo que coincide con el título", () => {
    expect(filtrar(acciones, "pausas").map((x) => x.id)).toEqual(["silencios"]);
    expect(filtrar(acciones, "16:9").map((x) => x.id)).toEqual(["formato"]);
    expect(filtrar(acciones, "exportar").map((x) => x.id)).toEqual(["render"]);
  });

  it("sin consulta muestra todo; sin coincidencias, nada", () => {
    expect(filtrar(acciones, "  ")).toHaveLength(3);
    expect(filtrar(acciones, "pizza")).toEqual([]);
  });
});

describe("registro de acciones (WEB-06)", () => {
  it("la firma no cambia si sólo cambian las funciones, y sí si cambia lo que se ve", async () => {
    const { firmaAcciones } = await import("@/components/paleta");
    const base = [a("x", "Hacer x")];
    expect(firmaAcciones(base)).toBe(firmaAcciones([{ ...base[0]!, hacer: () => undefined }]));
    expect(firmaAcciones(base)).not.toBe(firmaAcciones([{ ...base[0]!, deshabilitada: true }]));
    expect(firmaAcciones(base)).not.toBe(firmaAcciones([...base, a("y", "Hacer y")]));
  });
});
