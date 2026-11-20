import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RespuestaLlm as RespuestaIdeas, pedirIdeas } from "@/lib/anuncios/ideas";
import { datosVacios } from "@/lib/anuncios/esquema";
import { CONTRATOS } from "@/lib/contratos";
import { RespuestaGanchos, sugerirGanchos } from "@/lib/ganchos";
import { causaDeFallo, ErrorLlm, esquemaParaOllama, pedirJson, type EjecutorLlm } from "@/lib/llm-local";
import { proponerTitulos } from "@/lib/titulos";

const libre = async () => ({ liberar: () => {} });
const ocupada = async () => null;

/** Ejecutor falso: guarda el pedido y responde como Ollama. */
function ollama(contenido: unknown, extra: Record<string, unknown> = {}) {
  const pedidos: Record<string, unknown>[] = [];
  const ejecutar: EjecutorLlm = async (cuerpo) => {
    pedidos.push(JSON.parse(cuerpo));
    return { codigo: 0, stdout: JSON.stringify({ message: { content: typeof contenido === "string" ? contenido : JSON.stringify(contenido) }, prompt_eval_count: 120, eval_count: 40, ...extra }), stderr: "" };
  };
  return { ejecutar, pedidos };
}
const fallo = (stderr: string): EjecutorLlm => async () => ({ codigo: 1, stdout: "", stderr });

const Esquema = z.object({ titulos: z.array(z.string().max(10)) });

describe("pedirJson (A3)", () => {
  it("manda el JSON Schema en `format`, descarga el modelo y valida con Zod", async () => {
    const o = ollama({ titulos: ["Uno", "Dos"] });
    let liberado = false;
    const r = await pedirJson("gemma4:12b", "hola", Esquema, { tarea: "t", ejecutar: o.ejecutar, candado: async () => ({ liberar: () => (liberado = true) }), sistema: "sé breve" });
    expect(r.datos.titulos).toEqual(["Uno", "Dos"]);
    expect(r.tokensSalida).toBe(40);
    expect(liberado).toBe(true);
    const p = o.pedidos[0]!;
    expect(p.keep_alive).toBe(0);
    expect(p.stream).toBe(false);
    expect((p.format as { type: string }).type).toBe("object");
    expect((p.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("respuesta que no cumple Zod → respuesta-invalida (y libera la GPU)", async () => {
    let liberado = false;
    const p = pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({ titulos: ["demasiado largo para diez"] }).ejecutar, candado: async () => ({ liberar: () => (liberado = true) }) });
    await expect(p).rejects.toMatchObject({ causa: "respuesta-invalida" });
    expect(liberado).toBe(true);
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama("no es json").ejecutar, candado: libre })).rejects.toMatchObject({ causa: "respuesta-invalida" });
  });

  it("acepta JSON con cercas de Markdown", async () => {
    const r = await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama('```json\n{"titulos":["a"]}\n```').ejecutar, candado: libre });
    expect(r.datos.titulos).toEqual(["a"]);
  });

  it("Docker apagado, MPT apagado, modelo que falta y GPU ocupada se dicen en palabras", async () => {
    const docker = "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine";
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: fallo(docker), candado: libre })).rejects.toThrow(/Docker Desktop/);
    expect(causaDeFallo({ codigo: 1, stdout: "", stderr: "Error response from daemon: No such container: moneyprinterturbo-api" })).toBe("mpt-apagado");
    expect(causaDeFallo({ codigo: 1, stdout: "", stderr: "Error: No such container: moneyprinterturbo-api" })).toBe("mpt-apagado");
    expect(causaDeFallo({ codigo: 3, stdout: "", stderr: 'HTTP 404: {"error":"model \'x\' not found"}' })).toBe("modelo-falta");
    expect(causaDeFallo({ codigo: 1, stdout: "", stderr: "urllib.error.URLError: <urlopen error [Errno -2] Name or service not known>" })).toBe("ollama-no-responde");
    await expect(pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: ollama({}).ejecutar, candado: ocupada })).rejects.toMatchObject({ causa: "gpu-ocupada" });
  });

  it("formato json: sin esquema en la gramática, igual valida con Zod", async () => {
    const o = ollama({ titulos: ["a"] });
    await pedirJson("m", "p", Esquema, { tarea: "t", ejecutar: o.ejecutar, candado: libre, formato: "json" });
    expect(o.pedidos[0]!.format).toBe("json");
  });

  it("todos los contratos y respuestas se pueden pasar a Ollama (sin $ref ni $schema)", () => {
    for (const e of [...CONTRATOS.map((c) => c.esquema), RespuestaGanchos, RespuestaIdeas]) {
      const j = esquemaParaOllama(e);
      expect(j.$schema).toBeUndefined();
      expect(JSON.stringify(j)).not.toContain("$ref");
    }
  });

  it("es un ErrorLlm con mensaje para la persona", () => {
    expect(new ErrorLlm("tiempo").message).toMatch(/tardó/);
  });
});

describe("llamadores migrados", () => {
  it("ganchos: filtra lo que devuelve el modelo", async () => {
    const o = ollama({ ganchos: ["Nadie vio esto venir", "GTA 6 leak exclusivo", "nadie vio esto venir"], titulo: "Kai REACCIONA" });
    const s = await sugerirGanchos({ texto: "algo pasó", canal: null, idioma: "es", react: true }, { ejecutar: o.ejecutar, candado: libre });
    expect(s).toEqual({ ganchos: ["Nadie vio esto venir"], titulo: "Kai REACCIONA" });
  });

  it("ganchos: Docker apagado da un error claro", async () => {
    await expect(sugerirGanchos({ texto: "x", canal: null, idioma: "es", react: false }, { ejecutar: fallo("docker API daemon"), candado: libre })).rejects.toThrow(/Docker Desktop.*a mano/);
  });

  it("títulos: IA si responde, sugeridos con motivo si no", async () => {
    const o = { nombre: "Faros", tema: "faros", guion: "…", formato: "9:16" };
    const ia = await proponerTitulos(o, { ejecutar: ollama({ titulos: ["Faros que nadie visita", "#x ¿Por qué siguen?"] }).ejecutar, candado: libre });
    expect(ia).toEqual({ titulos: ["Faros que nadie visita", "¿Por qué siguen?"], fuente: "ia" });
    const sin = await proponerTitulos(o, { ejecutar: fallo("docker API"), candado: libre });
    expect(sin.fuente).toBe("sugeridos");
    expect(sin.motivo).toMatch(/Docker Desktop/);
    expect((await proponerTitulos(o, { candado: ocupada })).motivo).toMatch(/ocupada/);
  });

  it("ideas de anuncios: devuelve el JSON validado", async () => {
    const respuesta = { conceptos: [{ nombre: "Uno", gancho: "Un gancho", guion: "Un guion de más de veinte caracteres." }] };
    const crudo = await pedirIdeas(datosVacios(), { ejecutar: ollama(respuesta).ejecutar, candado: libre });
    expect(JSON.parse(crudo)).toEqual(respuesta);
    await expect(pedirIdeas(datosVacios(), { ejecutar: fallo("No such container: moneyprinterturbo-api"), candado: libre })).rejects.toThrow(/MoneyPrinterTurbo no está corriendo/);
  });
});
