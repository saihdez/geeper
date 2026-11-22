import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** WEB-07: miniaturas y apps Craft contestan 304 cuando el navegador ya tiene el archivo. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-etag-"));
process.env.GEEPER_DATA = path.join(dir, "datos");
process.env.GEEPER_HERRAMIENTAS = path.join(dir, "herramientas");

type Mini = typeof import("@/app/api/miniatura/route");
type Craft = typeof import("@/app/craft/[app]/[...ruta]/route");
let mini: Mini["GET"];
let craft: Craft["GET"];
let hayFfmpeg = false;

const proyecto = path.join(dir, "datos", "mi-video");
const pedirMini = (ruta: string, headers: Record<string, string> = {}) =>
  mini(new Request(`http://localhost/api/miniatura?p=mi-video&ruta=${encodeURIComponent(ruta)}&t=0.5`, { headers }));
const pedirCraft = (ruta: string, headers: Record<string, string> = {}) =>
  craft(new Request(`http://localhost/craft/photocraft/${ruta}`, { headers }), { params: Promise.resolve({ app: "photocraft", ruta: ruta.split("/") }) });

beforeAll(async () => {
  fs.mkdirSync(path.join(proyecto, "assets"), { recursive: true });
  fs.writeFileSync(path.join(proyecto, "assets", "foto.png"), "png falso");
  const web = path.join(dir, "herramientas", "photocraft-web", "actual");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), "<p>hola</p>");
  const { FFMPEG } = await import("@/lib/rutas");
  hayFfmpeg = fs.existsSync(FFMPEG);
  if (hayFfmpeg) {
    execFileSync(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30:duration=1", "-pix_fmt", "yuv420p", path.join(proyecto, "assets", "clip.mp4")]);
  }
  mini = (await import("@/app/api/miniatura/route")).GET;
  craft = (await import("@/app/craft/[app]/[...ruta]/route")).GET;
}, 60_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("miniatura", () => {
  it("una imagen sale con su tipo, ETag y no-cache; con If-None-Match da 304", async () => {
    const r = await pedirMini("assets/foto.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    const etag = r.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    const r2 = await pedirMini("assets/foto.png", { "if-none-match": etag });
    expect(r2.status).toBe(304);
    expect(await r2.text()).toBe("");
    expect(r2.headers.get("etag")).toBe(etag);
  });

  it("un archivo cambiado se vuelve a mandar entero", async () => {
    const etag = (await pedirMini("assets/foto.png")).headers.get("etag")!;
    fs.writeFileSync(path.join(proyecto, "assets", "foto.png"), "otro png falso, más largo");
    expect((await pedirMini("assets/foto.png", { "if-none-match": etag })).status).toBe(200);
  });

  it("la miniatura de un video se escribe sin dejar temporales y después da 304", async () => {
    if (!hayFfmpeg) return;
    expect(fs.existsSync(path.join(proyecto, "assets", "clip.mp4"))).toBe(true);
    const r = await pedirMini("assets/clip.mp4");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("max-age=3600");
    expect(fs.readdirSync(path.join(proyecto, "assets", "miniaturas"))).toEqual(["clip-0.5.jpg"]);
    expect((await pedirMini("assets/clip.mp4", { "if-none-match": r.headers.get("etag")! })).status).toBe(304);
  }, 30_000);
});

describe("apps Craft", () => {
  it("index.html lleva ETag y no-cache, y contesta 304 si no cambió", async () => {
    const r = await pedirCraft("index.html");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(r.headers.get("content-length")).toBe("11");
    const etag = r.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(r.headers.get("last-modified")).toBeTruthy();
    const r2 = await pedirCraft("index.html", { "if-none-match": etag });
    expect(r2.status).toBe(304);
    expect(r2.headers.get("content-type")).toContain("text/html");
    expect((await pedirCraft("index.html", { "if-none-match": '"otro"' })).status).toBe(200);
  });
});
