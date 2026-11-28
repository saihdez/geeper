import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const formsFalso = vi.fn();
vi.mock("@/lib/invitaciones/google", () => ({ forms: (...a: unknown[]) => formsFalso(...a) }));

const { basesDe, compilar, retoquesVigentes } = await import("@/lib/invitaciones/compilar");
const { guardarCambiosMano, guardarInvitacion, htmlEditor, leerInvitacion } = await import("@/lib/invitaciones/construir");
const { Entrada, Invitacion } = await import("@/lib/invitaciones/esquema");
const { crearPedido, entradaDeRespuesta, leerPedido, PREGUNTAS, pedidosFormulario, revisarPedido } = await import("@/lib/invitaciones/formularios");

const base = {
  tipo: "boda" as const, nombres: "Ana & Luis", fecha: "2030-12-15", hora: "15:30", zona: "America/Mexico_City",
  lugar: { nombre: "Hacienda Los Olivos", direccion: "Tequisquiapan, Qro." }, whatsapp: "52 55 1234 5678", regalos: "Liverpool 123",
};

function inv(x: Record<string, unknown> = {}) {
  const { musicaEnlace: _m, plantilla: _p, ...resto } = Entrada.parse(base);
  return Invitacion.parse({ ...resto, version: 1, slug: "boda-prueba-abc123", creada: "x", actualizada: "x", plantilla: "vino-oro", musica: { tipo: "ninguna" }, ...x });
}

describe("corregir a mano", () => {
  it("en el editor cada texto lleva su clave; en la página publicada, no", () => {
    const i = inv();
    const ed = compilar(i, { fuentesCss: "" }, 0, { editor: true }).html;
    const pub = compilar(i, { fuentesCss: "" }, 0).html;
    expect(ed).toContain('data-ed="nombres"');
    expect(ed).toContain('data-sec="regalos"');
    expect(ed).toContain("contentEditable");
    expect(pub).not.toContain("data-ed=");
    expect(pub).not.toContain("contentEditable");
    // Cada clave que se puede escribir aparece en el editor.
    for (const k of Object.keys(basesDe(i))) expect(ed, k).toContain(`data-ed="${k}"`);
  });

  it("aplica el retoque mientras el texto de Geeper sea el mismo, escapado y con saltos de línea", () => {
    const i = inv({ retoques: { saludo: { texto: "¡Nos casamos!\n<script>x</script>", base: basesDe(inv()).saludo! }, lugar: { texto: "Otro", base: "Un lugar viejo" } } });
    const html = compilar(i, { fuentesCss: "" }, 0).html;
    expect(html).toContain("¡Nos casamos!<br>&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("Hacienda Los Olivos"); // el retoque de lugar ya no vale: cambió su base
    expect(retoquesVigentes(i).viejos).toEqual(["lugar"]);
  });

  it("las partes ocultas no salen en la página; en el editor se ven atenuadas", () => {
    const i = inv({ ocultas: ["regalos", "cuenta"] });
    const pub = compilar(i, { fuentesCss: "" }, 0).html;
    expect(pub).not.toContain("Liverpool 123");
    expect(pub).not.toContain('id="c-dias"');
    expect(pub).toContain("if(nums.dias)"); // sin cuenta atrás, el script no falla
    const ed = compilar(i, { fuentesCss: "" }, 0, { editor: true }).html;
    expect(ed).toMatch(/data-sec="regalos" class="ed-oculta tarjeta/);
  });

  describe("en disco", () => {
    let dir: string;
    const antes = process.env.GEEPER_DATA;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-mano-"));
      process.env.GEEPER_DATA = dir;
    });
    afterAll(async () => {
      if (antes === undefined) delete process.env.GEEPER_DATA;
      else process.env.GEEPER_DATA = antes;
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("guarda, quita con texto vacío, y conserva los retoques al cambiar otros datos", async () => {
      const { inv: i } = await guardarInvitacion(base, {});
      await guardarCambiosMano(i.slug, { textos: { saludo: "¡Nos casamos!", lugar: "Los Olivos (jardín)", inventada: "x" }, ocultas: ["regalos"] });
      let g = await leerInvitacion(i.slug);
      expect(Object.keys(g.retoques ?? {}).sort()).toEqual(["lugar", "saludo"]);
      expect(g.ocultas).toEqual(["regalos"]);
      const pub = await fs.readFile(path.join(dir, "invitaciones", i.slug, "publicar", "index.html"), "utf8");
      expect(pub).toContain("Los Olivos (jardín)");
      expect(pub).not.toContain("Liverpool 123");
      expect(await htmlEditor(i.slug)).toContain('data-ed="saludo"');

      // Cambiar el lugar en el formulario: ese retoque se cae (con aviso), el del saludo sigue.
      const { avisos } = await guardarInvitacion({ ...base, lugar: { nombre: "Salón Real" } }, {}, i.slug);
      g = await leerInvitacion(i.slug);
      expect(Object.keys(g.retoques ?? {})).toEqual(["saludo"]);
      expect(g.ocultas).toEqual(["regalos"]);
      expect(avisos.join(" ")).toMatch(/corregido a mano/);

      await guardarCambiosMano(i.slug, { textos: { saludo: "" }, ocultas: [] });
      g = await leerInvitacion(i.slug);
      expect(g.retoques).toBeUndefined();
      expect(g.ocultas).toBeUndefined();
    });
  });
});

describe("los textos caben en sus formas", () => {
  it("los títulos de las tarjetas en arco empiezan donde el arco ya es ancho y se achican si una palabra no cabe", () => {
    const html = compilar(inv(), { fuentesCss: "" }, 0).html;
    expect(html).toMatch(/\.arco\{border-radius:min\(190px,46vw\)[^}]*padding-top:clamp\(58px/);
    expect(html).toContain(".arco>h2{padding:0 6%}");
    expect(html).toContain("text-wrap:balance");
    expect(html).toContain("function ajustar()");
    expect(html).toContain("document.fonts.ready.then(ajustar)");
  });
});

describe("Google Forms", () => {
  const preguntas = Object.fromEntries(PREGUNTAS.map((p, i) => [p.campo, `q${i}`]));
  const r = (v: Record<string, string>) => ({
    responseId: "r1",
    lastSubmittedTime: "2026-11-27T10:00:00Z",
    answers: Object.fromEntries(Object.entries(v).map(([c, val]) => [preguntas[c], { questionId: preguntas[c], textAnswers: { answers: [{ value: val }] } }])),
  });

  it("arma una pregunta por campo, sin la de tipo si ya se eligió", () => {
    const todo = pedidosFormulario();
    expect(todo.campos).toEqual(PREGUNTAS.map((p) => p.campo));
    expect(todo.requests).toHaveLength(PREGUNTAS.length + 1);
    const conTipo = pedidosFormulario("xv");
    expect(conTipo.campos).not.toContain("tipo");
    const json = JSON.stringify(todo.requests);
    expect(json).toContain('"dateQuestion":{"includeYear":true,"includeTime":false}');
    expect(json).toContain('"timeQuestion"');
    expect(json).toContain('"value":"XV años"');
  });

  it("pasa la respuesta a datos de invitación y avisa de lo opcional que no sirve", () => {
    const { entrada, avisos } = entradaDeRespuesta({ preguntas, zona: "America/Mexico_City" }, r({
      tipo: "XV años", nombres: "Sofía", fecha: "2030-03-02", hora: "9:05", lugar: "Salón Luna", whatsapp: "+52 55 1111 2222",
      mapa: "por la iglesia", pases: "dos", idea: "bosque encantado con luciérnagas", hashtag: "#Sofi XV",
    }));
    expect(entrada).toMatchObject({ tipo: "xv", nombres: "Sofía", fecha: "2030-03-02", hora: "09:05", zona: "America/Mexico_City", plantilla: "tema", hashtag: "#SofiXV" });
    expect((entrada.tema as { idea: string }).idea).toBe("bosque encantado con luciérnagas");
    expect(Entrada.safeParse(entrada).success).toBe(true);
    expect(avisos).toHaveLength(2);
  });

  describe("con la API de Google simulada", () => {
    let dir: string;
    const antes = process.env.GEEPER_DATA;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-forms-"));
      process.env.GEEPER_DATA = dir;
    });
    afterAll(async () => {
      if (antes === undefined) delete process.env.GEEPER_DATA;
      else process.env.GEEPER_DATA = antes;
      await fs.rm(dir, { recursive: true, force: true });
    });
    beforeEach(() => formsFalso.mockReset());

    async function nuevo() {
      formsFalso
        .mockResolvedValueOnce({ formId: "F1", responderUri: "https://docs.google.com/forms/d/e/F1/viewform" })
        .mockImplementationOnce(async (_ruta: string, init: { body: { requests: unknown[] } }) => ({
          replies: [{}, ...init.body.requests.slice(1).map((_, i) => ({ createItem: { itemId: `i${i}`, questionId: [`q${i}`] } }))],
        }));
      return crearPedido({ referencia: "Boda de Ana", zona: "America/Mexico_City" });
    }

    it("crea el formulario, espera, arma la invitación con la respuesta y la actualiza si el cliente la cambia", async () => {
      const p = await nuevo();
      expect(p.enlace).toContain("viewform");
      expect(p.preguntas.nombres).toBe("q1");
      expect(formsFalso.mock.calls[1]![0]).toBe("/forms/F1:batchUpdate");

      formsFalso.mockResolvedValueOnce({});
      expect((await revisarPedido(p.id)).nueva).toBe(false);

      const resp = r({ tipo: "Boda", nombres: "Ana & Luis", fecha: "2030-12-15", hora: "18:00", lugar: "Los Olivos", whatsapp: "525512345678" });
      formsFalso.mockResolvedValueOnce({ responses: [resp] });
      const rev = await revisarPedido(p.id);
      expect(rev.nueva).toBe(true);
      expect(rev.pedido.slug).toBeTruthy();
      const i = await leerInvitacion(rev.pedido.slug!);
      expect(i).toMatchObject({ nombres: "Ana & Luis", formulario: p.id, lugar: { nombre: "Los Olivos" } });

      // La misma respuesta otra vez: no se rehace nada.
      formsFalso.mockResolvedValueOnce({ responses: [resp] });
      expect((await revisarPedido(p.id)).nueva).toBe(false);

      // El cliente cambió su respuesta: misma invitación, datos nuevos.
      formsFalso.mockResolvedValueOnce({ responses: [{ ...resp, lastSubmittedTime: "2026-11-28T10:00:00Z", answers: { ...resp.answers, [p.preguntas.lugar!]: { textAnswers: { answers: [{ value: "Salón Real" }] } } } }] });
      const otra = await revisarPedido(p.id);
      expect(otra.pedido.slug).toBe(rev.pedido.slug);
      expect((await leerInvitacion(rev.pedido.slug!)).lugar.nombre).toBe("Salón Real");
    });

    it("si falta algo obligatorio, guarda las respuestas para completarlas a mano", async () => {
      const p = await nuevo();
      formsFalso.mockResolvedValueOnce({ responses: [r({ tipo: "Boda", nombres: "Ana", fecha: "2030-12-15", hora: "18:00", lugar: "Los Olivos", whatsapp: "llámame" })] });
      const rev = await revisarPedido(p.id);
      expect(rev.pedido.slug).toBeUndefined();
      expect(rev.pedido.problemas.join(" ")).toMatch(/WhatsApp/);
      expect((await leerPedido(p.id)).borrador).toMatchObject({ nombres: "Ana" });
    });
  });
});

describe("ajustar y descartar las imágenes", () => {
  it("el filtro recorta 3:2 alrededor del punto elegido y sólo agrega luz/contraste/color si cambiaron", async () => {
    const { AjustesFoto, filtroAjustes } = await import("@/lib/invitaciones/imagenes");
    expect(filtroAjustes(AjustesFoto.parse({}))).toBe("crop=w='min(iw\\,ih*1.5)/1':h='min(iw\\,ih*1.5)/1/1.5':x='(iw-ow)*0.5':y='(ih-oh)*0.5',scale=1080:720:flags=lanczos");
    const f = filtroAjustes(AjustesFoto.parse({ zoom: 2, x: 0, y: 100, brillo: 0.2, contraste: 1.3, color: 0 }));
    expect(f).toContain("/2':");
    expect(f).toContain("x='(iw-ow)*0'");
    expect(f).toContain("y='(ih-oh)*1'");
    expect(f).toContain("clipval*1.2");
    expect(f).toContain("eq=contrast=1.3:saturation=0");
    expect(() => AjustesFoto.parse({ zoom: 9 })).toThrow();
  });

  it("ajustar la foto actual parte siempre del original (no se acumulan) y descartar borra la propuesta", async () => {
    const { existsSync } = await import("node:fs");
    const { FFMPEG } = await import("@/lib/rutas");
    if (!existsSync(FFMPEG)) return;
    const { execFileSync } = await import("node:child_process");
    const { ajustarFoto, guardarInvitacion, leerInvitacion } = await import("@/lib/invitaciones/construir");
    const { descartarPropuesta, descartarPropuestas, FOTO_ORIGINAL, leerPropuestas } = await import("@/lib/invitaciones/imagenes");
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-ajuste-"));
    const antes = process.env.GEEPER_DATA;
    process.env.GEEPER_DATA = tmp;
    try {
      const { inv: i } = await guardarInvitacion(base, {});
      const dir = path.join(tmp, "invitaciones", i.slug);
      await fs.mkdir(path.join(dir, "propuestas"), { recursive: true });
      // Una «foto» de 1200×800: mitad izquierda roja, derecha azul.
      for (const n of ["foto-1764260000000-1.png", "foto-1764260000000-2.png"]) {
        execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=600x800", "-f", "lavfi", "-i", "color=blue:s=600x800", "-filter_complex", "hstack", "-frames:v", "1", path.join(dir, "propuestas", n)]);
      }
      // Acercar al doble sobre la izquierda: queda toda roja.
      await ajustarFoto(i.slug, { archivo: "foto-1764260000000-1.png", ajustes: { zoom: 2, x: 0, y: 50 } });
      expect((await leerInvitacion(i.slug)).foto).toBe("foto.webp");
      expect(existsSync(path.join(dir, FOTO_ORIGINAL))).toBe(true);
      const color = () => execFileSync(FFMPEG, ["-v", "error", "-i", path.join(dir, "foto.webp"), "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      expect(color()[0]).toBeGreaterThan(200);
      expect(color()[2]).toBeLessThan(60);
      // Reajustar la actual hacia la derecha: sale del original (azul), no de la foto ya recortada (roja).
      await ajustarFoto(i.slug, { ajustes: { zoom: 2, x: 100, y: 50 } });
      expect(color()[2]).toBeGreaterThan(200);

      await descartarPropuesta(dir, "foto-1764260000000-1.png");
      expect((await leerPropuestas(dir)).fotos).toEqual(["foto-1764260000000-2.png"]);
      await expect(descartarPropuesta(dir, "../invitacion.json")).rejects.toThrow();
      expect(await descartarPropuestas(dir, "foto")).toBe(1);
      expect(existsSync(path.join(dir, "foto.webp"))).toBe(true); // la que usa la invitación no se borra
    } finally {
      if (antes === undefined) delete process.env.GEEPER_DATA;
      else process.env.GEEPER_DATA = antes;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
