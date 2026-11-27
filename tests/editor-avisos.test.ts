/** UX-19: los avisos del editor salen abajo, junto a lo que se edita; los errores no se van solos. */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { duracionAviso, FranjaAviso } from "@/components/franja-aviso";
import { avisoGuardado, TEXTO_RITMO_GUARDADO } from "@/components/editor-estado";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("franja de avisos del editor (UX-19)", () => {
  it("los éxitos se van a los 6 s y los errores quedan hasta cerrarlos", () => {
    expect(duracionAviso("ok")).toBe(6000);
    expect(duracionAviso("error")).toBeNull();
  });

  it("va fija abajo; el error se anuncia como alerta y se puede cerrar", () => {
    const html = renderToStaticMarkup(createElement(FranjaAviso, { msg: { tipo: "error", texto: "No se pudo guardar" }, cerrar: () => undefined }));
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cerrar");
  });

  it("tras guardar ofrece el paso siguiente al lado del texto", () => {
    const html = renderToStaticMarkup(createElement(FranjaAviso, {
      msg: { tipo: "ok", texto: "Guardado.", accion: { texto: "Crear el video", hacer: () => undefined } }, cerrar: () => undefined,
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Crear el video");
  });

  it("el editor ya no pinta el aviso arriba, fuera de la vista", () => {
    expect(editor).not.toContain("{msg && <Aviso");
    expect(editor).toContain("<FranjaAviso msg={msg}");
  });

  it("queda por encima del reproductor pequeño y de las tareas flotantes (z-40)", () => {
    const html = renderToStaticMarkup(createElement(FranjaAviso, { msg: { tipo: "ok", texto: "Guardado." }, cerrar: () => undefined }));
    expect(html).toContain("z-50");
    expect(html).not.toContain("z-40");
  });

  it("no ofrece «Crear el video» si ya se está creando uno", () => {
    expect(avisoGuardado([]).ofrecerCrear).toBe(true);
    const enCurso = avisoGuardado([{ id: "t", tipo: "render.entregar", estado: "corriendo" }]);
    expect(enCurso.ofrecerCrear).toBe(false);
    expect(enCurso.texto).toMatch(/créalo otra vez cuando termine/);
    expect(avisoGuardado([{ id: "t", tipo: "render.entregar", estado: "completado" }]).ofrecerCrear).toBe(true);
    // Y el botón de la franja, pulsado tarde, no encola otro render encima.
    expect(editor).toMatch(/const renderizar = async \(\) => \{\s*\/\/[^\n]*\n\s*if \(renderEnCurso\(vistaAlDia\.current/);
  });

  it("cambiar el ritmo no dice «Guardado… crea el video» (no cambia el video hasta decir el guion)", () => {
    expect(TEXTO_RITMO_GUARDADO).toMatch(/próxima vez que se diga el guion/);
    expect(editor).toContain('editarOk({ tipo: "cambiarVoz", velocidad: Number(e.target.value) }, TEXTO_RITMO_GUARDADO)');
  });
});
