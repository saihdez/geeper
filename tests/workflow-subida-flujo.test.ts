/** SRV-01 (ronda 2): las entradas de un workflow llegan en flujo a la carpeta de la corrida. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-wf-flujo-"));
process.env.GEEPER_DATA = dir;

const encolados: { tipo: string; payload: { corrida: string; pedido: { archivos: unknown[]; textos: unknown[] } } }[] = [];
const WF = { id: "reshoot", titulo: "Rehacer la toma", local: true, complementos: [] as string[], entradas: [{ nodo: 3, medio: "image" }, { nodo: 9, medio: "video" }], miniaturas: [] };
vi.mock("@/lib/comfyui", async (original) => ({ ...(await original<typeof import("@/lib/comfyui")>()), leerCatalogo: async () => ({ workflows: [WF] }) }));
vi.mock("@/lib/instalar-comfyui", () => ({ revisarComfyui: () => ({ falta: false }) }));
vi.mock("@/lib/nodos-comfy", () => ({ infoNodos: async () => [], permitirNodos: async () => {} }));
vi.mock("@/lib/cola", () => ({ encolar: async (_p: null, tipo: string, payload: never) => (encolados.push({ tipo, payload }), { id: "t1" }) }));

const ctx = { params: Promise.resolve({ id: "reshoot" }) };

beforeEach(() => {
  encolados.length = 0;
});

describe("POST /api/workflows/[id] en flujo (SRV-01)", () => {
  it("guarda cada entrada como entrada-<nodo>.<ext> y encola la corrida", async () => {
    const { POST } = await import("@/app/api/workflows/[id]/route");
    const fd = new FormData();
    fd.set("textos", JSON.stringify([{ nodo: "6", indice: 0, valor: "un perro" }]));
    fd.set("archivo-3", new File([Buffer.alloc(70_000, 3)], "Foto.PNG"));
    fd.set("archivo-99", new File(["no es de ninguna entrada"], "x.png"));
    const r = await POST(new Request("http://x", { method: "POST", body: fd }), ctx);
    expect(r.status).toBe(201);
    expect(encolados[0]!.payload.pedido).toMatchObject({ archivos: [{ nodo: 3, nombre: "entrada-3.png" }], textos: [{ nodo: "6", valor: "un perro" }] });
    // Sólo queda la entrada usada: ni el archivo de un nodo que no existe ni temporales.
    const donde = buscar(dir, "entrada-3.png");
    expect(donde).not.toBeNull();
    expect(fs.statSync(donde!).size).toBe(70_000);
    expect(fs.readdirSync(path.dirname(donde!))).toEqual(["entrada-3.png"]);
  });

  it("un archivo que no sirve para la entrada: error claro y no queda la carpeta de la corrida", async () => {
    const { POST } = await import("@/app/api/workflows/[id]/route");
    const antes = todas(dir).length;
    const fd = new FormData();
    fd.set("archivo-9", new File(["x"], "foto.png"));
    const r = await POST(new Request("http://x", { method: "POST", body: fd }), ctx);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Ese archivo no sirve aquí: hace falta un video.");
    expect(todas(dir).length).toBe(antes);
    expect(encolados).toEqual([]);
  });
});

function todas(raiz: string): string[] {
  return fs.readdirSync(raiz, { recursive: true, withFileTypes: true }).map((e) => path.join(e.parentPath, e.name));
}

function buscar(raiz: string, nombre: string): string | null {
  return todas(raiz).find((r) => path.basename(r) === nombre) ?? null;
}
