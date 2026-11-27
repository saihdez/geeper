/** UX-28 (parte del editor): no ofrecer subtítulos que no existen y dejar la descarga a mano en «En vivo». */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rutaSrt, tieneSrt } from "@/lib/vista";

const editor = fs.readFileSync(path.join(process.cwd(), "src", "components", "editor-proyecto.tsx"), "utf8");

describe("descargas del editor (UX-28)", () => {
  it("sabe si el .srt del render existe", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-srt-"));
    fs.mkdirSync(path.join(dir, "renders"));
    fs.writeFileSync(path.join(dir, "renders", "v5-shorts-9x16.srt"), "1\n");
    expect(rutaSrt("renders/v5-shorts-9x16.mp4")).toBe("renders/v5-shorts-9x16.srt");
    expect(tieneSrt(dir, "renders/v5-shorts-9x16.mp4")).toBe(true);
    expect(tieneSrt(dir, "renders/v4-shorts-9x16.mp4")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("el botón de subtítulos depende de que exista y «En vivo» ofrece el último video", () => {
    expect(editor).toContain("{render.srt && <a");
    expect(editor).toContain("Descargar el último video (versión {render.versionNumero})");
  });
});
