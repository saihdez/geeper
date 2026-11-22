import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const casa = await fs.mkdtemp(path.join(os.tmpdir(), "instalar-craft-"));
vi.mock("@/lib/rutas", async (orig) => ({ ...(await orig<typeof import("@/lib/rutas")>()), ESTUDIO: casa }));
const { bajar, crearInstalador } = await import("@/lib/instalar-craft");

/** Un zip con <raiz>/index.html, como el de una versión web. */
async function zipWeb(raiz: string): Promise<Buffer> {
  return Buffer.from(zipSync({ [`${raiz}/index.html`]: new TextEncoder().encode(raiz) }));
}

function servir(archivos: Record<string, Buffer | string>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const nombre = url.split("/").pop()!;
    const d = archivos[nombre];
    return d === undefined ? new Response("no", { status: 404 }) : new Response(typeof d === "string" ? d : new Uint8Array(d));
  });
}

const sumas = (nombre: string, d: Buffer) => `${createHash("sha256").update(d).digest("hex")}  ${nombre}\n`;

async function esperar(i: ReturnType<typeof crearInstalador>) {
  i.iniciar();
  while (["descargando", "verificando", "descomprimiendo"].includes(i.estado().fase)) await new Promise((r) => setTimeout(r, 20));
  return i.estado();
}

describe("instalador de apps Craft", () => {
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => fs.rm(casa, { recursive: true, force: true }));

  const instalador = (version: string, sana: boolean) =>
    crearInstalador({
      app: "demo", version, archivo: `demo-web-${version}.zip`, carpeta: "demo-web", extraer: "zip", raiz: `demo-web-${version}`,
      verificar: async () => (sana ? `Demo ${version}` : null),
    });

  it("instala una versión y, si la siguiente no pasa la verificación, deja la anterior activa", async () => {
    const z1 = await zipWeb("demo-web-1.0.0");
    servir({ "SHA256SUMS.txt": sumas("demo-web-1.0.0.zip", z1), "demo-web-1.0.0.zip": z1 });
    expect(await esperar(instalador("1.0.0", true))).toMatchObject({ fase: "lista" });
    const actual = path.join(casa, "demo-web", "actual");
    expect(await fs.readFile(path.join(actual, "index.html"), "utf8")).toBe("demo-web-1.0.0");

    const z2 = await zipWeb("demo-web-2.0.0");
    servir({ "SHA256SUMS.txt": sumas("demo-web-2.0.0.zip", z2), "demo-web-2.0.0.zip": z2 });
    const e = await esperar(instalador("2.0.0", false));
    expect(e).toMatchObject({ fase: "error" });
    expect(e.detalle).toMatch(/se dejó la anterior/);
    expect(await fs.readFile(path.join(actual, "index.html"), "utf8")).toBe("demo-web-1.0.0");
  });

  it("no instala un archivo que no coincide con la suma oficial", async () => {
    const z = await zipWeb("demo-web-3.0.0");
    servir({ "SHA256SUMS.txt": sumas("demo-web-3.0.0.zip", Buffer.from("otro")), "demo-web-3.0.0.zip": z });
    const e = await esperar(instalador("3.0.0", true));
    expect(e).toMatchObject({ fase: "error" });
    expect(e.detalle).toMatch(/no coincide con la suma oficial/);
  });

  it("bajar reintenta los cortes de red y no reintenta un error de HTTP", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      if (n < 3) throw new TypeError("fetch failed");
      return new Response("hola");
    });
    expect(await (await bajar("https://x/y", 3, 1)).text()).toBe("hola");
    expect(n).toBe(3);
    n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response("no", { status: 404 });
    });
    expect((await bajar("https://x/y", 3, 1)).status).toBe(404);
    expect(n).toBe(1);
  });

  it("bajar avisa el avance por trozos mientras descarga (TER-03)", async () => {
    vi.stubGlobal("fetch", async () => {
      const trozos = [new Uint8Array(3_000_000), new Uint8Array(2_000_000)];
      const cuerpo = new ReadableStream<Uint8Array>({
        pull(c) {
          const t = trozos.shift();
          if (t) c.enqueue(t);
          else c.close();
        },
      });
      return new Response(cuerpo, { headers: { "content-length": "5000000" } });
    });
    const avances: [number, number][] = [];
    const r = await bajar("https://x/y", 3, 1, (b, t) => avances.push([b, t]));
    expect((await r.arrayBuffer()).byteLength).toBe(5_000_000);
    expect(avances[0]).toEqual([0, 5_000_000]);
    expect(avances.at(-1)).toEqual([5_000_000, 5_000_000]);
    expect(avances.length).toBeGreaterThanOrEqual(3);
    const { estadoDescarga } = await import("@/lib/instalar-craft");
    expect(estadoDescarga(40e6, 158e6)).toMatchObject({ progreso: 40 / 158, detalle: "Descargando 40 de 158 MB…" });
    expect(estadoDescarga(40e6, 0).detalle).toBe("Descargando 40 MB…");
  });
});

describe("carpeta raíz del archivo", () => {
  it("usa la esperada, la única carpeta de primer nivel o la raíz si los archivos vienen sueltos", async () => {
    const { carpetaRaiz } = await import("@/lib/instalar-craft");
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "raiz-"));
    // Como el zip de Windows de VectorCraft: todo dentro de una carpeta.
    await fs.mkdir(path.join(d, "a", "vectorcraft-0.24.1-windows-x64-portable"), { recursive: true });
    expect(await carpetaRaiz(path.join(d, "a"), "")).toBe("vectorcraft-0.24.1-windows-x64-portable");
    expect(await carpetaRaiz(path.join(d, "a"), "vectorcraft-0.24.1-windows-x64-portable")).toBe("vectorcraft-0.24.1-windows-x64-portable");
    // Como el de PhotoCraft: archivos sueltos.
    await fs.mkdir(path.join(d, "b"));
    await fs.writeFile(path.join(d, "b", "photocraft-cli.exe"), "");
    await fs.writeFile(path.join(d, "b", "LICENSE-MIT"), "");
    expect(await carpetaRaiz(path.join(d, "b"), "")).toBe("");
    expect(await carpetaRaiz(path.join(d, "b"), "photocraft-cli-0.23.1-macos-universal")).toBe("");
    await fs.rm(d, { recursive: true, force: true });
  });
});
