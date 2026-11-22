/** UX-33: «Liberar espacio» mide, guarda lo que hay que guardar y sólo borra con confirmación. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesLegibles, preguntaBorrar } from "@/components/liberar-espacio";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-espacio-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_COMFYUI = path.join(dir, "comfy");

type Mod = typeof import("@/lib/liberar-espacio");
let m: Mod;
let db: typeof import("@/lib/db")["db"];
let dirProyecto: typeof import("@/lib/rutas")["dirProyecto"];
let dirPapelera: () => string;

const AHORA = new Date("2026-11-22T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  m = await import("@/lib/liberar-espacio");
  db = (await import("@/lib/db")).db;
  dirProyecto = (await import("@/lib/rutas")).dirProyecto;
  dirPapelera = (await import("@/lib/eliminar-proyecto")).dirPapelera;
}, 60_000);

function escribir(ruta: string, bytes: number, mtime?: Date) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, Buffer.alloc(bytes));
  if (mtime) fs.utimesSync(ruta, mtime, mtime);
}

async function proyecto(id: string) {
  await db.proyecto.create({ data: { id, slug: id, nombre: `Video ${id}`, tema: "t", formato: "9:16", plantilla: "x" } });
  return dirProyecto(id);
}

async function render(proyectoId: string, n: number, estado: string, dias: number, perfil = "shorts-9x16") {
  const d = dirProyecto(proyectoId);
  escribir(path.join(d, "renders", `v${n}-${perfil}.mp4`), 1000);
  escribir(path.join(d, "renders", `v${n}-${perfil}.srt`), 10);
  escribir(path.join(d, "renders", `v${n}-${perfil}.qc.json`), 10);
  escribir(path.join(d, "renders", `v${n}-${perfil}-hoja`, "hoja.jpg"), 60);
  escribir(path.join(d, "renders", `v${n}-${perfil}-hoja`, "01.jpg"), 40);
  return db.render.create({ data: { proyectoId, versionNumero: n, perfil, ruta: `renders/v${n}-${perfil}.mp4`, estado, creado: hace(dias) } });
}

describe("qué renders se pueden borrar (UX-33)", () => {
  const r = (id: string, perfil: string, estado: string, dias: number, ruta = `renders/${id}.mp4`) => ({ id, perfil, ruta, estado, creado: hace(dias) });

  it("guarda el último y el último aprobado de cada formato, lo publicado y lo de menos de 30 días", () => {
    const filas = [
      r("a1", "9x16", "aprobado", 90), r("a2", "9x16", "aprobado", 80), r("a3", "9x16", "rechazado", 70),
      r("a4", "9x16", "rechazado", 60), r("a5", "9x16", "rechazado", 5),
      r("b1", "16x9", "rechazado", 100), r("b2", "16x9", "aprobado", 50),
      r("p1", "9x16", "rechazado", 200),
    ];
    const ids = m.rendersBorrables(filas, new Set(["p1"]), AHORA).map((x) => x.id).sort();
    // a5 último y reciente; a2 último aprobado; b2 último y aprobado; p1 publicado.
    expect(ids).toEqual(["a1", "a3", "a4", "b1"]);
  });

  it("no borra un render viejo que comparte archivo con uno que se guarda", () => {
    const filas = [r("v", "9x16", "rechazado", 60, "renders/v3.mp4"), r("n", "9x16", "aprobado", 50, "renders/v3.mp4")];
    expect(m.rendersBorrables(filas, new Set(), AHORA)).toEqual([]);
  });

  it("lee la fecha de entrada a la papelera de su nombre", () => {
    expect(m.fechaEnPapelera("mi-video-2026-10-01-03-04-05", new Date(0)).toISOString()).toBe("2026-10-01T03:04:05.000Z");
    expect(m.fechaEnPapelera("otra-cosa", new Date(5)).getTime()).toBe(5);
  });
});

describe("liberar espacio en disco (UX-33)", () => {
  it("mide sin borrar nada, y sin confirmación no borra", async () => {
    const d = await proyecto("medir");
    await render("medir", 1, "rechazado", 60);
    await render("medir", 2, "aprobado", 40);
    escribir(path.join(d, "build", "crudo-shorts-9x16.mp4"), 5000, hace(45));
    escribir(path.join(dirPapelera(), "viejo-2026-09-01-00-00-00", "geeper.json"), 300);
    escribir(path.join(dirPapelera(), "nuevo-2026-11-20-00-00-00", "geeper.json"), 200);

    const e = await m.medirEspacio(AHORA);
    const p = e.proyectos.find((x) => x.id === "medir")!;
    expect(p.crudos).toBe(5000);
    expect(p.videos).toBe(2 * 1120);
    expect(e.borrable.renders).toEqual({ cuantos: 1, bytes: 1120 });
    expect(e.borrable.crudos).toEqual({ cuantos: 1, bytes: 5000 });
    expect(e.borrable.papelera).toEqual({ cuantos: 1, bytes: 300 });
    expect(e.papelera.total).toBe(500);

    await expect(m.liberar("renders", false, AHORA)).rejects.toThrow(/confirmes/);
    expect(fs.existsSync(path.join(d, "renders", "v1-shorts-9x16.mp4"))).toBe(true);
    expect(await db.render.count({ where: { proyectoId: "medir" } })).toBe(2);
  });

  it("con confirmación borra los videos viejos (archivos y fila) y deja el último", async () => {
    const d = dirProyecto("medir");
    const r = await m.liberar("renders", true, AHORA);
    expect(r).toEqual({ cuantos: 1, bytes: 1120 });
    expect(fs.readdirSync(path.join(d, "renders")).sort()).toEqual(["v2-shorts-9x16-hoja", "v2-shorts-9x16.mp4", "v2-shorts-9x16.qc.json", "v2-shorts-9x16.srt"]);
    expect((await db.render.findMany({ where: { proyectoId: "medir" } })).map((x) => x.versionNumero)).toEqual([2]);
  });

  it("borra los crudos viejos y de la papelera sólo lo de más de 30 días", async () => {
    expect((await m.liberar("crudos", true, AHORA)).cuantos).toBe(1);
    expect(fs.existsSync(path.join(dirProyecto("medir"), "build", "crudo-shorts-9x16.mp4"))).toBe(false);
    expect((await m.liberar("papelera", true, AHORA)).cuantos).toBe(1);
    expect(fs.readdirSync(dirPapelera())).toEqual(["nuevo-2026-11-20-00-00-00"]);
  });

  it.skipIf(process.getuid?.() === 0)("borra la fila antes que los archivos: si un archivo no se puede borrar, no queda un video roto en la lista", async () => {
    const d = await proyecto("roto");
    await render("roto", 1, "rechazado", 60);
    await render("roto", 2, "aprobado", 40);
    const carpeta = path.join(d, "renders");
    fs.chmodSync(carpeta, 0o555); // no se puede borrar nada adentro
    try {
      const r = await m.liberar("renders", true, AHORA);
      expect(r.cuantos).toBe(1);
      expect((await db.render.findMany({ where: { proyectoId: "roto" } })).map((x) => x.versionNumero)).toEqual([2]);
    } finally {
      fs.chmodSync(carpeta, 0o755);
    }
  });

  it("no toca un proyecto con un trabajo en curso", async () => {
    const d = await proyecto("ocupado");
    await render("ocupado", 1, "rechazado", 60);
    await render("ocupado", 2, "aprobado", 40);
    escribir(path.join(d, "build", "crudo-shorts-9x16.mp4"), 10, hace(45));
    await db.trabajo.create({ data: { proyectoId: "ocupado", tipo: "render.entregar", motor: "render", estado: "corriendo", payload: {} } });
    expect((await m.liberar("renders", true, AHORA)).cuantos).toBe(0);
    expect((await m.liberar("crudos", true, AHORA)).cuantos).toBe(0);
    expect(fs.existsSync(path.join(d, "renders", "v1-shorts-9x16.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(d, "build", "crudo-shorts-9x16.mp4"))).toBe(true);
  });
});

describe("videos largos y copias repetidas de la IA (DSC-11)", () => {
  function texto(ruta: string, contenido: string, dias: number) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, contenido);
    fs.utimesSync(ruta, hace(dias), hace(dias));
  }
  const fuentes = () => path.join(dir, "_fuentes");
  const subidos = () => path.join(dir, "_subidos");

  it("ofrece los videos para clips sin usar en 30 días y las subidas cortadas; nunca los que pide un trabajo", async () => {
    const { idFuente } = await import("@/lib/fuentes");
    // Bajado hace 40 días: se ofrece el video; la ficha y los momentos se quedan.
    texto(path.join(fuentes(), "aaaaaaaaaaaa", "info.json"), "{}", 40);
    texto(path.join(fuentes(), "aaaaaaaaaaaa", "fuente.mp4"), "vod-viejo", 40);
    texto(path.join(fuentes(), "aaaaaaaaaaaa", ".fuente.f137.mp4.part"), "parte", 3);
    // Bajado hace 40 días pero se buscaron momentos hace 2: se queda.
    texto(path.join(fuentes(), "bbbbbbbbbbbb", "fuente.mp4"), "vod-en-uso", 40);
    texto(path.join(fuentes(), "bbbbbbbbbbbb", "candidatos.json"), "{}", 2);
    // Subido hace 40 días: se ofrece. Otro igual de viejo, pero un trabajo en la fila lo pide: se queda.
    const subido = path.join(subidos(), "12345678-charla.mp4");
    texto(subido, "subido-viejo", 40);
    const pedido = path.join(subidos(), "87654321-otra.mp4");
    texto(pedido, "subido-pedido", 40);
    await db.trabajo.create({ data: { tipo: "clip.momentos", motor: "mpt", estado: "pendiente", payload: { src: pedido } } });
    // Subidas cortadas: la de hace 2 días se ofrece; la de recién, no (puede estar subiendo).
    texto(path.join(subidos(), ".subiendo-aaaa"), "x", 2);
    texto(path.join(subidos(), ".subiendo-bbbb"), "y", 0.01);

    const e = await m.medirEspacio(AHORA);
    expect(e.borrable.fuentes.cuantos).toBe(4);
    expect(e.borrable.fuentes.bytes).toBe("vod-viejo".length + "parte".length + "subido-viejo".length + 1);
    expect(fs.existsSync(subido)).toBe(true); // medir no borra
    expect(idFuente(pedido)).toMatch(/^[a-f0-9]{12}$/);

    await expect(m.liberar("fuentes", false, AHORA)).rejects.toThrow(/confirmes/);
    expect((await m.liberar("fuentes", true, AHORA)).cuantos).toBe(4);
    expect(fs.readdirSync(path.join(fuentes(), "aaaaaaaaaaaa"))).toEqual(["info.json"]);
    expect(fs.existsSync(path.join(fuentes(), "bbbbbbbbbbbb", "fuente.mp4"))).toBe(true);
    expect(fs.readdirSync(subidos()).sort()).toEqual([".subiendo-bbbb", "87654321-otra.mp4"]);
  });

  it("ofrece sólo las copias idénticas de lo que hizo la IA, no lo que no se copió", async () => {
    const d = await proyecto("ia");
    const h = (c: string) => createHash("sha256").update(c).digest("hex").slice(0, 12);
    // Wan2GP: el plano copiado a assets/wan-<huella>.mp4 es una copia; el que no se copió, no.
    texto(path.join(d, "build", "planos", "e01-2026", "salida.mp4"), "plano-1", 1);
    texto(path.join(d, "assets", `wan-${h("plano-1")}.mp4`), "plano-1", 1);
    texto(path.join(d, "build", "planos", "e02-2026", "salida.mp4"), "plano-2", 1);
    texto(path.join(d, "build", "planos", "e01-2026", "inicio.png"), "imagen-de-inicio", 1);
    // ComfyUI: lo de output/ que está igual en el resultado de su receta.
    const comfy = path.join(dir, "comfy", "output");
    texto(path.join(comfy, "ComfyUI_00001_.png"), "foto-1", 1);
    texto(path.join(comfy, "video", "ComfyUI_00002_.mp4"), "video-2", 1);
    texto(path.join(comfy, "ComfyUI_00003_.png"), "foto-3-distinta", 1);
    texto(path.join(comfy, "suelto.png"), "nadie-lo-copio", 1);
    const corrida = path.join(dir, "workflows", "receta-1");
    texto(path.join(corrida, "corrida.json"), "{}", 1);
    texto(path.join(corrida, "ComfyUI_00001_.png"), "foto-1", 1);
    texto(path.join(corrida, "ComfyUI_00002_.mp4"), "video-2", 1);
    texto(path.join(corrida, "ComfyUI_00003_.png"), "foto-3", 1);

    const e = await m.medirEspacio(AHORA);
    expect(e.borrable.copias).toEqual({ cuantos: 3, bytes: "plano-1".length + "foto-1".length + "video-2".length });
    expect((await m.liberar("copias", true, AHORA)).cuantos).toBe(3);
    expect(fs.existsSync(path.join(d, "build", "planos", "e01-2026", "salida.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(d, "build", "planos", "e01-2026", "inicio.png"))).toBe(true);
    expect(fs.existsSync(path.join(d, "build", "planos", "e02-2026", "salida.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(d, "assets", `wan-${h("plano-1")}.mp4`))).toBe(true);
    expect(fs.readdirSync(comfy).sort()).toEqual(["ComfyUI_00003_.png", "suelto.png", "video"]);
    expect(fs.readdirSync(corrida).sort()).toEqual(["ComfyUI_00001_.png", "ComfyUI_00002_.mp4", "ComfyUI_00003_.png", "corrida.json"]);
  });
});

describe("ruta /api/sistema/espacio (UX-33)", () => {
  it("sin «confirmo: true» no borra y responde 400", async () => {
    const { POST, GET } = await import("@/app/api/sistema/espacio/route");
    const r = await POST(new Request("http://x/api/sistema/espacio", { method: "POST", body: JSON.stringify({ que: "papelera" }) }));
    expect(r.status).toBe(400);
    expect(fs.readdirSync(dirPapelera())).toEqual(["nuevo-2026-11-20-00-00-00"]);
    expect((await GET()).status).toBe(200);
  });
});

describe("pantalla «Liberar espacio» (UX-33)", () => {
  it("pregunta con cuánto se borra y que no tiene vuelta atrás", () => {
    expect(preguntaBorrar("renders", 3, 1_400_000_000)).toBe("Vas a borrar 3 videos viejos (1,4 GB). Esto no se puede deshacer. ¿Seguir?");
    expect(preguntaBorrar("papelera", 1, 320_000_000)).toBe("Vas a borrar 1 video de la papelera (320 MB). Esto no se puede deshacer. ¿Seguir?");
    expect(bytesLegibles(12_000)).toBe("12 KB");
  });

  it("Sistema muestra «Liberar espacio»", () => {
    const s = fs.readFileSync(path.join(process.cwd(), "src", "components", "sistema.tsx"), "utf8");
    expect(s).toContain("<LiberarEspacio />");
  });
});
