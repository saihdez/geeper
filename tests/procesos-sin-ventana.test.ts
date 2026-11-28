import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * En la app de escritorio, Electron abre la web y el worker sin consola (`windowsHide: true`). En
 * Windows, un programa de consola (ffmpeg, ffprobe, Python, taskkill…) que lance un proceso sin consola
 * abre su propia ventana negra, salvo que también se lance con `windowsHide: true`. Esta prueba exige
 * esa opción en cada proceso que lanza el código de la app. Idea tomada de los «pitfalls» de
 * storytold/craft-anything («Console windows popping up over the app»).
 *
 * Un programa con ventana propia (AniCraft) lleva `windowsHide: false` a propósito: también cuenta,
 * porque la opción está escrita.
 */

const RAIZ = path.resolve(__dirname, "..");
const CARPETAS = ["src", "worker", "escritorio"];
const LLAMADAS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : archivos(p);
    return /\.(ts|tsx|mjs|cjs|js)$/.test(e.name) ? [p] : [];
  });
}

/** El texto de la llamada que abre en `inicio` (el índice del paréntesis), hasta su cierre. */
function llamada(texto: string, inicio: number): string {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(inicio, i + 1);
  }
  return texto.slice(inicio);
}

/** Las llamadas a procesos de un archivo que no dicen `windowsHide`, como «archivo:línea». */
function sinWindowsHide(ruta: string, texto: string): string[] {
  if (!/from "(node:)?child_process"|require\("(node:)?child_process"\)|import\("node:child_process"\)/.test(texto)) return [];
  // Alias de `promisify(execFile)` y parecidos: también lanzan procesos.
  const alias = [...texto.matchAll(/const (\w+) = promisify\((?:execFile|exec)\)/g)].map((m) => m[1]!);
  const nombres = [...LLAMADAS, ...alias].join("|");
  const fallas: string[] = [];
  for (const m of texto.matchAll(new RegExp(`(?<![\\w.$])(?:${nombres})\\(`, "g"))) {
    const linea = texto.slice(0, m.index).split("\n").length;
    const renglon = texto.split("\n")[linea - 1]!.trim();
    if (renglon.startsWith("//") || renglon.startsWith("*")) continue;
    if (!llamada(texto, m.index! + m[0].length - 1).includes("windowsHide")) fallas.push(`${path.relative(RAIZ, ruta)}:${linea}`);
  }
  return fallas;
}

describe("procesos sin ventana de consola en Windows", () => {
  it("cada proceso que lanza la app pasa windowsHide", () => {
    const fallas = CARPETAS.flatMap((c) => archivos(path.join(RAIZ, c))).flatMap((r) => sinWindowsHide(r, fs.readFileSync(r, "utf8")));
    expect(fallas).toEqual([]);
  });

  it("detecta una llamada sin la opción, también por un alias de promisify", () => {
    const texto = [
      'import { execFile, spawn } from "node:child_process";',
      "const ejecutar = promisify(execFile);",
      'spawn("ffmpeg", ["-i", x], { stdio: "ignore" });',
      'await ejecutar("ffprobe", [x]);',
      'spawn("ffmpeg", [], { windowsHide: true });',
      "// spawn(\"comentario\")",
    ].join("\n");
    expect(sinWindowsHide(path.join(RAIZ, "x.ts"), texto)).toEqual(["x.ts:3", "x.ts:4"]);
  });
});
