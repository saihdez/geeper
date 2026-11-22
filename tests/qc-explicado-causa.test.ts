/** UX-01: el «qué hacer» del control de calidad dice la causa real y señala la frase que falla. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OBJETIVO, revisarSubtitulos } from "@/lib/qc";
import { explicarRegla, frasesQc, LIMITES_SUBTITULOS } from "@/lib/qc-explicado";
import { InformeQc } from "@/components/editor-proyecto";

const rapida = "«El faro de Alejandría guiaba a los barcos» (2 líneas, 25 car./línea, 19.2 car./s, 3.40 s)";
const larga = "«Una frase larguísima que no cabe en dos líneas cortas para nada» (3 líneas, 30 car./línea, 9.0 car./s, 8.00 s)";

describe("QC explicado por su causa (UX-01)", () => {
  it("los límites son los del QC", () => {
    expect(LIMITES_SUBTITULOS).toEqual({ maxCps: OBJETIVO.maxCps, maxCaracteresLinea: OBJETIVO.maxCaracteresLinea, maxLineas: OBJETIVO.maxLineas });
  });

  it("lee las frases del detalle tal como las escribe la regla del QC", () => {
    const sub = revisarSubtitulos("9:16", [{ texto: "hola mundo que tal estás hoy", inicio: 0, fin: 1, escena: "e01" } as never], 1);
    const f = frasesQc(sub.malos.join("\n"));
    expect(f).toHaveLength(1);
    expect(f[0]!.texto).toBe("hola mundo que tal estás hoy");
    expect(f[0]!.rapida).toBe(true);
  });

  it("si la causa es el ritmo, no habla de «líneas cortas»", () => {
    const e = explicarRegla({ id: "subtitulos", medido: { peorCps: 19.2, peorLineas: 2, peorCaracteresLinea: 25 }, detalle: rapida });
    expect(e.que).toBe("Que dé tiempo a leer cada subtítulo.");
    expect(e.hacer).toMatch(/pasan muy rápido/);
    expect(e.hacer).not.toMatch(/líneas cortas/);
    expect(e.frases.map((x) => x.texto)).toEqual(["El faro de Alejandría guiaba a los barcos"]);
  });

  it("si la causa es el largo, lo dice; si son las dos, también", () => {
    expect(explicarRegla({ id: "subtitulos", detalle: larga }).hacer).toMatch(/no caben en dos líneas/);
    expect(explicarRegla({ id: "subtitulos", detalle: `${rapida}\n${larga}` }).hacer).toMatch(/largas o pasan muy rápido/);
  });

  it("sin detalle usa lo medido", () => {
    expect(explicarRegla({ id: "subtitulos", medido: { peorCps: 18, peorLineas: 1, peorCaracteresLinea: 20 } }).que).toBe("Que dé tiempo a leer cada subtítulo.");
  });

  it("el informe enlaza cada frase a su escena, o dice que ya cambió", () => {
    const render = {
      id: "r", versionNumero: 3, perfil: "shorts-9x16", ruta: "renders/v3.mp4", estado: "rechazado", duracion: 30, segundos: 60, creado: "",
      informeQc: { aprobado: false, fotogramas: [], reglas: [{ id: "subtitulos", nombre: "Subtítulos legibles", ok: false, medido: { peorCps: 19.2 }, objetivo: "", detalle: `${rapida}\n«Ya no existe» (1 líneas, 10 car./línea, 20.0 car./s, 9.00 s)` }] },
    };
    const html = renderToStaticMarkup(createElement(InformeQc, {
      r: render, slug: "p", escenas: [{ id: "e03", indice: 2, grupos: [{ texto: "El faro de Alejandría guiaba a los barcos" }] }],
    }));
    expect(html).toContain('href="#escena-e03"');
    expect(html).toContain("Ir a la escena 3");
    expect(html).toContain("19,2 letras por segundo");
    expect(html).toContain("ya cambió desde que se hizo este video");
  });
});
