/** UX-33: «Liberar espacio» mide, guarda lo que hay que guardar y sólo borra con confirmación. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesLegibles, preguntaBorrar } from "@/components/liberar-espacio";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-espacio-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");

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
