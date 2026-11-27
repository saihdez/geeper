import { describe, expect, it } from "vitest";
import { aplicarPasos } from "@/lib/encadenar";
import type { Proyecto } from "@/lib/esquema";
import { duracionEscenas } from "@/lib/linea";
import { recomendar, type EntradaRecomendar } from "@/lib/recomendaciones";
import { proyectoDePrueba } from "./fixtures";

const entrada = (p: Proyecto, extra: Partial<EntradaRecomendar> = {}): EntradaRecomendar => ({ p, versionActual: 1, tarjeta: 2.8, ...extra });
const ids = (e: EntradaRecomendar) => recomendar(e).map((r) => r.id);

/** La escena e02 con una pausa de 1,5 s entre su 2.ª y 3.ª palabra (la voz dura lo mismo). */
function conPausa(): Proyecto {
  const p = structuredClone(proyectoDePrueba());
  const e = p.escenas.e02!;
  e.palabras = [
    { texto: "Escena", inicio: 3, fin: 3.3 },
    { texto: "2", inicio: 3.35, fin: 3.6 },
    { texto: "dice", inicio: 5.1, fin: 5.4 },
    { texto: "GTA", inicio: 5.45, fin: 5.7 },
    { texto: "seis.", inicio: 5.75, fin: 5.95 },
  ];
  return p;
}

describe("asistente: recomendaciones", () => {
  it("sin render pide renderizar, decir dónde se publica y poner el gancho escrito", () => {
    const r = ids(entrada(proyectoDePrueba()));
    expect(r).toContain("renderizar");
    expect(r).toContain("plataformas");
    expect(r).toContain("gancho-texto");
    expect(r).not.toContain("silencios");
  });

  it("con cambios sin renderizar lo dice; al día, no", () => {
    const p = proyectoDePrueba();
    expect(recomendar(entrada(p, { versionActual: 3, render: { versionNumero: 2, estado: "aprobado" } })).find((x) => x.id === "renderizar")?.titulo).toMatch(/todavía no están/);
    expect(ids(entrada(p, { versionActual: 2, render: { versionNumero: 2, estado: "aprobado" } }))).not.toContain("renderizar");
  });

  it("acortar silencios trae la edición probada y lo que ahorra; aplicada, deja de recomendarse", () => {
    const p = conPausa();
    const rec = recomendar(entrada(p)).find((x) => x.id === "silencios");
    expect(rec?.ediciones).toEqual([{ tipo: "quitarSilencios", umbral: 0.6, dejar: 0.25 }]);
    const { nuevo } = aplicarPasos(p, rec!.ediciones!);
    const ahorro = duracionEscenas(p) - duracionEscenas(nuevo!);
    expect(ahorro).toBeGreaterThanOrEqual(1.25); // la pausa de 1,5 s queda en 0,25 s
    expect(rec?.efecto).toBe(`−${ahorro.toFixed(1).replace(".", ",")} s`);
    expect(ids(entrada(nuevo!))).not.toContain("silencios");
  });

  it("encuentra muletillas y tartamudeos", () => {
    const p = structuredClone(proyectoDePrueba());
    p.escenas.e01!.palabras[1] = { texto: "eh", inicio: 0.5, fin: 0.9 };
    const rec = recomendar(entrada(p)).find((x) => x.id === "muletillas");
    expect(rec?.ediciones).toEqual([{ tipo: "quitarMuletillas" }]);
  });

  it("uso comercial con licencias dudosas bloquea y va primero", () => {
    const p = structuredClone(proyectoDePrueba());
    p.comercial = true; // el fixture tiene licencia «x»: no se sabe si permite uso comercial
    const r = recomendar(entrada(p));
    expect(r[0]!.id).toBe("licencias");
    expect(r[0]!.prioridad).toBe("bloquea");
  });

  it("traduce los fallos del QC del render al día, y los ignora si el render es viejo", () => {
    const reglas = [{ id: "subtitulos", nombre: "Subtítulos legibles", ok: false }, { id: "sonoridad", nombre: "Sonoridad", ok: true }];
    const al = recomendar(entrada(proyectoDePrueba(), { render: { versionNumero: 1, estado: "rechazado", reglas } }));
    expect(al.find((x) => x.id === "qc-subtitulos")).toMatchObject({ prioridad: "bloquea", area: "subtitulos", ir: "#listo" });
    expect(al.some((x) => x.id === "qc-sonoridad")).toBe(false);
    const viejo = recomendar(entrada(proyectoDePrueba(), { versionActual: 2, render: { versionNumero: 1, estado: "rechazado", reglas } }));
    expect(viejo.some((x) => x.id.startsWith("qc-"))).toBe(false);
  });

  it("toda edición recomendada aplica sobre el proyecto", () => {
    const p = conPausa();
    p.escenas.e01!.palabras[1] = { texto: "eh", inicio: 0.5, fin: 0.9 };
    const rs = recomendar(entrada(p));
    const listas = rs.flatMap((r) => [
      ...(r.ediciones ? [[r.id, r.ediciones] as const] : []),
      ...(r.opciones ?? []).map((o) => [`${r.id}/${o.etiqueta}`, o.ediciones] as const),
      ...(r.escribir ? [[`${r.id}/escribir`, JSON.parse(JSON.stringify(r.escribir.ediciones).replaceAll("{texto}", "3 faros que nadie visita"))] as const] : []),
    ]);
    expect(listas.map(([id]) => id)).toEqual(expect.arrayContaining(["plataformas/TikTok", "gancho-texto/escribir"]));
    for (const [id, eds] of listas) expect(aplicarPasos(p, eds as unknown[]).nuevo, id).not.toBeNull();
  });

  it("con trabajos en curso pide esperar en vez de renderizar", () => {
    const r = ids(entrada(proyectoDePrueba(), { trabajosActivos: 1 }));
    expect(r).toContain("trabajos");
    expect(r).not.toContain("renderizar");
  });

  it("las palabras dudosas no se repiten si el QC del render ya las marca", () => {
    const p = structuredClone(proyectoDePrueba());
    p.escenas.e01!.palabras[0] = { ...p.escenas.e01!.palabras[0]!, confianza: 0.3 };
    expect(ids(entrada(p))).toContain("dudosas");
    const r = ids(entrada(p, { render: { versionNumero: 1, estado: "rechazado", reglas: [{ id: "alineacion", nombre: "Alineación", ok: false }] } }));
    expect(r).toContain("qc-alineacion");
    expect(r).not.toContain("dudosas");
  });

  it("un texto de un instante al inicio no cuenta como gancho", () => {
    const p = structuredClone(proyectoDePrueba());
    p.textos = [{ id: "t1", texto: "👀", inicio: 0, duracion: 0.3, estilo: "titulo", posicion: "arriba" }];
    expect(ids(entrada(p))).toContain("gancho-texto");
    p.textos[0]!.duracion = 2;
    expect(ids(entrada(p))).not.toContain("gancho-texto");
  });

  it("escribir el gancho y elegir la red, aplicados, dejan de pedirse", () => {
    const p = proyectoDePrueba();
    const rs = recomendar(entrada(p));
    const gancho = rs.find((x) => x.id === "gancho-texto")!.escribir!;
    const red = rs.find((x) => x.id === "plataformas")!.opciones![0]!;
    const eds = [...JSON.parse(JSON.stringify(gancho.ediciones).replaceAll("{texto}", "Un dato que sorprende")), ...red.ediciones] as unknown[];
    const { nuevo } = aplicarPasos(p, eds);
    expect(nuevo!.textos[0]).toMatchObject({ texto: "Un dato que sorprende", posicion: "arriba", estilo: "titulo" });
    const despues = ids(entrada(nuevo!));
    expect(despues).not.toContain("gancho-texto");
    expect(despues).not.toContain("plataformas");
  });
});
