/** GPU-09: el cliente único del modelo local, con ejecutor, candado y encendido falsos (sin Ollama ni tarjeta). */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { preguntarModeloLocal, RespuestaGanchos, sugerirGanchos } from "@/lib/ganchos";
import { AVISO_DESPERTANDO, causaDeFallo, ErrorLlm, esquemaParaOllama, pedirJson, TOPE_LLM_MS, type EjecutorLlm } from "@/lib/llm-local";
import { preguntarLlm } from "@/lib/traducir";

const libre = async () => ({ liberar: () => {} });
const ocupada = async () => null;
const encendida = async () => ({ encendidos: [], faltan: [] });

/** Ejecutor falso: guarda el pedido y responde como Ollama. */
function ollama(contenido: unknown, extra: Record<string, unknown> = {}) {
  const pedidos: Record<string, unknown>[] = [];
  const topes: number[] = [];
  const ejecutar: EjecutorLlm = async (cuerpo, tope) => {
    pedidos.push(JSON.parse(cuerpo));
    topes.push(tope);
    return { codigo: 0, stdout: JSON.stringify({ message: { content: typeof contenido === "string" ? contenido : JSON.stringify(contenido) }, prompt_eval_count: 120, eval_count: 40, ...extra }), stderr: "" };
  };
  return { ejecutar, pedidos, topes };
}
const fallo = (stderr: string): EjecutorLlm => async () => ({ codigo: 1, stdout: "", stderr });

const Esquema = z.object({ titulos: z.array(z.string().max(10)) });

describe("pedirJson (GPU-09)", () => {
  it("manda el JSON Schema en `format`, descarga el modelo, valida con Zod y suelta la tarjeta", async () => {
    const o = ollama({ titulos: ["Uno", "Dos"] });
    let liberado = false;
    const r = await pedirJson("gemma4:12b", "hola", Esquema, { tarea: "t", ejecutar: o.ejecutar, encender: encendida, candado: async () => ({ liberar: () => (liberado = true) }), sistema: "sé breve" });
    expect(r.datos.titulos).toEqual(["Uno", "Dos"]);
    expect(r.tokensSalida).toBe(40);
    expect(liberado).toBe(true);
    const p = o.pedidos[0]!;
    expect(p).toMatchObject({ keep_alive: 0, think: false, stream: false });
    expect((p.format as { type: string }).type).toBe("object");
    expect((p.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("el tope por defecto deja cargar el modelo en frío (300 s) y avisa que la IA está despertando", async () => {
    const o = ollama({ titulos: ["a"] });
    const avisos: string[] = [];
    await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: o.ejecutar, encender: encendida, candado: libre, avisar: (t) => avisos.push(t) });
    expect(TOPE_LLM_MS).toBe(300_000);
    expect(o.topes).toEqual([300_000]);
    expect(avisos).toContain(AVISO_DESPERTANDO);
  });

  it("con la tarjeta tomada enciende Ollama si quedó apagado; si no existe, lo dice", async () => {
    let encendio = 0;
    await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({ titulos: ["a"] }).ejecutar, candado: libre, encender: async () => (encendio++, { encendidos: ["mpt-ollama"], faltan: [] }) });
    expect(encendio).toBe(1);
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({}).ejecutar, candado: libre, encender: async () => ({ encendidos: [], faltan: ["mpt-ollama"] }) })).rejects.toMatchObject({ causa: "mpt-apagado" });
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({}).ejecutar, candado: libre, encender: async () => ({ encendidos: [], faltan: [], sinDocker: true }) })).rejects.toThrow(/Docker Desktop/);
  });

  it("respuesta que no cumple Zod o cortada → respuesta-invalida (y libera la tarjeta)", async () => {
    let liberado = false;
    const p = pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({ titulos: ["demasiado largo para diez"] }).ejecutar, encender: encendida, candado: async () => ({ liberar: () => (liberado = true) }) });
    await expect(p).rejects.toMatchObject({ causa: "respuesta-invalida" });
    expect(liberado).toBe(true);
    const corta = ollama('{"titulos":["a"', { done_reason: "length", eval_count: 3808 });
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: corta.ejecutar, encender: encendida, candado: libre })).rejects.toMatchObject({ causa: "respuesta-invalida", detalle: expect.stringMatching(/cortada.*3808/) });
  });

  it("acepta JSON con cercas de Markdown; formato json no manda esquema", async () => {
    const r = await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama('```json\n{"titulos":["a"]}\n```').ejecutar, encender: encendida, candado: libre });
    expect(r.datos.titulos).toEqual(["a"]);
    const o = ollama({ titulos: ["a"] });
    await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: o.ejecutar, encender: encendida, candado: libre, formato: "json" });
    expect(o.pedidos[0]!.format).toBe("json");
  });

  it("Docker apagado, MPT apagado, modelo que falta, tope y tarjeta ocupada se dicen en palabras", async () => {
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: fallo("failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine"), encender: encendida, candado: libre })).rejects.toThrow(/Docker Desktop/);
    expect(causaDeFallo({ codigo: 1, stdout: "", stderr: "Error response from daemon: No such container: moneyprinterturbo-api" })).toBe("mpt-apagado");
    expect(causaDeFallo({ codigo: 3, stdout: "", stderr: 'HTTP 404: {"error":"model \'x\' not found"}' })).toBe("modelo-falta");
    expect(causaDeFallo({ codigo: 1, stdout: "", stderr: "TimeoutError: timed out" })).toBe("tiempo");
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({}).ejecutar, candado: ocupada })).rejects.toMatchObject({ causa: "gpu-ocupada" });
    expect(new ErrorLlm("tiempo").message).toMatch(/tardó/);
  });

  it("el esquema de ganchos se puede pasar a Ollama (sin $ref ni $schema)", () => {
    const j = esquemaParaOllama(RespuestaGanchos);
    expect(j.$schema).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain("$ref");
  });
});

describe("llamadores que pasan por el cliente único", () => {
  it("ganchos: filtra lo que devuelve el modelo", async () => {
    const o = ollama({ ganchos: ["Nadie vio esto venir", "nadie vio esto venir"], titulo: "Kai REACCIONA" });
    const s = await sugerirGanchos({ texto: "algo pasó", canal: null, idioma: "es", react: true }, { ejecutar: o.ejecutar, candado: libre, encender: encendida });
    expect(s).toEqual({ ganchos: ["Nadie vio esto venir"], titulo: "Kai REACCIONA" });
  });

  it("ganchos: Docker apagado da un error claro con qué hacer", async () => {
    await expect(sugerirGanchos({ texto: "x", canal: null, idioma: "es", react: false }, { ejecutar: fallo("docker API daemon"), candado: libre, encender: encendida })).rejects.toThrow(/Docker Desktop.*a mano/);
  });

  it("sugerir texto: devuelve el JSON crudo", async () => {
    const crudo = await preguntarModeloLocal("p", "sugerir texto", "escribirlo a mano", { ejecutar: ollama({ titulo: "Hola" }).ejecutar, candado: libre, encender: encendida });
    expect(JSON.parse(crudo)).toEqual({ titulo: "Hola" });
  });

  it("traducir: espera la tarjeta, usa un tope largo y el modelo que se pida", async () => {
    const o = ollama({ escenas: [] });
    let espero: boolean | undefined;
    const ctx = { dir: "/tmp/proy", log: () => undefined };
    const crudo = await preguntarLlm("p", "Traducción", ctx, { modelo: "gemma4:12b", ejecutar: o.ejecutar, encender: encendida, candado: async (_t, esperar) => ((espero = esperar), { liberar: () => {} }) });
    expect(JSON.parse(crudo)).toEqual({ escenas: [] });
    expect(espero).toBe(true);
    expect(o.pedidos[0]!.model).toBe("gemma4:12b");
    expect(o.topes[0]).toBe(600_000);
  });
});
