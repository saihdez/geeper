/** Aserciones de Promptfoo: envuelven las reglas de src/lib/evals.ts (probadas con vitest). */
import fs from "node:fs";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import { revisarDirector, revisarGanchos, revisarIdeas, revisarTitulos } from "../src/lib/evals";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const compilados = new Map<string, ValidateFunction>();

/** Valida la salida contra docs/esquemas/<nombre>.schema.json (2020-12). */
function contraEsquema(nombre: string, salida: string) {
  let v = compilados.get(nombre);
  if (!v) {
    v = ajv.compile(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "esquemas", `${nombre}.schema.json`), "utf8")));
    compilados.set(nombre, v);
  }
  let datos: unknown;
  try {
    datos = JSON.parse(salida);
  } catch {
    return { pass: false, score: 0, reason: "no es JSON" };
  }
  return v(datos) ? { pass: true, score: 1, reason: `cumple ${nombre}.schema.json` } : { pass: false, score: 0, reason: ajv.errorsText(v.errors) };
}

export const esquema_ganchos = (salida: string) => contraEsquema("ganchos", salida);
export const esquema_titulos = (salida: string) => contraEsquema("titulos", salida);
export const esquema_ideas_anuncio = (salida: string) => contraEsquema("ideas-anuncio", salida);
export const esquema_director = (salida: string) => contraEsquema("director", salida);

interface Contexto {
  vars: Record<string, unknown>;
}
const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

export const ganchos = (salida: string, c: Contexto) => revisarGanchos(salida, s(c.vars.texto));
export const titulos = (salida: string, c: Contexto) => revisarTitulos(salida, `${s(c.vars.tema)} ${s(c.vars.guion)}`);
export const anuncios = (salida: string, c: Contexto) => revisarIdeas(salida, JSON.stringify(c.vars));
export const director = (salida: string, c: Contexto) => revisarDirector(salida, s(c.vars.tema), Number(c.vars.duracion ?? 30));
