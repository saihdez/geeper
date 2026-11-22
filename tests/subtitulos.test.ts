import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agrupar, aplicarCorrecciones, lineas, reemplazar, type Ficha } from "@/lib/subtitulos";
import { pruebasReales } from "./ayudas/reales";

const PY = path.join(process.cwd(), "py", "geeper_py.py");
const py = (accion: string, datos: unknown) => JSON.parse(execFileSync("python3", [PY, accion], { input: JSON.stringify(datos) }).toString());
/** El original del estudio (sólo en la PC de desarrollo): la referencia de la paridad. */
const BIN_ESTUDIO = path.join(os.homedir(), "dev", "video-tools", "bin");
const hayEstudio = fs.existsSync(path.join(BIN_ESTUDIO, "mpt_acabado.py"));
const estudio = (fn: string, ...args: unknown[]) =>
  JSON.parse(
    execFileSync("python3", ["-c", `import json, sys; sys.path.insert(0, sys.argv[1]); import mpt_acabado as m; a = json.load(sys.stdin); print(json.dumps(getattr(m, sys.argv[2])(*a), ensure_ascii=False))`, BIN_ESTUDIO, fn], {
      input: JSON.stringify(args),
    }).toString(),
  );

const guion = "Vice City te espera. GTA seis llega pronto, y nadie sabe qué pasará en GTA seis… ¿Listo?";
const palabras = guion.split(" ").map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + (i % 5 === 4 ? 0.2 : 0.38) }));
const fichas: Ficha[] = palabras.map((w, i) => ({ texto: w.text, inicio: w.start, fin: w.end, origen: [i, i + 1] }));

describe.skipIf(!pruebasReales || !hayEstudio)("paridad con mpt_acabado.py", () => {
  it("reemplazar = reemplazos()", () => {
    const esperado = estudio("reemplazos", palabras, ["GTA seis=GTA VI"]) as { text: string; start: number; end: number }[];
    const nuestro = reemplazar(fichas, [{ de: "GTA seis", a: "GTA VI" }]);
    expect(nuestro.map((f) => [f.texto, +f.inicio.toFixed(6), +f.fin.toFixed(6)])).toEqual(
      esperado.map((w) => [w.text, +w.start.toFixed(6), +w.end.toFixed(6)]),
    );
  });

  it("agrupar = agrupar()", () => {
    const esperado = estudio("agrupar", palabras) as { text: string }[][];
    const nuestro = agrupar(fichas);
    expect(nuestro.map((g) => g.map((f) => f.texto))).toEqual(esperado.map((g) => g.map((w) => w.text)));
  });

  it("alinear() pone la puntuación del guion sobre los tiempos de whisper", () => {
    const w = [
      { text: "hola", start: 0, end: 0.3 },
      { text: "mundo", start: 0.35, end: 0.7 },
    ];
    const r = py("alinear", { guion: "¡Hola, mundo!", palabras: w });
    expect(r).toEqual([
      { text: "¡Hola,", start: 0, end: 0.3 },
      { text: "mundo!", start: 0.35, end: 0.7 },
    ]);
  });

  it("la copia de alinear() en py/alineacion.py da lo mismo que el original", () => {
    // Guion con palabras que whisper no oyó, cambió o agregó, para pasar por insert, replace y delete.
    const g = "Vice City te espera. GTA seis llega pronto, y nadie sabe qué pasará… ¿Listo? ¡Vamos!";
    const w = ["vice", "city", "te", "espera", "gta", "6", "llega", "muy", "pronto", "nadie", "sabe", "que", "pasara", "listo"].map((t, i) => ({ text: t, start: i * 0.31, end: i * 0.31 + 0.27 }));
    expect(py("alinear", { guion: g, palabras: w })).toEqual(estudio("alinear", g, w));
    expect(py("alinear", { guion: g, palabras: [] })).toEqual(estudio("alinear", g, []));
  });
});

describe("correcciones", () => {
  const ps = [
    { texto: "Los", inicio: 0, fin: 0.2 },
    { texto: "faros", inicio: 0.2, fin: 0.6 },
    { texto: "brillan.", inicio: 0.6, fin: 1.0 },
  ];
  it("reparte los tiempos del tramo corregido y conserva el origen", () => {
    const r = aplicarCorrecciones(ps, [{ desde: 1, hasta: 3, texto: "faros siguen brillando." }]);
    expect(r.map((f) => f.texto)).toEqual(["Los", "faros", "siguen", "brillando."]);
    expect(r[1]!.inicio).toBeCloseTo(0.2);
    expect(r[3]!.fin).toBeCloseTo(1.0);
    expect(r[2]!.origen).toEqual([1, 3]);
  });
  it("una corrección vacía oculta esas palabras", () => {
    expect(aplicarCorrecciones(ps, [{ desde: 0, hasta: 1, texto: "" }]).map((f) => f.texto)).toEqual(["faros", "brillan."]);
  });
});

describe("lineas", () => {
  it("no parte palabras ni cierra una línea en preposición", () => {
    expect(lineas("operan en condiciones climáticas", 18)).toEqual(["operan", "en condiciones", "climáticas"]);
  });
  it("equilibra sin sumar líneas (el voraz daría 32 + 11 caracteres)", () => {
    const ls = lineas("los faros guiaron barcos durante siglos aquí", 32);
    expect(ls).toEqual(["los faros guiaron barcos", "durante siglos aquí"]);
    expect(Math.max(...ls.map((l) => l.length))).toBeLessThanOrEqual(32);
  });
  it("evita dejar «de» al final si el desequilibrio es razonable", () => {
    expect(lineas("la historia de los faros", 16)).toEqual(["la historia", "de los faros"]);
  });
  it("con puntuación pegada la palabra débil sí puede cerrar línea", () => {
    expect(lineas("pienso que sin duda", 15)).toEqual(["pienso", "que sin duda"]);
    expect(lineas("pienso que, sin duda", 15)).toEqual(["pienso que,", "sin duda"]);
  });
  it("una palabra más larga que la línea queda sola", () => {
    expect(lineas("ok electroencefalografista sí", 10)).toEqual(["ok", "electroencefalografista", "sí"]);
  });
  it("respeta siempre el máximo y el número de líneas del corte voraz", () => {
    const texto = "una frase bastante larga para probar el reparto de las líneas en los subtítulos del video";
    for (const max of [12, 18, 24, 32, 42]) {
      const ls = lineas(texto, max);
      expect(ls.join(" ")).toBe(texto);
      expect(Math.max(...ls.map((l) => l.length))).toBeLessThanOrEqual(max);
      let voraz = 1;
      let largo = 0;
      for (const w of texto.split(" ")) {
        if (largo && largo + 1 + w.length > max) {
          voraz++;
          largo = w.length;
        } else largo += (largo ? 1 : 0) + w.length;
      }
      expect(ls.length).toBe(voraz);
    }
  });
});
