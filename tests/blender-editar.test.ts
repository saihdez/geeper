import path from "node:path";
import { describe, expect, it } from "vitest";
import { rutaBlendSegura } from "@/lib/blender-editar";
import { Pedido3d, pedidoParaBlender } from "@/lib/escenas3d";

describe("Abrir en Blender", () => {
  it("sólo acepta .blend dentro de la carpeta de datos", () => {
    expect(rutaBlendSegura("escenas-3d/a/escena.blend", "/datos")).toBe(path.resolve("/datos/escenas-3d/a/escena.blend"));
    expect(rutaBlendSegura("../fuera/escena.blend", "/datos")).toBeNull();
    expect(rutaBlendSegura("/etc/escena.blend", "/datos")).toBeNull();
    expect(rutaBlendSegura("escenas-3d/a/video.mp4", "/datos")).toBeNull();
    expect(rutaBlendSegura(42, "/datos")).toBeNull();
  });
  it("cada escena 3D guarda su .blend editable junto a ella", () => {
    const p = Pedido3d.parse({ plantilla: "texto", texto: "Hola", colores: { fondo: "#000000", fondo2: null, principal: "#ffffff", acento: "#ff0000" } });
    expect(pedidoParaBlender(p, { dir: "/d/escenas-3d/x", cuadros: "/c", hdri: null, dispositivo: "cpu" }).guardar_blend).toBe(path.join("/d/escenas-3d/x", "escena.blend"));
  });
});
