import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// llama-server simulado: un script de Node que atiende /health y /v1/chat/completions en el puerto que le
// pasan. FAKE_LLAMA_MODO: ok | muere | http500. Anota los argumentos y el cuerpo en FAKE_LLAMA_REG.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-llama-"));
const servidor = path.join(dir, "llama-server");
const modelo = path.join(dir, "gemma4-26b.gguf");
const reg = path.join(dir, "registro.json");
fs.writeFileSync(modelo, "GGUF");
fs.writeFileSync(
  servidor,
  `#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const args = process.argv.slice(2);
const modo = process.env.FAKE_LLAMA_MODO;
if (modo === "muere") { process.stderr.write("error: no se pudo cargar el modelo\\n"); process.exit(1); }
const puerto = Number(args[args.indexOf("--port") + 1]);
let listo = false;
setTimeout(() => (listo = true), 300);
http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(listo ? 200 : 503); return res.end(); }
  let cuerpo = "";
  req.on("data", (d) => (cuerpo += d));
  req.on("end", () => {
    fs.writeFileSync(process.env.FAKE_LLAMA_REG, JSON.stringify({ args, cuerpo: JSON.parse(cuerpo) }));
    if (modo === "http500") { res.writeHead(500); return res.end("fallo"); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"titulos":["Uno"]}' } }] }));
  });
}).listen(puerto, "127.0.0.1");
process.on("SIGTERM", () => { fs.appendFileSync(process.env.FAKE_LLAMA_REG + ".fin", "cerrado"); process.exit(0); });
`,
  { mode: 0o755 },
);

const puertoLibre = () =>
  new Promise<number>((ok) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });

process.env.GEEPER_LLAMA_SERVER = servidor;
process.env.GEEPER_LLAMA_MODELO = modelo;
process.env.GEEPER_LLAMA_PUERTO = String(await puertoLibre());
process.env.FAKE_LLAMA_REG = reg;
const m = await import("@/lib/llm-local");

beforeEach(() => {
  process.env.GEEPER_LLM = "llama";
  process.env.FAKE_LLAMA_MODO = "ok";
  fs.rmSync(reg, { force: true });
  fs.rmSync(`${reg}.fin`, { force: true });
});

describe("texto local con llama.cpp", () => {
  it("abre el servidor, pide JSON sin razonamiento y lo cierra antes de devolver", async () => {
    const log: string[] = [];
    expect(await m.preguntarLlama("Hola", { timeout: 20_000, log: (l) => log.push(l) })).toBe('{"titulos":["Uno"]}');
    const r = JSON.parse(fs.readFileSync(reg, "utf8"));
    expect(r.cuerpo.response_format).toEqual({ type: "json_object" });
    expect(r.cuerpo.messages[0].content).toBe("Hola");
    expect(r.args).toEqual(expect.arrayContaining(["-m", modelo, "--host", "127.0.0.1", "--reasoning", "off", "-fa", "on"]));
    // Cerrado (la VRAM se libera antes de soltar el candado de GPU).
    expect(fs.readFileSync(`${reg}.fin`, "utf8")).toBe("cerrado");
    expect(log[0]).toMatch(/Cargando llama\.cpp \(gemma4-26b\)/);
  });

  it("si llama-server se cae al cargar, devuelve null y dice el motivo (sigue Ollama)", async () => {
    process.env.FAKE_LLAMA_MODO = "muere";
    const log: string[] = [];
    expect(await m.preguntarLlama("Hola", { timeout: 20_000, log: (l) => log.push(l) })).toBeNull();
    expect(log.at(-1)).toMatch(/no se pudo cargar el modelo.*sigo con Ollama/);
  });

  it("si la API responde con error, devuelve null", async () => {
    process.env.FAKE_LLAMA_MODO = "http500";
    expect(await m.preguntarLlama("Hola", { timeout: 20_000 })).toBeNull();
    expect(fs.readFileSync(`${reg}.fin`, "utf8")).toBe("cerrado");
  });

  it("la cancelación de la persona no cae a Ollama: se propaga", async () => {
    const c = new AbortController();
    setTimeout(() => c.abort(new Error("cancelado")), 100);
    await expect(m.preguntarLlama("Hola", { timeout: 20_000, signal: c.signal })).rejects.toThrow("cancelado");
  });

  it("GEEPER_LLM=ollama o sin modelo: no se usa", async () => {
    process.env.GEEPER_LLM = "ollama";
    expect(m.llamaDisponible()).toBe(false);
    expect(await m.preguntarLlama("Hola", { timeout: 1000 })).toBeNull();
    expect(fs.existsSync(reg)).toBe(false);
  });

  it("en las pruebas no se usa salvo que se pida (nunca el llama-server real)", () => {
    delete process.env.GEEPER_LLM;
    expect(m.llamaDisponible()).toBe(false);
  });

  it("usa el borrador para la decodificación especulativa sólo si existe y no está apagado", () => {
    expect(m.argsServidor(8192)).not.toContain("-md");
    fs.writeFileSync(m.LLAMA_BORRADOR, "GGUF");
    try {
      expect(m.argsServidor(8192)).toEqual(expect.arrayContaining(["-md", path.join(dir, "gemma4-26b-borrador.gguf")]));
      process.env.GEEPER_LLAMA_BORRADOR = "0";
      expect(m.argsServidor(8192)).not.toContain("-md");
    } finally {
      delete process.env.GEEPER_LLAMA_BORRADOR;
      fs.rmSync(m.LLAMA_BORRADOR);
    }
  });

  it("un solo pedido a la vez, con el contexto indicado", () => {
    expect(m.argsServidor(8192)).toEqual(expect.arrayContaining(["-c", "8192", "-np", "1"]));
  });
});
