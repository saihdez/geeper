/** La invitación como diseño de Avnac Studio: el formato «v2» que su «Import» acepta (avnac.ts). */
import { describe, expect, it } from "vitest";
import { ALTO, ANCHO, disenoAvnac, nombreArchivoAvnac, type ObjetoAvnac } from "@/lib/invitaciones/avnac";
import { basesDe } from "@/lib/invitaciones/compilar";
import { Entrada, Invitacion } from "@/lib/invitaciones/esquema";

const base = {
  tipo: "xv" as const, nombres: "Mariangel Campos Porras", fecha: "2030-02-20", hora: "12:00", zona: "America/Costa_Rica",
  lugar: { nombre: "Alajuela", direccion: "Salón Los Robles" }, whatsapp: "50688887777", regalos: "Lluvia de sobres", hashtag: "MariXV",
  dressCode: { estilo: "Formal", colores: ["#1f3d2b", "#c9a227"], evitar: undefined },
};

function inv(x: Record<string, unknown> = {}) {
  const { musicaEnlace: _m, plantilla: _p, ...resto } = Entrada.parse(base);
  return Invitacion.parse({ ...resto, version: 1, slug: "xv-prueba-abc123", creada: "x", actualizada: "x", plantilla: "jardin", musica: { tipo: "ninguna" }, ...x });
}

/** Las mismas condiciones que revisa Avnac 0.4.1 al importar (parseV2WorkspaceImport y fromAvnacV2Document). */
function avnacLoAcepta(d: ReturnType<typeof disenoAvnac>) {
  expect(d.v).toBe(2);
  expect(Array.isArray(d.pages) && d.pages.length > 0).toBe(true);
  expect(d.artboard.width).toBeGreaterThanOrEqual(100);
  expect(d.artboard.height).toBeLessThanOrEqual(16000);
  const ids = new Set<string>();
  for (const p of d.pages) {
    expect(typeof p.id).toBe("string");
    expect(p.bg.type).toBe("solid");
    for (const o of p.objects) {
      expect(o.id && o.type, JSON.stringify(o).slice(0, 80)).toBeTruthy();
      expect(ids.has(o.id), `id repetido ${o.id}`).toBe(false);
      ids.add(o.id);
      for (const k of ["x", "y", "width", "height", "rotation", "opacity"] as const) expect(Number.isFinite(o[k]), `${o.name}.${k}`).toBe(true);
      expect(["rect", "ellipse", "text", "image"]).toContain(o.type);
      if (o.type === "text") {
        expect(typeof o.text).toBe("string");
        expect(o.fontSize).toBeGreaterThan(0);
      }
      if (o.type === "image") expect(o.src).toMatch(/^data:image\/(png|webp|svg\+xml);base64,/);
    }
  }
}

const textos = (d: ReturnType<typeof disenoAvnac>) => d.pages.flatMap((p) => p.objects).filter((o): o is Extract<ObjetoAvnac, { type: "text" }> => o.type === "text").map((o) => o.text);

describe("diseño para Avnac Studio", () => {
  it("una página por parte de la invitación, con todas las piezas sueltas y en el formato que Avnac importa", () => {
    const d = disenoAvnac(inv(), { qrB64: "iVBORw0KGgo=" }, Date.parse("2030-02-10T12:00:00Z"));
    avnacLoAcepta(d);
    expect(d.artboard).toEqual({ width: ANCHO, height: ALTO });
    expect(d.pages.map((p) => p.name)).toEqual(["Portada", "Mensaje", "Fecha", "Cuenta atrás", "Ubicación", "Código de vestimenta", "Confirmación", "Regalos", "Hashtag", "Cierre"]);
    const t = textos(d);
    expect(t).toContain("Mariangel Campos Porras");
    expect(t).toContain("Salón Los Robles");
    expect(t).toContain("#MariXV");
    expect(t).toContain("10"); // días que faltan
    const nombres = d.pages.flatMap((p) => p.objects.map((o) => o.name));
    expect(nombres).toEqual(expect.arrayContaining(["Nombres", "Botón WhatsApp", "QR de la invitación", "Sello", "Color 1", "Color 2", "Marca del día"]));
    // Los adornos van como SVG con sus colores puestos (sin depender del CSS de la página).
    const adorno = d.pages[1]!.objects.find((o) => o.name === "Adorno") as Extract<ObjetoAvnac, { type: "image" }>;
    expect(Buffer.from(adorno.src.split(",")[1]!, "base64").toString()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*stroke="#/);
  });

  it("respeta lo corregido a mano y las partes ocultas", () => {
    const i = inv({ retoques: { saludo: { texto: "¡Ven a mi fiesta!", base: basesDe(inv()).saludo! } }, ocultas: ["regalos", "cuenta"] });
    const d = disenoAvnac(i);
    avnacLoAcepta(d);
    expect(textos(d)).toContain("¡Ven a mi fiesta!");
    expect(d.pages.map((p) => p.name)).not.toEqual(expect.arrayContaining(["Regalos", "Cuenta atrás"]));
  });

  it("con foto, la portada lleva la foto en vez del sobre; sin publicar, no hay QR", () => {
    const d = disenoAvnac(inv({ foto: "foto.webp" }), { fotoB64: "UklGRg==" });
    const portada = d.pages[0]!.objects.map((o) => o.name);
    expect(portada).toContain("Foto del sobre");
    expect(portada).not.toContain("Sello");
    expect(d.pages.flatMap((p) => p.objects).some((o) => o.name === "QR de la invitación")).toBe(false);
  });

  it("el nombre del archivo es legible y válido en Windows", () => {
    expect(nombreArchivoAvnac(inv({ nombres: 'Ana & Luis: "boda"' }))).toBe("XV años de Ana & Luis boda.workspace.avnac");
  });
});

// ── De vuelta desde Avnac ────────────────────────────────────────────────────────────────────────────

/** Lo que Avnac 0.4.1 guarda en pages.json tras importar el diseño (to-avnac.ts: forma de Fabric con avnacLayerId). */
function comoLoGuardaAvnac(d: ReturnType<typeof disenoAvnac>) {
  return {
    kind: "avnac-multi-page-document", v: 1, currentPage: 0, pageNames: d.pages.map((p) => p.name),
    pages: d.pages.map((p) => ({
      v: 1, artboard: d.artboard, bg: p.bg,
      fabric: { objects: p.objects.map((o) => ({ avnacLayerId: o.id, avnacLayerName: o.name, type: o.type === "text" ? "textbox" : o.type, visible: o.visible, left: o.x, top: o.y, text: o.type === "text" ? o.text : undefined, fontFamily: o.type === "text" ? o.fontFamily : undefined, avnacFill: o.fill, fill: o.fill.color, avnacStroke: o.stroke, stroke: o.stroke.color, src: o.type === "image" ? o.src : undefined })) },
    })),
  };
}

type Guardado = ReturnType<typeof comoLoGuardaAvnac>;
const pieza = (g: Guardado, id: RegExp) => g.pages.flatMap((p) => p.fabric.objects).find((o) => id.test(o.avnacLayerId))!;

describe("traer los cambios de Avnac", () => {
  it("lee textos, partes borradas, colores y letras; lo que no cambió no cuenta (tampoco las mayúsculas)", async () => {
    const { cambiosDesdeAvnac, leerDisenoAvnac } = await import("@/lib/invitaciones/avnac");
    const i = inv();
    const g = comoLoGuardaAvnac(disenoAvnac(i));
    pieza(g, /^mensaje--ed-saludo$/).text = "¡Te espero!";
    pieza(g, /^portada--ed-nombres$/).fontFamily = "Parisienne";
    pieza(g, /^mensaje--ed-mensaje$/).fontFamily = "Comic Sans MS";
    pieza(g, /^mensaje--tarjeta-\d+$/).avnacFill = { type: "solid", color: "#FFEEDD" };
    // Borrar la página de regalos y dejar la del hashtag con todo oculto.
    const sinRegalos = { ...g, pages: g.pages.filter((p) => !p.fabric.objects.some((o) => o.avnacLayerId.startsWith("regalos--"))) };
    for (const o of sinRegalos.pages.flatMap((p) => p.fabric.objects)) if (o.avnacLayerId.startsWith("comparte--")) o.visible = false;

    const leidas = leerDisenoAvnac(sinRegalos)!;
    expect(leidas).toHaveLength(g.pages.length - 1);
    const c = cambiosDesdeAvnac(i, leidas);
    expect(c.textos).toEqual({ saludo: "¡Te espero!" }); // «SALÓN…» en mayúsculas no es un cambio
    expect(c.ocultas.sort()).toEqual(["comparte", "regalos"]);
    expect(c.colores).toEqual({ tarjeta: "#ffeedd" });
    expect(c.letras).toEqual({ titulos: "Parisienne" });
    expect(c.avisos.join(" ")).toMatch(/Comic Sans MS/);
  });

  it("también lee el archivo que exporta Avnac (una sola página) y el v2 que arma Geeper", async () => {
    const { leerDisenoAvnac } = await import("@/lib/invitaciones/avnac");
    const g = comoLoGuardaAvnac(disenoAvnac(inv()));
    expect(leerDisenoAvnac(g.pages[1])?.[0]?.piezas.length).toBeGreaterThan(0);
    expect(leerDisenoAvnac(disenoAvnac(inv()))).toHaveLength(g.pages.length);
    expect(leerDisenoAvnac({ hola: 1 })).toBeNull();
  });
});

describe("traer de Avnac en disco", () => {
  it("lo busca en la carpeta de Avnac por su nombre y lo pasa a la invitación (con su tema)", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { guardarInvitacion, leerInvitacion, traerDeAvnac } = await import("@/lib/invitaciones/construir");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-avnac-"));
    const antes = { d: process.env.GEEPER_DATA, x: process.env.XDG_CONFIG_HOME, a: process.env.APPDATA };
    process.env.GEEPER_DATA = path.join(tmp, "datos");
    process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
    process.env.APPDATA = path.join(tmp, "config");
    try {
      const { inv: i } = await guardarInvitacion({ ...base, regalos: "Lluvia de sobres" }, {});
      await expect(traerDeAvnac(i.slug)).rejects.toThrow(/No encontré/);

      const g = comoLoGuardaAvnac(disenoAvnac(i));
      pieza(g, /^mensaje--ed-saludo$/).text = "¡Te espero!";
      pieza(g, /^mensaje--tarjeta-\d+$/).avnacFill = { type: "solid", color: "#fff4e6" };
      const docs = path.join(tmp, "config", "avnac-studio", "documents");
      const viejo = path.join(docs, "a1");
      const nuevo = path.join(docs, "b2");
      for (const [dir, cuando] of [[viejo, 1], [nuevo, 2]] as const) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify({ id: path.basename(dir), name: "XV años de Mariangel Campos Porras", updatedAt: cuando }));
        await fs.writeFile(path.join(dir, "pages.json"), JSON.stringify(dir === nuevo ? g : comoLoGuardaAvnac(disenoAvnac(i))));
      }
      const r = await traerDeAvnac(i.slug);
      expect(r.cambios).toEqual(["1 texto", "los colores"]);
      const despues = await leerInvitacion(i.slug);
      expect(despues.retoques?.saludo?.texto).toBe("¡Te espero!");
      expect(despues.plantilla).toBe("tema");
      expect(despues.tema?.colores.tarjeta).toBe("#fff4e6");
      const html = await fs.readFile(path.join(tmp, "datos", "invitaciones", i.slug, "publicar", "index.html"), "utf8");
      expect(html).toContain("¡Te espero!");
      expect(html).toContain("--tarjeta:#fff4e6");
    } finally {
      for (const [k, v] of [["GEEPER_DATA", antes.d], ["XDG_CONFIG_HOME", antes.x], ["APPDATA", antes.a]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
