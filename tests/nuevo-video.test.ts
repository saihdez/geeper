/** Página «Nuevo video»: lo que ve y usa la persona (UX-42, A11-09, UX-31, A11-08, UX-39, A11-06). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => params,
}));

const { Nuevo } = await import("@/components/nuevo");
const pintar = () => renderToStaticMarkup(createElement(Nuevo));

beforeEach(() => {
  params = new URLSearchParams();
});

describe("Nuevo video", () => {
  it("los dos formularios quedan montados y sólo se oculta el que no se usa (UX-42)", () => {
    // Envolturas en orden: la de «Desde un tema» y la de «Desde una página web».
    const envolturas = (html: string) => [...html.matchAll(/<div( hidden="")?><form/g)].map((m) => (m[1] ? "oculto" : "visible"));
    const tema = pintar();
    expect(tema).toContain('id="temas"');
    expect(tema).toContain('id="demo-url"');
    expect(envolturas(tema)).toEqual(["visible", "oculto"]);
    params = new URLSearchParams("modo=web");
    expect(envolturas(pintar())).toEqual(["oculto", "visible"]);
  });
});

describe("semántica de Nuevo (A11-09)", () => {
  it("el enlace a Clips no está dentro del grupo de opciones", () => {
    const html = pintar();
    const grupo = html.match(/<div[^>]*role="radiogroup"[^>]*>([\s\S]*?)<\/div><a /)?.[1] ?? "";
    expect(grupo).toContain('role="radio"');
    expect(grupo).not.toContain("<a ");
    expect(html).toMatch(/<\/div><a [^>]*href="\/clips"/);
  });

  it("sólo la opción elegida entra con Tab (las otras, con las flechas)", () => {
    const grupo = pintar().match(/<div[^>]*role="radiogroup"[^>]*>([\s\S]*?)<\/div><a /)?.[1] ?? "";
    const radios = [...grupo.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0]).toMatch(/aria-checked="true"[^>]*tabindex="0"/);
    expect(radios[1]).toMatch(/aria-checked="false"[^>]*tabindex="-1"/);
  });
});

describe("lo elegido no se pinta como el botón principal (A11-08)", () => {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const fuente = (f: string) => readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");

  it("globals.css marca lo elegido desde aria-pressed, aria-checked o el radio marcado, con ✓", () => {
    for (const clase of [".opcion:is(", ".opcion-tarjeta:is("]) {
      const regla = css.slice(css.indexOf(clase)).split("{")[0]!;
      expect(regla).toContain('[aria-pressed="true"]');
      expect(regla).toContain('[aria-checked="true"]');
      expect(regla).toContain(":has(> input:checked)");
    }
    expect(css).toMatch(/content: "✓"/);
  });

  it("las reglas de .opcion van en @layer components, así las utilidades (flex, p-3) les ganan", () => {
    const ini = css.indexOf("@layer components {");
    expect(ini).toBeGreaterThan(-1);
    let nivel = 0;
    let fin = ini;
    for (let i = css.indexOf("{", ini); i < css.length; i++) {
      if (css[i] === "{") nivel++;
      else if (css[i] === "}" && --nivel === 0) {
        fin = i;
        break;
      }
    }
    const dentro = css.slice(ini, fin);
    const fuera = (css.slice(0, ini) + css.slice(fin)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(dentro).toContain(".opcion-tarjeta { position: relative; display: block;");
    expect(dentro).toContain(".opcion { display: inline-flex;");
    expect(fuera).not.toMatch(/\.opcion(-tarjeta)?[\s:{,]/);
  });

  it("en Nuevo, boton-primario sólo se usa en el botón de enviar", () => {
    for (const f of ["form-nuevo.tsx", "form-demo.tsx", "nuevo.tsx"]) {
      const usos = fuente(f).split("\n").filter((l) => l.includes("boton-primario"));
      expect(usos.every((l) => /<button className="boton boton-primario"/.test(l)), f).toBe(true);
      expect(fuente(f), f).not.toMatch(/\? "boton-primario"|ring-2 ring-(cyan|acento)/);
    }
  });

  it("en Animar, Presentador y Conceptos lo elegido tampoco usa el relleno del botón principal", () => {
    for (const f of ["panel-animar.tsx", "panel-presentador.tsx", "anuncios/conceptos.tsx"]) {
      expect(fuente(f), f).not.toMatch(/\? "boton-primario"|outline outline-2 outline-cyan-500/);
      expect(fuente(f), f).toMatch(/className="opcion(-tarjeta)?[ "]/);
    }
  });

  it("las formas del video y los estilos son opciones con su estado", () => {
    const html = pintar();
    expect(html).toMatch(/<label class="opcion"><input type="radio"[^>]*name="formato"[^>]*checked=""[^>]*value="9:16"/);
    expect(html).toMatch(/class="opcion-tarjeta p-3"/);
  });
});

describe("el botón apagado dice qué falta (UX-31)", () => {
  it("Desde un tema: el tema y la casilla", async () => {
    const { faltaNuevo } = await import("@/components/form-nuevo");
    expect(faltaNuevo({ temas: 0, necesitaGpu: true, aceptoGpu: false })).toEqual(["escribir el tema", "marcar la casilla de arriba"]);
    expect(faltaNuevo({ temas: 1, necesitaGpu: true, aceptoGpu: true })).toEqual([]);
    expect(faltaNuevo({ temas: 1, necesitaGpu: false, aceptoGpu: false })).toEqual([]);
  });

  it("Desde una página web: el link, un link completo, la voz y el estilo", async () => {
    const { faltaDemo } = await import("@/components/form-demo");
    expect(faltaDemo({ url: "", linkOk: false, largo: 0, plantilla: "a" })).toEqual(["el link de la página", "lo que dice la voz"]);
    expect(faltaDemo({ url: "hola", linkOk: false, largo: 10, plantilla: "" })).toEqual(["un link completo", "el estilo del canal"]);
    expect(faltaDemo({ url: "https://x.com", linkOk: true, largo: 10, plantilla: "a" })).toEqual([]);
    // Mientras cargan los estilos no aparece «falta: el estilo del canal».
    expect(faltaDemo({ url: "https://x.com", linkOk: true, largo: 10, plantilla: "", cargando: true })).toEqual([]);
  });

  it("la línea va debajo del botón y el botón la nombra", () => {
    const html = pintar();
    expect(html).toMatch(/aria-describedby="nuevo-falta"[^>]*>Crear y generar<\/button><p id="nuevo-falta"[^>]*>Para continuar falta: escribir el tema · marcar la casilla de arriba\.<\/p>/);
    expect(html).toMatch(/aria-describedby="demo-falta"[^>]*>Crear video de la página<\/button><p id="demo-falta"[^>]*>Para continuar falta: el link de la página · lo que dice la voz/);
  });

  it("el aviso del link sale justo debajo de su campo, con borde rojo", () => {
    params = new URLSearchParams("modo=web&url=hola");
    const html = pintar();
    expect(html).toMatch(/<input[^>]*id="demo-url"[^>]*aria-invalid="true"[^>]*aria-describedby="demo-url-error"[^>]*style="border-color:#f87171"[^>]*\/><p id="demo-url-error"[^>]*>Ese link no parece completo/);
  });
});

describe("usar un video de MoneyPrinterTurbo (UX-39)", () => {
  it("va dentro de «Más opciones», sin task_id ni MPT, y dice dónde está el código", () => {
    const html = pintar();
    const mas = html.match(/<details[^>]*><summary[^>]*>Más opciones<\/summary>([\s\S]*?)<\/details>/)?.[1] ?? "";
    expect(mas).toContain("Usar un video que ya hice con MoneyPrinterTurbo");
    expect(mas).toContain("Código del video (como el de ejemplo, con guiones)");
    expect(mas).not.toContain("36 letras");
    expect(mas).toContain("storage/tasks");
    expect(html).not.toMatch(/task_id|\bMPT\b|Kokoro|\bQC\b/);
  });

  it("un código incompleto se avisa antes de enviar, con la misma regla que el servidor", async () => {
    const { CODIGO_MPT } = await import("@/components/form-nuevo");
    expect(CODIGO_MPT.test("c721927b-353e-4dce-9bbb-8ce7d33ed5f2")).toBe(true);
    expect(CODIGO_MPT.test("hola")).toBe(false);
    const servidor = readFileSync(path.join(process.cwd(), "src", "lib", "servicios.ts"), "utf8");
    expect(servidor).toContain(`if (!${CODIGO_MPT.toString()}.test(taskId))`);
  });
});
