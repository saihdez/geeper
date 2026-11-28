/** UX-09: un solo aviso antes de lo que usa toda la tarjeta de video, con la casilla «Ya guardé…». */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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

const RAIZ = path.resolve(__dirname, "..");
const fuente = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
function archivos(dir: string): string[] {
  return readdirSync(path.join(RAIZ, dir)).flatMap((n) => {
    const r = `${dir}/${n}`;
    return statSync(path.join(RAIZ, r)).isDirectory() ? archivos(r) : /\.tsx?$/.test(n) ? [r] : [];
  });
}

/** Las pantallas con una acción que encola un trabajo de toda la tarjeta (cola.ts: motor «mpt» o «tarjeta»). */
const SITIOS = [
  "src/components/form-nuevo.tsx",
  "src/components/anuncios/conceptos.tsx",
  "src/components/panel-animar.tsx",
  "src/components/avatares.tsx",
  "src/components/panel-avatar.tsx",
  "src/components/panel-presentador.tsx",
  "src/components/panel-rehacer.tsx",
  "src/components/panel-efectos-sonido.tsx",
  "src/components/workflows.tsx",
  "src/components/panel-traducir.tsx",
  "src/components/disenar-voz.tsx",
  "src/components/escenas-3d.tsx",
  "src/components/panel-camara3d.tsx",
  "src/components/invitacion-imagenes.tsx",
  "src/components/editar-en-blender.tsx",
];

/**
 * Cada trabajo de la fila «mpt» o «tarjeta» (cola.ts) y la pantalla cuyo botón lo encola. Si aparece un
 * tipo nuevo, esta prueba falla hasta que su botón pida guardar antes.
 */
const QUIEN_LO_LANZA: Record<string, string[]> = {
  "mpt.generar": ["src/components/form-nuevo.tsx", "src/components/anuncios/conceptos.tsx"],
  "escenas.animar": ["src/components/form-nuevo.tsx"],
  "avatar.escenas": ["src/components/form-nuevo.tsx", "src/components/panel-avatar.tsx"],
  "plano.generar": ["src/components/panel-animar.tsx"],
  "avatar.proponer": ["src/components/avatares.tsx"],
  "avatar.retocar": ["src/components/avatares.tsx"],
  "avatar.actuar": ["src/components/panel-avatar.tsx"],
  "avatar.streamer": ["src/components/panel-avatar.tsx"],
  "presentador.generar": ["src/components/panel-presentador.tsx"],
  "escena.rehacer": ["src/components/panel-rehacer.tsx"],
  "efecto.generar": ["src/components/panel-efectos-sonido.tsx"],
  "workflow.correr": ["src/components/workflows.tsx"],
  "proyecto.traducir": ["src/components/panel-traducir.tsx"],
  "voz.disenar": ["src/components/disenar-voz.tsx"],
  "escena3d.crear": ["src/components/escenas-3d.tsx", "src/components/editar-en-blender.tsx"],
  "camara3d.generar": ["src/components/panel-camara3d.tsx"],
  "blender.rehacer": ["src/components/editar-en-blender.tsx"],
  "invitacion.foto": ["src/components/invitacion-imagenes.tsx"],
  "invitacion.fondo": ["src/components/invitacion-imagenes.tsx"],
  "invitacion.efecto": ["src/components/invitacion-imagenes.tsx"],
  "invitacion.qr": ["src/components/invitacion-imagenes.tsx"],
  // Sólo desde la terminal (worker/preparar-efectos.ts): no hay botón en la app.
  "efectos.preparar": [],
};

describe("todos los trabajos de toda la tarjeta tienen su aviso", () => {
  it("cada tipo de la fila «mpt» o «tarjeta» está en la tabla, y su pantalla en SITIOS", async () => {
    const { TIPOS } = await import("@/lib/cola");
    const deTarjeta = Object.entries(TIPOS).filter(([, t]) => t.motor === "mpt" || t.motor === "tarjeta").map(([k]) => k).sort();
    expect(deTarjeta).toEqual(Object.keys(QUIEN_LO_LANZA).sort());
    for (const sitios of Object.values(QUIEN_LO_LANZA)) for (const f of sitios) expect(SITIOS).toContain(f);
  });
});

describe("cada acción de tarjeta usa el mismo aviso", () => {
  it.each(SITIOS)("%s", (f) => {
    const s = fuente(f);
    expect(s).toMatch(/useGuardeAntes\(\)/);
    expect(s).toMatch(/<AvisoTarjeta g=\{/);
    expect(s).toMatch(/aria-describedby=\{/);
    expect(s).toMatch(/guarde\.idFalta/);
    expect(s).toMatch(/<LineaFalta id=\{/);
  });

  it("Animar ya no pregunta con confirm()", () => {
    expect(fuente("src/components/panel-animar.tsx")).not.toMatch(/\bconfirm\(/);
  });

  it("no quedan las casillas ni avisos viejos con otras palabras", () => {
    for (const f of archivos("src")) {
      const s = fuente(f);
      expect(s, f).not.toMatch(/Guardé mi trabajo|guarda tu trabajo antes|Guarda lo que tengas abierto en Windows|reiniciado sin aviso|marcar la casilla de arriba/i);
      // El texto del aviso vive sólo en comun.tsx.
      if (f !== "src/components/comun.tsx") expect(s, f).not.toContain("se reinicia sola");
    }
  });
});
