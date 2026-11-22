import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { esDeGeeper, paginaAbriendo, permitirReinicio, plantillaMenu } from "../escritorio/reglas";

describe("carcasa de escritorio: menú en español (ESC-13)", () => {
  const nada = () => {};
  const todos = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? todos(i.submenu) : [])]);
  for (const esMac of [false, true]) {
    it(`cada opción lleva su texto en español (${esMac ? "macOS" : "Windows"})`, () => {
      const items = todos(plantillaMenu(esMac, { abrirProyectos: nada, abrirRegistros: nada, herramientasDesarrollo: nada }));
      const conTexto = items.filter((i) => i.type !== "separator");
      expect(conTexto.every((i) => typeof i.label === "string" && i.label.length > 0)).toBe(true);
      // Los roles que arman un submenú entero salen en inglés: no se usan.
      expect(items.some((i) => i.role === "editMenu" || i.role === "appMenu" || i.role === "viewMenu")).toBe(false);
      const textos = conTexto.map((i) => i.label);
      expect(textos).toEqual(expect.arrayContaining(["Editar", "Deshacer", "Pegar", "Tamaño real", "Acercar", "Alejar", "Ayuda"]));
      expect(textos.join(" ")).not.toMatch(/\b(Edit|Undo|Zoom|View|Help)\b/);
    });
  }
});

describe("carcasa de escritorio: ventana al instante (ESC-07)", () => {
  it("la página de espera es local, en español y con el fondo de la app", () => {
    const p = paginaAbriendo();
    expect(p.startsWith("data:text/html")).toBe(true);
    const html = decodeURIComponent(p.slice(p.indexOf(",") + 1));
    expect(html).toContain("Abriendo Geeper…");
    expect(html).toContain("#0b0d12");
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("sin dirección todavía, ninguna página es de Geeper; con dirección, no se confunde de puerto", () => {
    expect(esDeGeeper("", "https://evil.example")).toBe(false);
    expect(esDeGeeper("http://127.0.0.1:3300", "http://127.0.0.1:3300/proyectos")).toBe(true);
    expect(esDeGeeper("http://127.0.0.1:3300", "http://127.0.0.1:3300")).toBe(true);
    expect(esDeGeeper("http://127.0.0.1:3300", "http://127.0.0.1:33001/")).toBe(false);
  });
});

describe("carcasa de escritorio: reinicios del worker (ESC-03)", () => {
  it("deja 5 reinicios en 10 minutos y el sexto no", () => {
    const h: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(permitirReinicio(h, t0 + i * 1000)).toBe(true);
    expect(permitirReinicio(h, t0 + 6000)).toBe(false);
    expect(h).toHaveLength(5);
  });
  it("los reinicios de hace más de 10 minutos ya no cuentan", () => {
    const h: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) permitirReinicio(h, t0 + i);
    expect(permitirReinicio(h, t0 + 10 * 60_000 + 10)).toBe(true);
    expect(h).toEqual([t0 + 10 * 60_000 + 10]);
  });
});
