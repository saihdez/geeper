import { describe, expect, it } from "vitest";
import { capasFilmcraft, rgba } from "@/lib/filmcraft-capas";
import { manifiestoFilmcraft } from "@/lib/filmcraft-host";
import { graficosNativos } from "@/lib/filmcraft-proyecto";
import { validarProyecto, type Proyecto } from "@/lib/esquema";
import { metricas } from "@/lib/formatos";
import { opcionesDe } from "@/lib/linea";
import { cajaMarco } from "@/lib/marco";
import { aOtio } from "@/lib/otio";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { proyectoDePrueba } from "./fixtures";

type J = Record<string, unknown>;
const plantilla = PLANTILLAS_INICIALES[0]!.datos;
const h = "a".repeat(64);

function conTodo(): Proyecto {
  const p = proyectoDePrueba();
  return validarProyecto({
    ...p,
    textos: [
      { id: "t1", texto: "Un título", inicio: 0.5, duracion: 3, estilo: "titulo", posicion: "arriba" },
      { id: "t2", texto: "Un rótulo encima", inicio: 2, duracion: 2, estilo: "rotulo", posicion: "centro" },
      { id: "t3", texto: "Más tarde", inicio: 6, duracion: 1, estilo: "cita", posicion: "abajo" },
    ],
    assets: {
      ...p.assets,
      avatar: { id: "avatar", tipo: "video", ruta: "assets/avatar.mp4", hash: h, source: "wan", licencia: "x", duracion: 9, ancho: 480, alto: 640, regenerar: {} },
    },
    pistas: [
      ...p.pistas,
      { id: "presentador", tipo: "video", clips: [{ id: "pres", asset: "avatar", inicio: 0, rango: { inicio: 0, duracion: 9 }, marco: { forma: "circulo", esquina: "abajo-derecha", tamano: 0.3 } }] },
    ],
  });
}

const pistas = (o: J) => ((o.tracks as J).children as J[]);
const clips = (t: J) => (t.children as J[]).filter((c) => c.OTIO_SCHEMA === "Clip.2");
const efectos = (c: J) => ((c.metadata as J).filmcraft as { effects: { effect: string; params: Record<string, { value: J }>; masks?: J[]; layer?: { uid: number } }[] }).effects;
const valor = (e: { params: Record<string, { value: J }> }, k: string) => Object.values(e.params[k]!.value)[0];

describe("«Abrir en FilmCraft»: cada cosa del video como una pieza aparte", () => {
  const p = conTodo();
  const { otio, graficos, avisos } = capasFilmcraft(aOtio(p, "/datos/demo"), p, plantilla);

  it("agrega pistas de marca, textos (sin encimarse), subtítulos y tarjeta final encima de los medios", () => {
    const nombres = pistas(otio).map((t) => t.name);
    expect(nombres.slice(-5)).toEqual(["Marca", "Textos 1", "Textos 2", "Subtítulos", "Tarjeta final"]);
    // El título y el rótulo se pisan: van en pistas distintas; el tercero entra en la primera.
    const t1 = pistas(otio).find((t) => t.name === "Textos 1")!;
    expect(clips(t1).map((c) => c.name)).toEqual(["Texto: Un título", "Texto: Más tarde"]);
    const subs = clips(pistas(otio).find((t) => t.name === "Subtítulos")!);
    expect(subs.length).toBeGreaterThan(0);
    expect(graficos).toBe(1 + 3 + subs.length + 1);
    expect(avisos.join(" ")).toMatch(/Inter/);
  });

  it("cada gráfico es un «Transparent Video» del tamaño del cuadro, con transparencia y sus capas completas", () => {
    for (const t of pistas(otio).slice(-5)) {
      for (const c of clips(t)) {
        const ref = (c.media_references as J).DEFAULT_MEDIA as J;
        expect(ref.OTIO_SCHEMA).toBe("GeneratorReference.1");
        const fc = (ref.metadata as J).filmcraft as { generator: string; item: number; info: { video: { width: number; height: number; has_alpha: boolean } } };
        expect(fc.generator).toBe("TransparentVideo");
        expect(fc.info.video).toMatchObject({ width: 1080, height: 1920, has_alpha: true });
        const fx = efectos(c);
        expect(fx.slice(0, 3).map((e) => e.effect)).toEqual(["motion", "opacity", "time_remap"]);
        const capas = fx.filter((e) => e.effect.startsWith("graphic_"));
        expect(capas.length).toBeGreaterThan(0);
        for (const e of capas) {
          // FilmCraft descarta la lista entera si un parámetro no se puede leer: todos llevan su tipo.
          for (const v of Object.values(e.params)) expect(Object.keys(v.value)).toHaveLength(1);
          expect(e.layer?.uid).toBeGreaterThan(0);
          expect(valor(e, "fill_color")).toHaveLength(4);
        }
      }
    }
    // Ítems distintos en el proyecto de FilmCraft.
    const items = pistas(otio).slice(-5).flatMap(clips).map((c) => (((c.media_references as J).DEFAULT_MEDIA as J).metadata as { filmcraft: { item: number } }).filmcraft.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it("el texto de la marca y el botón de la tarjeta final son los de la plantilla", () => {
    const marca = efectos(clips(pistas(otio).find((t) => t.name === "Marca")!)[0]!).find((e) => e.effect === "graphic_text")!;
    expect(valor(marca, "text")).toBe(plantilla.marca.texto);
    const tarjeta = clips(pistas(otio).find((t) => t.name === "Tarjeta final")!)[0]!;
    const capas = efectos(tarjeta).filter((e) => e.effect.startsWith("graphic_"));
    expect(capas.map((e) => valor(e, "name"))).toEqual(["Fondo", "Título", "Botón"]);
    expect(valor(capas[2]!, "text")).toBe(plantilla.cta);
  });

  it("las escenas cubren el cuadro y la burbuja queda en su esquina con su máscara (ancla explícita)", () => {
    const escena = clips(pistas(otio).find((t) => t.name === "Visual")!)[0]!;
    const mo = efectos(escena)[0]!;
    expect(valor(mo, "anchor")).toEqual({ x: 540, y: 960 });
    expect(valor(mo, "position")).toEqual({ x: 540, y: 960 });
    expect(valor(mo, "scale")).toBe(100);

    const pres = clips(pistas(otio).find((t) => String(t.name).includes("presentador"))!)[0]!;
    const [motion, opacidad] = efectos(pres);
    const pos = valor(motion!, "position") as { x: number; y: number };
    const ancla = valor(motion!, "anchor") as { x: number; y: number };
    const s = (valor(motion!, "scale") as number) / 100;
    expect(ancla).toEqual({ x: 240, y: 320 });
    const verts = ((opacidad!.masks![0] as { path: { value: { Path: { vertices: { p: { x: number; y: number } }[] } } } }).path.value.Path.vertices).map((v) => v.p);
    const cx = (Math.min(...verts.map((v) => v.x)) + Math.max(...verts.map((v) => v.x))) / 2;
    const cy = (Math.min(...verts.map((v) => v.y)) + Math.max(...verts.map((v) => v.y))) / 2;
    const m = metricas(p.formato, opcionesDe(p));
    const caja = cajaMarco({ forma: "circulo", esquina: "abajo-derecha", tamano: 0.3 }, m);
    // El centro de la máscara cae en el centro de la caja de la burbuja, como en el render.
    expect(pos.x + (cx - ancla.x) * s).toBeCloseTo(caja.x + caja.w / 2, 1);
    expect(pos.y + (cy - ancla.y) * s).toBeCloseTo(caja.y + caja.h / 2, 1);
    // Y el diámetro de la máscara, escalado, es el de la caja.
    expect((Math.max(...verts.map((v) => v.x)) - Math.min(...verts.map((v) => v.x))) * s).toBeCloseTo(caja.w, 1);
  });

  it("no toca el .otio que recibe", () => {
    const original = aOtio(p, "/datos/demo");
    const copia = JSON.stringify(original);
    capasFilmcraft(original, p, plantilla);
    expect(JSON.stringify(original)).toBe(copia);
  });

  it("lee los colores de la plantilla", () => {
    expect(rgba("#ff0080")).toEqual([1, 0, 0.502, 1]);
    expect(rgba("#fff")).toEqual([1, 1, 1, 1]);
    expect(rgba("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(rgba("#00000080")[3]).toBeCloseTo(0.502, 3);
  });

  it("con la plantilla, los subtítulos van en la línea de tiempo y no se manda el .srt; sin ella, el .srt", async () => {
    const con = await manifiestoFilmcraft(p, "demo", "/no/existe", {}, plantilla);
    expect(con.manifiesto.srt).toBeNull();
    expect(con.manifiesto.graficos).toBe(graficos);
    const sin = await manifiestoFilmcraft(p, "demo", "/no/existe", {});
    expect(sin.manifiesto.srt).toMatch(/-->/);
    expect(sin.manifiesto.graficos).toBe(0);
  });
});

describe("segundo paso: los gráficos pasan a gráficos nativos de FilmCraft", () => {
  const info = (w: number, h: number) => ({ name: "x", duration: 1, video: { width: w, height: h, frame_rate: { num: 30, den: 1 } } });
  const proyecto = (extra: Record<string, J> = {}) => JSON.stringify({
    format: "filmcraft.project",
    project: {
      name: "Untitled",
      items: {
        "1": { id: 1, name: "avatar.mp4", kind: { Media: { media: { File: { path: "/files/avatar.mp4" } }, info: info(480, 640), identity: { size: 9 } } } },
        "2": { id: 2, kind: { Sequence: { video_tracks: [
          { name: "Marca", items: [{ item: 4, effects: [{ effect: "motion" }, { effect: "graphic_text" }] }] },
          { name: "Otro", items: [{ item: 5, effects: [{ effect: "motion" }] }] },
          { name: "Pres", items: [{ item: 3, effects: [{ effect: "motion" }] }] },
        ] } } },
        "3": { id: 3, name: "avatar.mp4", kind: { Media: { media: { File: { path: "/files/avatar.mp4" } }, info: info(1920, 1080) } } },
        "4": { id: 4, name: "Marca", label: "Lavender", kind: { Media: { media: { Generator: "TransparentVideo" }, info: info(1080, 1920) } } },
        "5": { id: 5, name: "Negro", kind: { Media: { media: { Generator: "TransparentVideo" }, info: info(1080, 1920) } } },
        ...extra,
      },
    },
  });

  it("sólo los que tienen capas pasan a «Graphic», del tamaño del cuadro; el proyecto toma el nombre de Geeper", () => {
    const r = graficosNativos(proyecto(), "Mi video");
    const d = JSON.parse(r.proyecto);
    expect(r.graficos).toBe(1);
    expect(d.project.name).toBe("Mi video");
    expect(d.project.items["4"].kind).toEqual({ Graphic: { width: 1080, height: 1920, rate: { num: 30, den: 1 } } });
    expect(d.project.items["5"].kind.Media).toBeDefined();
  });

  it("el medio que el .otio enlazó antes de que FilmCraft lo leyera toma los datos del ya leído", () => {
    const r = graficosNativos(proyecto(), "x");
    const d = JSON.parse(r.proyecto);
    expect(d.project.items["3"].kind.Media.info.video.width).toBe(480);
    expect(d.project.items["3"].kind.Media.identity).toEqual({ size: 9 });
    expect(r.sinLeer).toBe(0);
    // Sin un ítem ya leído del mismo archivo, se avisa para volver a intentar.
    const otro = graficosNativos(proyecto({ "6": { id: 6, kind: { Media: { media: { File: { path: "/files/otro.mp4" } }, info: info(1920, 1080) } } } }), "x");
    expect(otro.sinLeer).toBe(1);
  });

  it("si FilmCraft devuelve otra cosa, falla con un mensaje", () => {
    expect(() => graficosNativos("{}", "x")).toThrow(/FilmCraft/);
  });
});
