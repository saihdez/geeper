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
