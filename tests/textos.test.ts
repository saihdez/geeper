/** UX-15: los trabajos, sus estados y sus etapas se dicen sin jerga. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Estado } from "@/components/comun";
import { ESTADOS, etapaSimple, nombreEstado, nombreTipo, TIPOS_TRABAJO } from "@/lib/textos";

const JERGA = /\b(QC|render|GPU|MPT|CPU|Kokoro|whisper|hyperframes|workflow|ComfyUI|log)\b|\w+\.\w+/i;
const leer = (r: string) => fs.readFileSync(path.join(process.cwd(), r), "utf8");

describe("nombres de trabajos (UX-15)", () => {
  it("cada tipo que corre el worker tiene nombre y sin jerga", () => {
    const tipos = [...leer("worker/ejecutores.ts").matchAll(/^ {2}"([a-z]+\.[a-z]+)": /gm)].map((m) => m[1]!);
    expect(tipos.length).toBeGreaterThan(15);
    for (const t of tipos) {
      expect(nombreTipo(t)).not.toBe("Trabajo de Geeper");
      expect(nombreTipo(t)).not.toMatch(JERGA);
    }
    for (const n of Object.values(TIPOS_TRABAJO)) expect(n).not.toMatch(JERGA);
    expect(nombreTipo("algo.nuevo")).toBe("Trabajo de Geeper");
  });

  it("los estados van con mayúscula y en palabras", () => {
    expect(nombreEstado("pendiente")).toBe("En cola");
    expect(nombreEstado("corriendo")).toBe("En curso");
    expect(nombreEstado("hecho")).toBe("Listo");
    expect(nombreEstado("fallido")).toBe("No se pudo");
    expect(nombreEstado("interrumpido")).toBe("Se cortó");
    expect(nombreEstado("raro")).toBe("Raro");
    for (const n of Object.values(ESTADOS)) {
      expect(n[0]).toBe(n[0]!.toLocaleUpperCase("es"));
      expect(n).not.toMatch(JERGA);
    }
    expect(renderToStaticMarkup(createElement(Estado, { valor: "corriendo" }))).toContain("En curso");
  });
});

describe("etapas (UX-15)", () => {
  it.each([
    ["Esperando la GPU (la tiene: mpt)", "Esperando turno: la tarjeta de video está ocupada."],
    ["MPT generando (45 %, 120 s)", "Haciendo el video nuevo (45 %)…"],
    ["hyperframes check", "Armando el video final…"],
    ["Compilando a Hyperframes", "Armando el video final…"],
    ["Control de calidad", "Revisando que el video quede bien…"],
    ["Generando la voz (Kokoro, CPU)", "Generando la voz"],
    ["Cortando el tramo, reencuadrando y transcribiendo (CPU)", "Cortando el momento y escribiendo los subtítulos…"],
    ["Traduciendo al inglés con Gemma (tarjeta gráfica)", "Traduciendo al inglés (tarjeta gráfica)"],
    ["Poniendo a tu avatar en la escena", "Poniendo a tu avatar en la escena"],
    ["Trayendo la fuente y midiendo el sonido", "Trayendo el video y midiendo dónde hay más reacción…"],
  ])("«%s» → «%s»", (cruda, simple) => {
    expect(etapaSimple(cruda)).toBe(simple);
  });

  it("lo que espera turno lo dice", () => {
    expect(etapaSimple("En cola", "pendiente")).toMatch(/Esperando su turno/);
    expect(etapaSimple("")).toBe("Empezando…");
  });

  it("Trabajos ya no pinta «GPU ·» ni el tipo crudo", () => {
    const s = leer("src/components/lista-trabajos.tsx");
    expect(s).not.toContain('"GPU · "');
    expect(s).not.toContain("?? t.tipo");
    expect(s).toContain("etapaSimple(t.etapa");
  });
});

describe("errores de trabajos (UX-14)", () => {
  it("lo técnico se dice simple y se pliega", async () => {
    const { ERROR_GENERICO, explicarError } = await import("@/lib/textos");
    for (const crudo of [
      "Falló (1): /home/x/venvs/clips/bin/python -I -m yt_dlp -J https://youtu.be/abc\nERROR: [youtube] abc: Private video",
      "Invalid `prisma.trabajo.update()` invocation: database is locked",
      "ENOENT: no such file or directory, open 'C:\\Users\\x\\geeper-data\\a.json'",
      "TypeError: Cannot read properties of undefined (reading 'n')\n    at importarClip (src/lib/importador-clip.ts:20:3)",
    ]) {
      const r = explicarError(crudo);
      expect(r.simple).toBe(ERROR_GENERICO);
      expect(r.detalle).toBe(crudo);
    }
  });

  it("lo que ya viene explicado se respeta y el detalle va aparte", async () => {
    const { explicarError, SEPARADOR_DETALLE } = await import("@/lib/textos");
    expect(explicarError("Cancelado por la persona")).toEqual({ simple: "Cancelado por la persona", detalle: null });
    expect(explicarError(`Ese video es privado.${SEPARADOR_DETALLE}Falló (1): yt_dlp …`)).toEqual({ simple: "Ese video es privado.", detalle: "Falló (1): yt_dlp …" });
  });

  it("la fila muestra la frase simple y «Ver detalle técnico»; los botones se entienden", async () => {
    const { ErrorTrabajo } = await import("@/components/lista-trabajos");
    const html = renderToStaticMarkup(createElement(ErrorTrabajo, { error: "Falló (1): /usr/bin/ffmpeg -i /tmp/a.mp4\nboom" }));
    expect(html).toContain("Algo falló al hacer esto");
    expect(html).toContain("Ver detalle técnico");
    expect(html).toContain("/usr/bin/ffmpeg");
    const s = leer("src/components/lista-trabajos.tsx");
    expect(s).toContain("Volver a intentar");
    expect(s).not.toMatch(/>Relanzar<|"Log"/);
  });
});

describe("motor apagado (UX-15)", () => {
  it("en la app de escritorio no manda a correr comandos", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MotorApagado } = await import("@/components/comun");
    const app = renderToStaticMarkup(createElement(MotorApagado, { escritorio: true }));
    expect(app).toContain("Cierra Geeper y ábrelo otra vez.");
    expect(app).not.toContain("pnpm");
    expect(renderToStaticMarkup(createElement(MotorApagado, {}))).toContain("pnpm run dev:up");
  });
});
