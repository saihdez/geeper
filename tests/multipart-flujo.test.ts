/** SRV-01 (ronda 2): el formulario con archivos se recibe en flujo a un temporal, con el tope mirado al pasar. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recibirMultipart, type ReglaArchivo } from "@/lib/multipart-flujo";

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), "geeper-multipart-"));

/** Arma el cuerpo como lo manda el navegador y lo entrega en trozos de `trozo` bytes. */
async function pedido(fd: FormData, trozo = 7, contarLeidos?: { n: number }): Promise<Request> {
  const r = new Request("http://x/subir", { method: "POST", body: fd });
  const bytes = new Uint8Array(await r.arrayBuffer());
  let i = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + trozo));
      i += trozo;
      if (contarLeidos) contarLeidos.n = i;
    },
  });
  return new Request("http://x/subir", { method: "POST", body: cuerpo, headers: { "content-type": r.headers.get("content-type")! }, duplex: "half" } as RequestInit);
}

const todo: ReglaArchivo = () => ({ tope: 10 * 1024 ** 2, mensaje: "muy grande" });

describe("recibirMultipart", () => {
  it("campos y archivos, en trozos de cualquier tamaño: el archivo queda igual en disco con su sha256", async () => {
    const contenido = Buffer.alloc(300_000);
    for (let i = 0; i < contenido.length; i++) contenido[i] = (i * 31) % 256;
    // Un trozo del archivo que se parece al separador no lo corta.
    contenido.write("\r\n--no-es-el-limite", 1000);
    for (const trozo of [1, 13, 4096, 1 << 20]) {
      const dir = carpeta();
      const fd = new FormData();
      fd.set("escena", "e01");
      fd.set("texto", "ñandú «hola»\r\nsegunda línea");
      fd.set("archivo", new File([contenido], "Mi clip ñ.mp4"));
      const { campos, archivos } = await recibirMultipart(await pedido(fd, trozo), { dir, archivo: todo });
      expect(Object.fromEntries(campos)).toEqual({ escena: "e01", texto: "ñandú «hola»\r\nsegunda línea" });
      expect(archivos).toHaveLength(1);
      const a = archivos[0]!;
      expect({ campo: a.campo, nombre: a.nombre, bytes: a.bytes }).toEqual({ campo: "archivo", nombre: "Mi clip ñ.mp4", bytes: contenido.length });
      expect(path.dirname(a.ruta)).toBe(dir);
      expect(fs.readFileSync(a.ruta).equals(contenido)).toBe(true);
      expect(a.sha256).toBe(createHash("sha256").update(contenido).digest("hex"));
    }
  });

  it("corta al pasar el tope mientras llega, sin leer el resto, y no deja temporales", async () => {
    const dir = carpeta();
    const fd = new FormData();
    fd.set("archivo", new File([Buffer.alloc(5 * 1024 ** 2)], "grande.mp4"));
    const leidos = { n: 0 };
    const regla: ReglaArchivo = () => ({ tope: 64 * 1024, mensaje: "El archivo pasa de 64 KB" });
    await expect(recibirMultipart(await pedido(fd, 16 * 1024, leidos), { dir, archivo: regla })).rejects.toThrow("El archivo pasa de 64 KB");
    expect(leidos.n).toBeLessThan(200 * 1024);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("la regla decide antes de escribir: descarta o rechaza por el nombre", async () => {
    const dir = carpeta();
    const fd = new FormData();
    fd.set("otro", new File(["x"], "nada.bin"));
    fd.set("archivo", new File(["hola"], "clip.mp4"));
    const regla: ReglaArchivo = (campo) => (campo === "archivo" ? { tope: 100, mensaje: "" } : null);
    const { archivos } = await recibirMultipart(await pedido(fd), { dir, archivo: regla });
    expect(archivos.map((a) => a.campo)).toEqual(["archivo"]);
    expect(fs.readdirSync(dir)).toHaveLength(1);

    const fd2 = new FormData();
    fd2.set("archivo", new File(["x"], "virus.exe"));
    const rechazar: ReglaArchivo = (_c, nombre) => {
      throw new Error(`Formato no admitido: ${path.extname(nombre)}`);
    };
    const dir2 = carpeta();
    await expect(recibirMultipart(await pedido(fd2), { dir: dir2, archivo: rechazar })).rejects.toThrow("Formato no admitido: .exe");
    expect(fs.readdirSync(dir2)).toEqual([]);
  });

  it("una subida cortada a la mitad falla con un mensaje claro y borra lo escrito", async () => {
    const dir = carpeta();
    const fd = new FormData();
    fd.set("archivo", new File([Buffer.alloc(50_000, 1)], "clip.mp4"));
    const r = new Request("http://x", { method: "POST", body: fd });
    const bytes = new Uint8Array(await r.arrayBuffer()).slice(0, 30_000);
    const cortado = new Request("http://x", { method: "POST", body: bytes, headers: { "content-type": r.headers.get("content-type")! } });
    await expect(recibirMultipart(cortado, { dir, archivo: todo })).rejects.toThrow(/se cortó/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("sin formulario: lo dice", async () => {
    const r = new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    await expect(recibirMultipart(r, { dir: carpeta(), archivo: todo })).rejects.toThrow(/formulario/);
  });
});
