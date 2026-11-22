import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import {
  AvisoArranque,
  comoTermino,
  esDeGeeper,
  paginaAbriendo,
  permitirReinicio,
  plantillaMenu,
  registrar,
  Relanzamiento,
  rotarRegistro,
  textoErrorArranque,
} from "../escritorio/reglas";

describe("carcasa de escritorio: registros (ESC-14)", () => {
  it("guarda salida y errores completos y anota con qué código terminó, sin escribir tras cerrar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-registro-"));
    try {
      const ruta = path.join(dir, "worker.log");
      const salida = fs.createWriteStream(ruta, { flags: "a" });
      const errores: Error[] = [];
      salida.on("error", (e) => errores.push(e));
      const largo = "x".repeat(200_000);
      const p = spawn(process.execPath, ["-e", `process.stdout.write("hola\\n"); process.stderr.write("x".repeat(200000) + "\\n"); process.exitCode = 3;`]);
      registrar(p, salida);
      await new Promise<void>((ok) => salida.on("finish", () => ok()));
      const texto = fs.readFileSync(ruta, "utf8");
      expect(texto).toContain("hola");
      expect(texto).toContain(largo);
      expect(texto.trimEnd().endsWith("--- terminó (código 3) ---")).toBe(true);
      expect(errores).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("un registro de más de 5 MB pasa a .1 y el nuevo empieza vacío", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-registro-"));
    try {
      const ruta = path.join(dir, "web.log");
      fs.writeFileSync(ruta, "a".repeat(100));
      rotarRegistro(ruta, 50);
      expect(fs.existsSync(ruta)).toBe(false);
      expect(fs.readFileSync(`${ruta}.1`, "utf8")).toHaveLength(100);
      fs.writeFileSync(ruta, "b");
      rotarRegistro(ruta, 50);
      expect(fs.readFileSync(ruta, "utf8")).toBe("b");
      rotarRegistro(path.join(dir, "no-existe.log"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("si lo cortó una señal, lo dice", () => {
    expect(comoTermino(null, "SIGKILL")).toBe("señal SIGKILL");
    expect(comoTermino(0, null)).toBe("código 0");
  });
});

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

describe("carcasa de escritorio: relanzar el worker y avisos de arranque (ESC-13)", () => {
  afterEach(() => vi.useRealTimers());

  it("cancelar el relanzamiento programado evita un segundo worker", () => {
    vi.useFakeTimers();
    const r = new Relanzamiento();
    const lanzar = vi.fn();
    r.programar(lanzar, 3000);
    expect(r.pendiente).toBe(true);
    r.cancelar(); // detenerHijos() al «Volver a intentar» o al cerrar
    vi.advanceTimersByTime(10_000);
    expect(lanzar).not.toHaveBeenCalled();
    expect(r.pendiente).toBe(false);
  });

  it("programar dos veces deja uno solo", () => {
    vi.useFakeTimers();
    const r = new Relanzamiento();
    const primero = vi.fn();
    const segundo = vi.fn();
    r.programar(primero, 3000);
    r.programar(segundo, 3000);
    vi.advanceTimersByTime(3000);
    expect(primero).not.toHaveBeenCalled();
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(r.pendiente).toBe(false);
  });

  it("el cuadro muestra los avisos esperados tal cual y un texto general para lo demás", () => {
    expect(textoErrorArranque(new AvisoArranque("Geeper tardó demasiado en arrancar."))).toBe("Geeper tardó demasiado en arrancar.");
    const raro = Object.assign(new Error("spawn C:\\Program Files\\Geeper\\node.exe ENOENT"), { code: "ENOENT" });
    expect(textoErrorArranque(raro)).toBe("Algo falló al abrir Geeper.");
    expect(textoErrorArranque("cadena suelta")).toBe("Algo falló al abrir Geeper.");
  });
});
