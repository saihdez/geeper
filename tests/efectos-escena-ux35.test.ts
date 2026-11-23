/**
 * UX-35: el movimiento de cámara se elige en tarjetas que se mueven (antes, por nombre en una lista), con
 * los nombres de «Animar esta escena»; los textos en pantalla se ponen por escena, sin calcular segundos.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cuandoAparece, cuandoDe, EfectosEscena, OPCIONES_MOV, PanelAvanzado, tiempoDelTexto, type EfectosV, type ExtrasV } from "@/components/edicion-avanzada";

const efectos = (o: Partial<EfectosV> = {}): EfectosV => ({ transicion: null, movimiento: null, velocidad: 1, color: null, efectos: null, ...o });
const panel = (e: EfectosV) =>
  renderToStaticMarkup(createElement(EfectosEscena, { escena: "e02", indice: 1, efectos: e, estilo: null, formato: "9:16", imgB: "/mini.jpg", editar: async () => {}, ocupado: false }));

const ESCENAS = [
  { numero: 1, inicio: 0.5, duracion: 4 },
  { numero: 2, inicio: 4.5, duracion: 6 },
];

describe("Movimiento de cámara en tarjetas (UX-35)", () => {
  it("los mismos nombres que al animar una escena", () => {
    expect(OPCIONES_MOV.map((o) => o.nombre)).toEqual(["Quieta", "Acercarse", "Alejarse", "Hacia la derecha", "Hacia la izquierda"]);
  });

  it("se elige en tarjetas con la imagen de la escena, ya no en un desplegable", () => {
    const html = panel(efectos({ movimiento: { desde: { escala: 1, x: 0, y: 0 }, hasta: { escala: 1.15, x: 0, y: 0 } } }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Acercarse/);
    expect(html).toContain("--gm-anim:gm-acercar");
    expect(html).not.toContain("Paneo");
    expect(html).not.toContain("Ninguno (imagen quieta)");
    expect(html).toContain("cámara: acercarse");
  });

  it("«Color» ya no ofrece «Blanco y negro» (está en «Aspecto»), salvo si la escena ya lo tiene", () => {
    expect(panel(efectos())).not.toContain('<option value="blanco-negro"');
    expect(panel(efectos({ color: { brillo: 1, contraste: 1.1, saturacion: 0 } }))).toContain('<option value="blanco-negro" selected="">Blanco y negro</option>');
  });
});

describe("Textos en pantalla por escena (UX-35)", () => {
  it("dice cuándo aparece en palabras", () => {
    expect(cuandoAparece(4.5, ESCENAS)).toBe("Al empezar la escena 2");
    expect(cuandoAparece(6, ESCENAS)).toBe("En la escena 2, a los 1,5 s");
    expect(cuandoAparece(0, ESCENAS)).toBe("Al empezar el video, a los 0,0 s");
  });

  it("«Al empezar la escena 2» y «Toda la escena» se vuelven segundos al guardar", () => {
    expect(tiempoDelTexto("escena:2", "0", "escena", ESCENAS)).toEqual({ inicio: 4.5, duracion: 6 });
    expect(tiempoDelTexto("escena:1", "0", "3", ESCENAS)).toEqual({ inicio: 0.5, duracion: 3 });
    expect(tiempoDelTexto("segundo", "7.2", "5", ESCENAS)).toEqual({ inicio: 7.2, duracion: 5 });
  });

  it("si las escenas llegan después de abrir el panel, «¿Cuándo aparece?» pasa a la escena 1", () => {
    // Al montar todavía no hay escenas: en un segundo exacto.
    expect(cuandoDe(null, [])).toBe("segundo");
    // Llegan las escenas y la persona no eligió nada: al empezar la escena 1.
    expect(cuandoDe(null, ESCENAS)).toBe("escena:1");
    // Lo que eligió se respeta; si esa escena ya no está, vuelve a la 1.
    expect(cuandoDe("segundo", ESCENAS)).toBe("segundo");
    expect(cuandoDe("escena:2", ESCENAS)).toBe("escena:2");
    expect(cuandoDe("escena:5", ESCENAS)).toBe("escena:1");
  });

  it("el formulario pregunta «¿Cuándo aparece?» y «¿Cuánto dura?»", () => {
    const extras = {
      destino: { comercial: false, plataformas: [], master: false, marca: true },
      textos: [{ id: "t1", texto: "Faros olvidados", inicio: 0.5, duracion: 3, estilo: "rotulo", posicion: "arriba" }],
      estilo: { efectos: null, transicion: null, curva: null }, libres: [], musica: null, confianza: { medidas: 0, dudosas: 0, proporcion: 0 },
    } as unknown as ExtrasV;
    const html = renderToStaticMarkup(createElement(PanelAvanzado, {
      extras, formato: "9:16", total: 10.5, ocupado: false, escenas: ESCENAS,
      editar: async () => {}, alinearMusica: async () => {}, subirLibre: async () => {},
    }));
    expect(html).toContain("¿Cuándo aparece?");
    expect(html).toContain("Al empezar la escena 2");
    expect(html).toContain("¿Cuánto dura?");
    expect(html).toContain("Toda la escena");
    expect(html).toContain("(Al empezar la escena 1, 3,0 s · Rótulo, arriba)");
    // Ya no se piden los segundos a mano (salvo «En un segundo exacto…»).
    expect(html.split("Textos en pantalla")[1]!.split("Superposiciones")[0]).not.toContain("Desde (s)");
  });
});

describe("el editor le pasa las escenas al panel de textos (UX-35)", () => {
  it("PanelAvanzado recibe número, inicio y duración de cada escena", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/editor-proyecto.tsx", "utf8");
    const panel = src.slice(src.indexOf("<PanelAvanzado "), src.indexOf("/>", src.indexOf("<PanelAvanzado ")));
    expect(panel).toContain("escenas={escenas.map((e) => ({ numero: e.indice + 1, inicio: e.inicio, duracion: e.duracion }))}");
  });
});
