import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_ID, CONTRATOS, jsonSchema, rutaRelativaEsquema, textoEsquema } from "@/lib/contratos";
import { validarDirector } from "@/lib/director";
import { formatoDePesos, PESOS } from "@/lib/modelos";
import { proyectoDePrueba } from "./fixtures";

const RAIZ = path.resolve(__dirname, "..");

describe("contratos en JSON Schema (docs/esquemas)", () => {
  it.each(CONTRATOS.map((c) => [c.nombre, c] as const))("%s está al día con Zod (si falla: pnpm run esquemas)", (_n, c) => {
    const enRepo = fs.readFileSync(path.join(RAIZ, rutaRelativaEsquema(c.nombre)), "utf8");
    expect(enRepo).toBe(textoEsquema(c));
  });

  it("cada esquema es 2020-12, con $id estable y descripción en español", () => {
    for (const c of CONTRATOS) {
      const j = jsonSchema(c);
      expect(j.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(j.$id).toBe(`${BASE_ID}${c.nombre}.schema.json`);
      expect(String(j.description)).toMatch(/src\/lib\//);
    }
  });

  it("el JSON Schema de geeper.json describe un proyecto real (claves requeridas y conocidas)", () => {
    const j = jsonSchema(CONTRATOS.find((c) => c.nombre === "geeper")!) as { required: string[]; properties: Record<string, { description?: string }>; additionalProperties?: unknown };
    const p = proyectoDePrueba() as unknown as Record<string, unknown>;
    for (const k of j.required) expect(p).toHaveProperty(k);
    for (const k of Object.keys(p)) expect(Object.keys(j.properties)).toContain(k);
    expect(j.properties.comercial?.description).toMatch(/QC/);
  });
});

describe("contrato del director (G1)", () => {
  const escena = (id: string, narracion: string, ritmo: unknown[] = []) => ({
    id,
    narracion,
    plano: { tipo: "generado", descripcion: "Un faro de noche bajo la lluvia", encuadre: "general" },
    duracionEstimada: 4,
    ritmo,
  });

  it("acepta un storyboard válido y rellena lo opcional", () => {
    const d = validarDirector({
      titulo: "Faros",
      tema: "Por qué siguen encendidos los faros",
      duracionObjetivo: 30,
      escenas: [escena("e01", "Hay faros que nadie visita.", [{ tipo: "enfasis", palabra: 3 }]), escena("e02", "Y siguen encendidos.")],
    });
    expect(d.formato).toBe("9:16");
    expect(d.escenas[1]!.ritmo).toEqual([]);
  });

  it("rechaza ids repetidos, marcas fuera de la narración y campos que no existen", () => {
    const base = { titulo: "x", tema: "y", duracionObjetivo: 30 };
    expect(() => validarDirector({ ...base, escenas: [escena("e01", "Uno dos."), escena("e01", "Tres.")] })).toThrow(/mismo id/);
    expect(() => validarDirector({ ...base, escenas: [escena("e01", "Uno dos.", [{ tipo: "corte", palabra: 2 }])] })).toThrow(/fuera de la narración/);
    expect(() => validarDirector({ ...base, escenas: [escena("e01", "Uno.")], extra: 1 })).toThrow();
    expect(() => validarDirector({ ...base, escenas: [escena("escena-1", "Uno.")] })).toThrow();
  });
});

describe("formatos de pesos (E2)", () => {
  it("todos los pesos registrados están en un formato sin pickle", () => {
    for (const [modelo, ruta] of Object.entries(PESOS)) expect(formatoDePesos(ruta), modelo).not.toBeNull();
  });

  it("rechaza pickle y acepta los formatos seguros", () => {
    expect(formatoDePesos("/x/modelo.pt")).toBeNull();
    expect(formatoDePesos("/x/modelo.pth")).toBeNull();
    expect(formatoDePesos("/x/pytorch_model.bin")).toBeNull();
    expect(formatoDePesos("/x/model.ckpt")).toBeNull();
    expect(formatoDePesos("/x/ggml-medium.bin")).toBe("ggml");
    expect(formatoDePesos("/x/model.safetensors")).toBe("safetensors");
    expect(formatoDePesos("/x/gemma.Q4_K_M.gguf")).toBe("gguf");
    expect(formatoDePesos("/x/kokoro-v1.0.onnx")).toBe("onnx");
  });
});
