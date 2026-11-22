import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assetsConFondo, compilar } from "@/lib/compilador";
import { pista, validarProyecto, type Proyecto } from "@/lib/esquema";
import { filtroFondo, prepararFondos } from "@/lib/fondos";
import { metricas } from "@/lib/formatos";
import { opcionesDe } from "@/lib/linea";
import { probar } from "@/lib/media";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { correr } from "@/lib/proceso";
import { FFMPEG } from "@/lib/rutas";
import { proyectoDePrueba } from "./fixtures";

const plantilla = PLANTILLAS_INICIALES[0]!.datos;
const h = "c".repeat(64);

/** Proyecto vertical (9:16) con un clip horizontal: va «contenido», con fondo borroso detrás. */
function horizontalEnVertical(): Proyecto {
  const p = proyectoDePrueba();
  p.assets = {
    ...p.assets,
    tramo: { id: "tramo", tipo: "video", ruta: "assets/tramo.mp4", hash: h, source: "archivo", licencia: "revisar: x", duracion: 11, ancho: 1920, alto: 1080, regenerar: {} },
  };
  for (const c of pista(p, "visual").clips) c.asset = "tramo";
  return validarProyecto(p);
}

describe("REN-09: fondo borroso horneado", () => {
  it("sin fondos horneados, el desenfoque sigue en CSS sobre el mismo clip", () => {
    const c = compilar(horizontalEnVertical(), plantilla, "/tmp/m.wav", "/tmp/p");
    expect(c.html).toMatch(/<video id="b-e01-0" class="clip fondo desenfoque" src="assets\/tramo\.mp4"/);
  });

  it("con el fondo horneado, la pieza b-… usa ese archivo y Chrome no aplica el filtro", () => {
    const fondo = "/tmp/p/assets/fondo/tramo-abc.mp4";
    const c = compilar(horizontalEnVertical(), plantilla, "/tmp/m.wav", "/tmp/p", {}, { tramo: fondo });
    expect(c.html).toMatch(/<video id="b-e01-0" class="clip fondo desenfoque horneado" src="assets\/tramo-fondo\.mp4"/);
    expect(c.html).toContain(".fondo.desenfoque.horneado { filter: none; }");
    expect(c.archivos["assets/tramo-fondo.mp4"]).toBe(fondo);
    // El clip nítido de adelante no cambia.
    expect(c.html).toMatch(/<video id="v-e01-0" class="clip fondo contener" src="assets\/tramo\.mp4"/);
  });

  it("sólo pide fondo para los clips que van contenidos", () => {
    const p = horizontalEnVertical();
    const { W, H } = metricas(p.formato, opcionesDe(p));
    expect(assetsConFondo(p, W, H).map((a) => a.id)).toEqual(["tramo"]);
    expect(assetsConFondo(p, H, W)).toEqual([]); // en 16:9 el mismo clip cubre
  });

  it("el filtro desenfoca a un cuarto del tamaño, con el mismo blur y brillo que el CSS", () => {
    const f = filtroFondo(1080, 1920);
    expect(f).toContain("scale=270:480:force_original_aspect_ratio=increase");
    expect(f).toContain("crop=270:480");
    expect(f).toContain("gblur=sigma=10");
    expect(f).toContain("colorchannelmixer=rr=0.55:gg=0.55:bb=0.55");
  });

  it("hornea con ffmpeg (CPU) a tamaño reducido, sin sonido, y la segunda vez lo reutiliza", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-fondo-"));
    try {
      await fs.mkdir(path.join(dir, "assets"));
      await correr(FFMPEG, ["-hide_banner", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x180:d=0.5:r=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "assets", "tramo.mp4")]);
      const p = horizontalEnVertical();
      const fondos = await prepararFondos(p, dir, {}, 1080, 1920);
      const ruta = fondos.tramo!;
      expect(path.relative(dir, ruta)).toMatch(/^assets[/\\]fondo[/\\]tramo-[0-9a-f]{12}\.mp4$/);
      const info = await probar(ruta);
      expect([Number(info.video?.width), Number(info.video?.height)]).toEqual([270, 480]);
      expect(info.audio ?? null).toBeNull();
      const antes = (await fs.stat(ruta)).mtimeMs;
      expect(await prepararFondos(p, dir, {}, 1080, 1920)).toEqual(fondos);
      expect((await fs.stat(ruta)).mtimeMs).toBe(antes);
      // Apagado: vuelve al desenfoque de CSS.
      expect(await prepararFondos(p, dir, {}, 1080, 1920, undefined, { GEEPER_FONDO_HORNEADO: "0" })).toEqual({});
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("si ffmpeg no puede con el clip, ese clip sigue con el desenfoque de CSS", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-fondo-"));
    try {
      const avisos: string[] = [];
      const log = (m: string) => void avisos.push(m);
      expect(await prepararFondos(horizontalEnVertical(), dir, {}, 1080, 1920, log)).toEqual({});
      expect(avisos.join("\n")).toContain("queda el de CSS");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
