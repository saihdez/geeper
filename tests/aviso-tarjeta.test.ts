/** UX-09: un solo aviso antes de lo que usa toda la tarjeta de video, con la casilla «Ya guardé…». */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  AVISO_TARJETA, AvisoTarjeta, FALTA_GUARDAR, LineaFalta, YA_GUARDE, escribirGuarde, faltanConGuardar, leerGuarde, useGuardeAntes,
} from "@/components/comun";

const TEXTO = "Esto usa toda la tarjeta de video unos minutos. A veces la computadora se reinicia sola: guarda antes lo que tengas abierto.";

/** Una acción de tarjeta mínima, cableada como en las pantallas. */
function Accion() {
  const g = useGuardeAntes();
  const faltan = faltanConGuardar(g);
  return createElement("div", null,
    createElement(AvisoTarjeta, { g }),
    createElement("button", { disabled: faltan.length > 0, "aria-describedby": faltan.length ? g.idFalta : undefined }, "Hacerlo"),
    createElement(LineaFalta, { id: g.idFalta, faltan }));
}

describe("AvisoTarjeta (UX-09)", () => {
  it("las palabras son las pedidas", () => {
    expect(AVISO_TARJETA).toBe(TEXTO);
    expect(YA_GUARDE).toBe("Ya guardé lo que tenía abierto");
    expect(FALTA_GUARDAR).toBe("marcar «Ya guardé lo que tenía abierto»");
  });

  it("sin marcar la casilla el botón queda apagado y dice qué falta", () => {
    const html = renderToStaticMarkup(createElement(Accion));
    expect(html).toContain(TEXTO);
    expect(html).toMatch(/<label[^>]*><input type="checkbox"[^>]*aria-describedby="([^"]+)-aviso-tarjeta"[^>]*\/>Ya guardé lo que tenía abierto<\/label>/);
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<button disabled=""[^>]*aria-describedby="([^"]+-falta)">Hacerlo<\/button><p id="\1"[^>]*>Para continuar falta: marcar «Ya guardé lo que tenía abierto»\.<\/p>/);
    // El texto del aviso tiene el id que nombra la casilla.
    const id = /aria-describedby="([^"]+-aviso-tarjeta)"/.exec(html)![1];
    expect(html).toContain(`<p id="${id}" class="font-medium">${TEXTO}</p>`);
  });

  it("lo que falta suma la casilla sólo si está sin marcar", () => {
    const g = { guardado: false, marcar: () => {}, idAviso: "a", idFalta: "f" };
    expect(faltanConGuardar(g, ["el tema"])).toEqual(["el tema", FALTA_GUARDAR]);
    expect(faltanConGuardar({ ...g, guardado: true }, ["el tema"])).toEqual(["el tema"]);
    expect(renderToStaticMarkup(createElement(LineaFalta, { id: "f", faltan: [] }))).toBe("");
  });
});

describe("la casilla se recuerda durante la sesión de la pestaña", () => {
  const w = globalThis as unknown as { window?: unknown };
  afterEach(() => {
    escribirGuarde(false);
    delete w.window;
  });

  it("marcada, queda en sessionStorage; desmarcada, se borra", () => {
    const guardado = new Map<string, string>();
    w.window = { sessionStorage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v), removeItem: (k: string) => void guardado.delete(k) } };
    expect(leerGuarde()).toBe(false);
    escribirGuarde(true);
    expect([...guardado.values()]).toEqual(["1"]);
    expect(leerGuarde()).toBe(true);
    escribirGuarde(false);
    expect(guardado.size).toBe(0);
    expect(leerGuarde()).toBe(false);
  });

  it("si el navegador no deja usar sessionStorage, no falla y se recuerda en memoria", () => {
    const roto = () => { throw new Error("bloqueado"); };
    w.window = { sessionStorage: { getItem: roto, setItem: roto, removeItem: roto } };
    expect(leerGuarde()).toBe(false);
    expect(() => escribirGuarde(true)).not.toThrow();
    expect(leerGuarde()).toBe(true);
  });
});
