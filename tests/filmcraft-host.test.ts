import { describe, expect, it } from "vitest";
import { nombreGuardado, otioParaFilmcraft } from "@/lib/filmcraft-host";
import { aOtio } from "@/lib/otio";
import { proyectoDePrueba } from "./fixtures";

type J = Record<string, unknown>;
const referencias = (x: unknown, out: J[] = []): J[] => {
  if (Array.isArray(x)) x.forEach((y) => referencias(y, out));
  else if (x && typeof x === "object") {
    if ((x as J).OTIO_SCHEMA === "ExternalReference.1") out.push(x as J);
    Object.values(x).forEach((y) => referencias(y, out));
  }
  return out;
};

describe("«Abrir en FilmCraft»: el .otio nombra cada medio sólo por su nombre", () => {
  it("cambia cada file:// por un nombre y dice qué archivo es cada uno (con la ruta absoluta FilmCraft web los deja offline)", () => {
    const p = proyectoDePrueba();
    const original = aOtio(p, "/datos/proyectos/demo");
    const { otio, medios } = otioParaFilmcraft(original);
    const refs = referencias(otio);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(String(r.target_url)).not.toMatch(/^file:|\//);
      expect(r.name).toBe(r.target_url);
      expect(medios.some((m) => m.nombre === r.target_url)).toBe(true);
    }
    for (const m of medios) expect(m.abs.startsWith("/datos/proyectos/demo/")).toBe(true);
    // El original no cambia.
    expect(referencias(original).every((r) => String(r.target_url).startsWith("file:///"))).toBe(true);
  });

  it("dos medios con el mismo nombre en carpetas distintas reciben nombres distintos; el mismo archivo, el mismo nombre", () => {
    const ref = (u: string) => ({ OTIO_SCHEMA: "ExternalReference.1", name: "x", target_url: u });
    const { otio, medios } = otioParaFilmcraft({ a: [ref("file:///p/escenas/clip.mp4"), ref("file:///p/broll/clip.mp4"), ref("file:///p/escenas/clip.mp4"), ref("file:///p/m%C3%BAsica%20uno.mp3")] });
    expect(referencias(otio).map((r) => r.target_url)).toEqual(["clip.mp4", "clip-2.mp4", "clip.mp4", "música uno.mp3"]);
    expect(medios).toEqual([
      { nombre: "clip.mp4", abs: "/p/escenas/clip.mp4" },
      { nombre: "clip-2.mp4", abs: "/p/broll/clip.mp4" },
      { nombre: "música uno.mp3", abs: "/p/música uno.mp3" },
    ]);
  });

  it("lo que FilmCraft manda a guardar no puede salir de editor/", () => {
    expect(nombreGuardado("../../etc/passwd")).toBe("passwd");
    expect(nombreGuardado("C:\\Windows\\x.fcproj")).toBe("x.fcproj");
    expect(nombreGuardado("..")).toBe("filmcraft");
    expect(nombreGuardado("Mi video final.mp4")).toBe("Mi video final.mp4");
    expect(nombreGuardado("a/b<c>.fcproj")).toBe("b_c_.fcproj");
  });
});
