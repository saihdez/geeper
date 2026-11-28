/** Workflows: «Editar» un resultado (vuelve a la receta con lo pedido y el mismo archivo) y «Eliminar». */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-wf-editar-"));
process.env.GEEPER_DATA = dir;

const encolados: { payload: { corrida: string; pedido: { archivos: { nodo: number; nombre: string }[]; textos: unknown[] } } }[] = [];
let trabajos: { id: string; estado: string; payload: unknown }[] = [];
const WF = { id: "quitar-fondo", titulo: "Quitar el fondo", local: true, modelos: [] as string[], complementos: [] as string[], entradas: [{ nodo: 3, medio: "image", archivo: null }], miniaturas: [] };
vi.mock("@/lib/comfyui", async (original) => ({ ...(await original<typeof import("@/lib/comfyui")>()), leerCatalogo: async () => ({ workflows: [WF], archivos: {} }) }));
vi.mock("@/lib/instalar-comfyui", () => ({ revisarComfyui: () => ({ falta: false }) }));
vi.mock("@/lib/nodos-comfy", () => ({ infoNodos: async () => [], permitirNodos: async () => {} }));
vi.mock("@/lib/cola", () => ({ encolar: async (_p: null, _tipo: string, payload: never) => (encolados.push({ payload }), { id: "t1" }) }));
vi.mock("@/lib/db", () => ({
  db: { trabajo: { findMany: async (q: { where: { estado?: { in: string[] } } }) => trabajos.filter((t) => !q.where.estado || q.where.estado.in.includes(t.estado)) } },
}));

const ctxCorrida = (corrida: string) => ({ params: Promise.resolve({ corrida }) });
const dirC = (id: string) => path.join(dir, "workflows", id);

function corrida(id: string, extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(dirC(id), "entradas"), { recursive: true });
  fs.writeFileSync(path.join(dirC(id), "corrida.json"), JSON.stringify({ id, workflow: "quitar-fondo", titulo: "Quitar el fondo", creada: "2026-11-27", estado: "hecha", salidas: [{ archivo: "out.png", tipo: "imagen" }], ...extra }));
  fs.writeFileSync(path.join(dirC(id), "out.png"), "png");
}

beforeEach(() => {
  encolados.length = 0;
  trabajos = [];
});

describe("Eliminar un resultado", () => {
  it("borra también los que salieron bien", async () => {
    corrida("c-hecha");
    const { DELETE } = await import("@/app/api/workflows/corridas/[corrida]/route");
    const r = await DELETE(new Request("http://x"), ctxCorrida("c-hecha"));
    expect(r.status).toBe(200);
    expect(fs.existsSync(dirC("c-hecha"))).toBe(false);
  });

  it("no borra uno que todavía se está creando", async () => {
    corrida("c-viva", { estado: "preparada", salidas: [] });
    trabajos = [{ id: "t", estado: "corriendo", payload: { corrida: "c-viva" } }];
    const { DELETE } = await import("@/app/api/workflows/corridas/[corrida]/route");
    const r = await DELETE(new Request("http://x"), ctxCorrida("c-viva"));
    expect(r.status).toBe(400);
    expect(fs.existsSync(dirC("c-viva"))).toBe(true);
  });
});

describe("Editar un resultado", () => {
  it("devuelve los textos guardados en la corrida y los archivos que se subieron", async () => {
    corrida("c-textos", { textos: [{ nodo: "6", indice: 0, valor: "un gato" }] });
    fs.writeFileSync(path.join(dirC("c-textos"), "entradas", "entrada-3.png"), "foto");
    const { GET } = await import("@/app/api/workflows/corridas/[corrida]/route");
    const r = await GET(new Request("http://x"), ctxCorrida("c-textos"));
    expect(await r.json()).toEqual({ corrida: "c-textos", workflow: "quitar-fondo", textos: [{ nodo: "6", indice: 0, valor: "un gato" }], archivos: [{ nodo: 3, nombre: "entrada-3.png" }] });
  });

  it("una corrida vieja sin textos los toma del trabajo que la corrió", async () => {
    corrida("c-vieja");
    trabajos = [
      { id: "otro", estado: "hecho", payload: { corrida: "otra", pedido: { workflow: "quitar-fondo", textos: [{ nodo: "1", indice: 0, valor: "no" }] } } },
      { id: "t", estado: "hecho", payload: { corrida: "c-vieja", pedido: { workflow: "quitar-fondo", textos: [{ nodo: "6", indice: 0, valor: "un perro" }] } } },
    ];
    const { GET } = await import("@/app/api/workflows/corridas/[corrida]/route");
    const { textos } = (await (await GET(new Request("http://x"), ctxCorrida("c-vieja"))).json()) as { textos: unknown[] };
    expect(textos).toEqual([{ nodo: "6", indice: 0, valor: "un perro" }]);
  });

  it("al crear otra versión sin subir nada, reutiliza el archivo de la anterior y guarda los textos", async () => {
    corrida("c-base");
    fs.writeFileSync(path.join(dirC("c-base"), "entradas", "entrada-3.png"), "foto-original");
    const { POST } = await import("@/app/api/workflows/[id]/route");
    const fd = new FormData();
    fd.set("textos", JSON.stringify([{ nodo: "6", indice: 0, valor: "otro fondo" }]));
    fd.set("reusar", "c-base");
    const r = await POST(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ id: "quitar-fondo" }) });
    expect(r.status).toBe(201);
    const { corrida: nueva } = (await r.json()) as { corrida: string };
    expect(encolados[0]!.payload.pedido.archivos).toEqual([{ nodo: 3, nombre: "entrada-3.png" }]);
    expect(fs.readFileSync(path.join(dirC(nueva), "entradas", "entrada-3.png"), "utf8")).toBe("foto-original");
    expect(JSON.parse(fs.readFileSync(path.join(dirC(nueva), "corrida.json"), "utf8")).textos).toEqual([{ nodo: "6", indice: 0, valor: "otro fondo" }]);
  });

  it("no reutiliza archivos de una corrida de otra receta", async () => {
    corrida("c-ajena", { workflow: "otra-receta" });
    fs.writeFileSync(path.join(dirC("c-ajena"), "entradas", "entrada-3.png"), "x");
    const { POST } = await import("@/app/api/workflows/[id]/route");
    const fd = new FormData();
    fd.set("reusar", "c-ajena");
    const r = await POST(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ id: "quitar-fondo" }) });
    expect(r.status).toBe(400);
    expect(encolados).toEqual([]);
  });
});
