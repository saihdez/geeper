import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estadoRespaldo, fechaDe, respaldar, respaldarSiToca } from "@/lib/respaldo";

function preparar() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-respaldo-"));
  const datos = path.join(raiz, "datos");
  const destino = path.join(raiz, "otro-disco");
  fs.mkdirSync(path.join(datos, "mi-video", "renders"), { recursive: true });
  fs.mkdirSync(path.join(datos, "claves"), { recursive: true });
  fs.mkdirSync(path.join(datos, "modelos"), { recursive: true });
  fs.writeFileSync(path.join(datos, "mi-video", "geeper.json"), "{}");
  fs.writeFileSync(path.join(datos, "mi-video", "renders", "v1.mp4"), "video");
  fs.writeFileSync(path.join(datos, "claves", "redes.key"), "secreto");
  fs.writeFileSync(path.join(datos, "modelos", "yunet.onnx"), "modelo");
  fs.writeFileSync(path.join(datos, ".temporal"), "x");
  const base = path.join(datos, "geeper.db");
  const con = new Database(base);
  con.pragma("journal_mode = WAL");
  con.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('uno');");
  return { raiz, datos, destino, base, con };
}

const dia = (n: number) => new Date(2026, 10, n, 12, 0, 0);

describe("respaldo diario (SEG-03)", () => {
  it("copia la base con VACUUM INTO aunque esté abierta en WAL, y la carpeta al otro disco sin claves ni modelos", async () => {
    const { datos, destino, base, con } = preparar();
    con.exec("INSERT INTO t VALUES ('dos');"); // queda en el WAL, sin checkpoint
    const r = await respaldar({ datos, baseDatos: base, destino, ahora: dia(20) });
    con.close();
    expect(r.error).toBeNull();
    expect(r.base).toBe(path.join(datos, "respaldos", "geeper-2026-11-20.db"));
    const copiaBase = new Database(r.base, { readonly: true });
    expect(copiaBase.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    copiaBase.close();
    const copia = path.join(destino, "geeper-2026-11-20");
    expect(r.copia?.ruta).toBe(copia);
    expect(fs.readFileSync(path.join(copia, "mi-video", "renders", "v1.mp4"), "utf8")).toBe("video");
    expect(fs.existsSync(path.join(copia, "geeper.db"))).toBe(true);
    expect(fs.existsSync(path.join(copia, "geeper.db-wal"))).toBe(false);
    expect(fs.existsSync(path.join(copia, "claves"))).toBe(false);
    expect(fs.existsSync(path.join(copia, "modelos"))).toBe(false);
    expect(fs.existsSync(path.join(copia, "respaldos"))).toBe(false);
    expect(fs.existsSync(path.join(copia, ".temporal"))).toBe(false);
  });

  it("conserva 7 copias y lo que no cambió se enlaza en vez de copiarse", async () => {
    const { datos, destino, base, con } = preparar();
    con.close();
    let ultimo;
    for (let d = 1; d <= 9; d++) ultimo = await respaldar({ datos, baseDatos: base, destino, ahora: dia(d) });
    expect(fs.readdirSync(path.join(datos, "respaldos")).filter((n) => n.endsWith(".db")).sort()).toEqual(
      [3, 4, 5, 6, 7, 8, 9].map((d) => `geeper-${fechaDe(dia(d))}.db`),
    );
    expect(fs.readdirSync(destino).sort()).toEqual([3, 4, 5, 6, 7, 8, 9].map((d) => `geeper-${fechaDe(dia(d))}`));
    expect(ultimo!.copia!.enlazados).toBeGreaterThan(0);
    const a = fs.statSync(path.join(destino, "geeper-2026-11-08", "mi-video", "renders", "v1.mp4"));
    const b = fs.statSync(path.join(destino, "geeper-2026-11-09", "mi-video", "renders", "v1.mp4"));
    expect(a.ino).toBe(b.ino);
  });

  it("si el otro disco no está, respalda la base igual y avisa", async () => {
    const { datos, base, raiz, con } = preparar();
    con.close();
    const archivo = path.join(raiz, "no-es-carpeta");
    fs.writeFileSync(archivo, "x");
    const r = await respaldar({ datos, baseDatos: base, destino: path.join(archivo, "dentro"), ahora: dia(20) });
    expect(fs.existsSync(r.base)).toBe(true);
    expect(r.copia).toBeNull();
    expect(r.error).toMatch(/No se pudo copiar/);
    expect((await estadoRespaldo(datos, dia(20))).aviso).toMatch(/no llegó/);
  });

  it("respaldarSiToca: una vez por día, y avisa si el último tiene más de 2 días", async () => {
    const { datos, base, destino, con } = preparar();
    con.close();
    expect((await estadoRespaldo(datos, dia(1))).aviso).toMatch(/Todavía no/);
    expect(await respaldarSiToca({ datos, baseDatos: base, destino, ahora: dia(1) })).not.toBeNull();
    expect(await respaldarSiToca({ datos, baseDatos: base, destino, ahora: new Date(2026, 10, 1, 20) })).toBeNull();
    expect((await estadoRespaldo(datos, dia(2))).aviso).toBeNull();
    expect((await estadoRespaldo(datos, dia(5))).aviso).toMatch(/hace 4 días/);
    expect(await respaldarSiToca({ datos, baseDatos: base, destino, ahora: dia(2) })).not.toBeNull();
  });
});
