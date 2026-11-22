import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-archivos-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "geeper.db");

type Ruta = typeof import("@/app/api/archivos/[...ruta]/route");
let GET: Ruta["GET"];

function escribir(rel: string, contenido = "hola") {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenido);
}

const pedir = (rel: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/archivos/${rel}`, { headers }), { params: Promise.resolve({ ruta: rel.split("/") }) });

beforeAll(async () => {
  escribir("mi-video-abc123/geeper.json", "{}");
  escribir("mi-video-abc123/renders/v1.mp4", "0123456789");
  escribir("mi-video-abc123/build/vista-1/index.html", "<p>vista</p>");
  escribir("portadas/muestras/x/a.jpg");
  escribir("geeper.db");
  escribir("geeper.db-wal");
  escribir("geeper.db.respaldo-antes-m5");
  escribir("claves/prueba.txt");
  escribir("respaldos/geeper-2026-11-20.db");
  escribir("modelos.json");
  escribir("modelos/yunet.onnx");
  escribir("sin-proyecto/algo.txt");
  escribir("mi-video-abc123/.oculto/x.txt");
  escribir("mi-video-abc123/copia.db-shm");
  escribir("mi-video-abc123/llave.pem");
  GET = (await import("@/app/api/archivos/[...ruta]/route")).GET;
});

describe("/api/archivos sólo sirve proyectos y medios (SEG-01)", () => {
  it.each(["mi-video-abc123/renders/v1.mp4", "mi-video-abc123/build/vista-1/index.html", "portadas/muestras/x/a.jpg"])("sirve %s", async (rel) => {
    expect((await pedir(rel)).status).toBe(200);
  });

  it.each([
    "geeper.db",
    "geeper.db-wal",
    "geeper.db.respaldo-antes-m5",
    "claves/prueba.txt",
    "respaldos/geeper-2026-11-20.db",
    "modelos.json",
    "modelos/yunet.onnx",
    "sin-proyecto/algo.txt",
    "mi-video-abc123/.oculto/x.txt",
    "mi-video-abc123/copia.db-shm",
    "mi-video-abc123/llave.pem",
    "CLAVES/prueba.txt",
  ])("niega %s", async (rel) => {
    expect((await pedir(rel)).status).toBe(403);
  });

  it("no sale de la carpeta de datos", async () => {
    expect((await pedir("../etc/passwd")).status).toBe(400);
  });
});
