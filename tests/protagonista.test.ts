import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptComponer } from "@/lib/actuar";
import { pista, validarProyecto, type Proyecto } from "@/lib/esquema";
import { ENTRADA } from "@/lib/linea";
import { MAX_SEGUNDOS } from "@/lib/presentador";
import { escenasProtagonista, hablaConSuVoz, minutosProtagonista } from "@/lib/protagonista";
import { segundosTomasJuntas } from "@/lib/tiempo-hablar";
import { rutasPorSemilla } from "@/lib/wan2gp";
import { proyectoDePrueba } from "./fixtures";

/** Las escenas con `segundos` de voz cada una. */
function conVoz(segundos: number[]): Proyecto {
  const p = proyectoDePrueba();
  const voz = pista(p, "voz").clips;
  let t = 0;
  segundos.forEach((s, i) => {
    voz[i]!.rango = { inicio: t, duracion: s };
    pista(p, "visual").clips[i]!.rango = { inicio: 0, duracion: s };
    t += s;
  });
  p.assets.voz!.duracion = t;
  for (const id of ["clip-01", "clip-02", "clip-03"]) p.assets[id]!.duracion = Math.max(...segundos) + 1;
  return validarProyecto(p);
}

describe("protagonista: el avatar en cada escena, única persona del video", () => {
  it("una toma por escena, con la voz de esa escena; una que no entra en una toma se avisa", () => {
    expect(escenasProtagonista(proyectoDePrueba()).map((e) => [e.escena, e.numero, e.segundos])).toEqual([
      ["e01", 1, ENTRADA + 3],
      ["e02", 2, ENTRADA + 3],
      ["e03", 3, ENTRADA + 3],
    ]);
    expect(() => escenasProtagonista(conVoz([MAX_SEGUNDOS, 3, 3]))).toThrow(/escena 1.*pártela/);
  });

  it("al ponerlo en el fondo de la escena, la gente que traiga la imagen sale", () => {
    const pr = promptComponer({ estilo: "realista" }, { tipo: "habla", encuadre: "medio", que: "", lugar: "escena", donde: "" }, { escena: true, producto: false });
    expect(pr).toMatch(/place shown in image 2/);
    expect(pr).toMatch(/remove every other person.*only human/);
  });

  it("lo que tarda: el modelo se carga una vez para todas las escenas", () => {
    // 6 escenas de 5 s: ~2,5 min de carga + 6 × (45 s + 5 × 41 s) + ~1 min por escena para el fondo.
    expect(segundosTomasJuntas([5, 5, 5, 5, 5, 5])).toBe(150 + 6 * (45 + 205));
    expect(minutosProtagonista([5, 5, 5, 5, 5, 5])).toBe(Math.ceil(6 + 1650 / 60));
  });

  it("la voz del avatar: Kokoro de MPT lleva «kokoro:» delante; VoxCPM tiene que ser la misma", () => {
    const voz = { motor: "mpt" as const, voz: "kokoro:ef_dora", velocidad: 1, idioma: "es" };
    expect(hablaConSuVoz(voz, { motor: "kokoro", voz: "ef_dora", nombre: "Dora" })).toBe(true);
    expect(hablaConSuVoz(voz, { motor: "kokoro", voz: "af_heart", nombre: "Heart" })).toBe(false);
    expect(hablaConSuVoz(voz, { motor: "voxcpm", voz: "sofia", nombre: "Sofía" })).toBe(false);
  });
});

describe("Wan2GP en lote: cada video por su semilla", () => {
  it("reconoce el video de cada toma (gana el posproceso) y deja null la que no salió", () => {
    const salida = [
      "Video file saved to Path: C:\\o\\2026-11-23-01h00m00s_seed101_The person talks.mp4",
      "Video file saved to Path: C:\\o\\2026-11-23-01h03m00s_seed103_The person talks.mp4",
      "Remuxed Video saved to Path: C:\\o\\2026-11-23-01h03m01s_seed103_The person talks_remux.mp4",
    ].join("\n");
    const todo = () => true;
    const [a, b, c] = rutasPorSemilla(salida, [101, 102, 103], undefined, todo);
    expect(a).toMatch(/seed101_The person talks\.mp4$/);
    expect(b).toBeNull();
    expect(c).toMatch(/seed103_The person talks_remux\.mp4$/);
    // «seed10_» no es «seed101_».
    expect(rutasPorSemilla(salida, [10], undefined, todo)).toEqual([null]);
    // Si el posproceso falló (su archivo no está), sirve el video sin posprocesar.
    expect(rutasPorSemilla(salida, [103], undefined, (r) => !r.includes("remux"))[0]).toMatch(/seed103_The person talks\.mp4$/);
  });

  it("si la línea no quedó en la salida (tope), lo encuentra en la carpeta por su semilla", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-lote-"));
    fs.writeFileSync(path.join(out, "2026-11-23-01h00m00s_seed202_x.mp4"), "");
    fs.writeFileSync(path.join(out, "tmp123_continue9.mp4"), "");
    expect(rutasPorSemilla("", [202, 203], out)).toEqual([path.join(out, "2026-11-23-01h00m00s_seed202_x.mp4"), null]);
  });
});
