/** UX-13: el asistente de avatares se retoma desde la URL y los retoques fallidos se ven en la biblioteca. */
import { describe, expect, it, vi } from "vitest";
import { cancelarAlSalir, enlaceAvatares, escribirEstadoAsistente, leerEstadoAsistente, pedidoAvatar, puedeCrearAvatar, retoquesVisibles, volverSeguro } from "@/lib/asistente-avatar";

describe("estado del asistente en la URL (UX-13)", () => {
  it("lee propuesta, trabajo y toma; rechaza lo que no tiene la forma esperada", () => {
    expect(leerEstadoAsistente("?propuesta=ab12cd&trabajo=cm3x9_q-1&toma=2")).toEqual({ propuesta: "ab12cd", trabajo: "cm3x9_q-1", toma: 2 });
    expect(leerEstadoAsistente("?propuesta=ab12cd&trabajo=t1&toma=99")).toEqual({ propuesta: "ab12cd", trabajo: "t1" });
    expect(leerEstadoAsistente("?propuesta=ab12cd")).toBeNull();
    expect(leerEstadoAsistente("?propuesta=../x&trabajo=t1")).toBeNull();
    expect(leerEstadoAsistente("")).toBeNull();
  });

  it("escribe y borra sin tocar lo demás de la URL", () => {
    const q = escribirEstadoAsistente("?volver=%2Fproyectos%2Fp1", { propuesta: "ab", trabajo: "t1", toma: 3 });
    expect(leerEstadoAsistente(q)).toEqual({ propuesta: "ab", trabajo: "t1", toma: 3 });
    expect(new URLSearchParams(q).get("volver")).toBe("/proyectos/p1");
    expect(escribirEstadoAsistente(q, null)).toBe("?volver=%2Fproyectos%2Fp1");
    expect(escribirEstadoAsistente("?propuesta=ab&trabajo=t1", null)).toBe("");
  });
});

describe("«Cancelar» del asistente (UX-13)", () => {
  it("para el dibujo también antes de que llegue el primer avance", () => {
    expect(cancelarAlSalir({ trabajo: "t1" }, undefined)).toBe(true);
    expect(cancelarAlSalir({ trabajo: "t1" }, null)).toBe(true);
    expect(cancelarAlSalir({ trabajo: "t1" }, "pendiente")).toBe(true);
    expect(cancelarAlSalir({ trabajo: "t1" }, "corriendo")).toBe(true);
  });
  it("no toca un trabajo que ya terminó ni cuando no se pidió nada", () => {
    expect(cancelarAlSalir({ trabajo: "t1" }, "hecho")).toBe(false);
    expect(cancelarAlSalir({ trabajo: "t1" }, "fallido")).toBe(false);
    expect(cancelarAlSalir(null, undefined)).toBe(false);
  });
});

describe("un texto por modo (UX-23)", () => {
  const textos = { palabras: "Mujer de unos 30 años, pelo castaño recogido", foto: "" };
  it("la descripción escrita no se cuela en «Desde una foto»", () => {
    expect(pedidoAvatar({ conFoto: true, textos, estilo: "realista", fondo: "liso" })).toEqual({ descripcion: "", estilo: "realista", fondo: "liso" });
    expect(pedidoAvatar({ conFoto: true, textos: { ...textos, foto: " con camisa azul " }, estilo: "anime", fondo: "casa", luz: "ventana" })).toEqual({ descripcion: "con camisa azul", estilo: "anime", fondo: "casa", luz: "ventana" });
    expect(pedidoAvatar({ conFoto: false, textos, estilo: "realista", fondo: "liso", look: "" }).descripcion).toBe(textos.palabras);
  });

  it("con foto basta la foto y el permiso; con palabras, una descripción de verdad", () => {
    expect(puedeCrearAvatar(true, textos, true, true)).toBe(true);
    expect(puedeCrearAvatar(true, textos, true, false)).toBe(false);
    expect(puedeCrearAvatar(false, { palabras: "corto", foto: "con lentes y traje azul" }, false, false)).toBe(false);
  });
});

describe("volver al video (UX-32)", () => {
  it("el enlace desde Presentador vuelve al mismo proyecto", () => {
    const q = new URL(enlaceAvatares("cm9abc_1"), "http://x").searchParams.get("volver");
    expect(volverSeguro(q)).toBe("/proyectos/cm9abc_1");
  });
  it("sólo vuelve a un proyecto de Geeper", () => {
    for (const malo of ["https://otro.sitio/proyectos/x", "//otro.sitio", "/sistema", "/proyectos/../sistema", "/proyectos/", "javascript:alert(1)", null, undefined, ""]) {
      expect(volverSeguro(malo)).toBeNull();
    }
  });
});

describe("retoques en la biblioteca (UX-13)", () => {
  const actualizado = { ana: "2026-11-22T10:00:00.000Z", beto: "2026-11-22T10:00:00.000Z" };
  it("el más nuevo de cada avatar: en marcha, o fallido después de su último cambio", () => {
    const ts = [
      { id: "1", estado: "fallido", creado: new Date("2026-11-22T11:00:00Z"), payload: { avatar: "ana" } },
      { id: "2", estado: "corriendo", creado: new Date("2026-11-22T10:30:00Z"), payload: { avatar: "ana" } },
      { id: "3", estado: "fallido", creado: new Date("2026-11-22T09:00:00Z"), payload: { avatar: "beto" } },
      { id: "4", estado: "pendiente", creado: new Date("2026-11-22T12:00:00Z"), payload: { avatar: "borrado" } },
    ];
    expect(retoquesVisibles(ts, actualizado).map((t) => t.id)).toEqual(["1"]);
  });
});

vi.mock("@/lib/instalar-wan2gp", () => ({ revisarWan2gp: () => ({ falta: null, corriendo: false }) }));
vi.mock("@/lib/avatares", async (original) => ({
  ...(await original<typeof import("@/lib/avatares")>()),
  listarAvatares: async () => [{ id: "ana", nombre: "Ana", descripcion: "", estilo: "realista", origen: "descripcion", versiones: [], creado: "2026-11-22T09:00:00.000Z", actualizado: "2026-11-22T10:00:00.000Z", licencia: "x" }],
}));
vi.mock("@/lib/db", () => ({
  db: {
    trabajo: {
      findMany: async (q: { where: { tipo: string } }) =>
        q.where.tipo === "avatar.retocar"
          ? [{ id: "r1", tipo: "avatar.retocar", estado: "fallido", etapa: "", progreso: 0, error: "La tarjeta de video se quedó sin memoria.\ndetalles", creado: new Date("2026-11-22T11:00:00Z"), payload: { avatar: "ana" } }]
          : [],
    },
  },
}));

describe("GET /api/avatares (UX-13)", () => {
  it("devuelve el retoque fallido con su error en una línea", async () => {
    const { GET } = await import("@/app/api/avatares/route");
    const r = await GET();
    expect(r.status).toBe(200);
    const { trabajos } = (await r.json()) as { trabajos: { id: string; estado: string; error: string | null; avatar: string }[] };
    expect(trabajos).toEqual([expect.objectContaining({ id: "r1", estado: "fallido", avatar: "ana", error: "La tarjeta de video se quedó sin memoria." })]);
  });
});
