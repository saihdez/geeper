/** DSC-05 y DSC-06: el espacio libre se mide donde se escribe y, en WSL, contra lo que queda en C:. */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorSinEspacio, espacioLibre, exigirEspacio, letraDe, margenDisco } from "@/lib/espacio";
import { faltaParaUsar, textoSinEspacio } from "@/lib/espacio-texto";

const GB = 1e9;
/** Un statfs falso: Linux dice 456 GB libres y C: sólo 99 (lo medido en la auditoría). */
function falso(libres: Record<string, number>) {
  const pedidas: string[] = [];
  const statfs = async (r: string) => {
    pedidas.push(r);
    const clave = Object.keys(libres).find((k) => r === k || r.startsWith(`${k}/`)) ?? "/";
    const libre = libres[clave];
    if (libre === undefined) throw new Error(`no montado: ${r}`);
    return { bavail: libre / 4096, bsize: 4096, blocks: (libre * 2) / 4096 };
  };
  return { statfs, pedidas };
}

describe("espacio libre (DSC-05, DSC-06)", () => {
  it("una ruta de /mnt/d se mide en D: y no se compara con C:", async () => {
    expect(letraDe("/mnt/d/geeper")).toBe("D:");
    expect(letraDe("C:\\Users\\x")).toBe("C:");
    expect(letraDe("/home/x")).toBeNull();
  });

  it("mide la carpeta existente más cercana de lo que todavía no existe", async () => {
    const { statfs, pedidas } = falso({ "/": 50 * GB });
    await espacioLibre(path.join(os.tmpdir(), "no-existe-aun", "modelo.safetensors"), { statfs });
    expect(pedidas).toEqual([path.resolve(os.tmpdir())]);
  });

  it("si no alcanza con la reserva, avisa cuánto liberar en palabras simples", async () => {
    const { statfs } = falso({ "/": 30 * GB });
    const p = exigirEspacio(os.tmpdir(), 22 * GB, "bajar los modelos", { statfs, margen: 20 * GB });
    await expect(p).rejects.toBeInstanceOf(ErrorSinEspacio);
    await expect(p).rejects.toThrow("No hay lugar suficiente en el disco para bajar los modelos: hay que liberar unos 12 GB.");
    await expect(exigirEspacio(os.tmpdir(), 5 * GB, "subir este video", { statfs, margen: 20 * GB })).resolves.toMatchObject({ libre: 30 * GB });
  });

  it("la reserva se puede cambiar con GEEPER_MARGEN_DISCO_GB", () => {
    expect(margenDisco({})).toBe(20 * GB);
    expect(margenDisco({ GEEPER_MARGEN_DISCO_GB: "5" })).toBe(5 * GB);
    expect(margenDisco({ GEEPER_MARGEN_DISCO_GB: "x" })).toBe(20 * GB);
    expect(faltaParaUsar({ libre: 10 * GB }, 1 * GB, 5 * GB)).toBe(0);
    expect(textoSinEspacio({ libre: 3 * GB, total: 0, disco: "el disco", enWindows: false }, 2 * GB, "crear el video", 5 * GB)).toContain("en el disco para crear el video: hay que liberar unos 4 GB");
  });
});

describe("chequeo «Espacio en disco» de Sistema (DSC-05)", () => {
  const m = (libre: number, enWindows = true) => ({ libre, total: 1000 * GB, disco: enWindows ? "C:" : "el disco", enWindows });
  it("bien con 50 GB o más; aviso por debajo; falla por debajo de la reserva", async () => {
    const { estadoDisco } = await import("@/lib/espacio-texto");
    expect(estadoDisco(m(148 * GB))).toEqual({ ok: true, detalle: "Quedan 148 GB libres en el disco C:. Ahí vive también el disco de Linux donde trabaja Geeper." });
    const poco = estadoDisco(m(30 * GB));
    expect(poco).toMatchObject({ ok: false, aviso: true });
    expect(poco.arreglo).toContain("no vuelve solo a C:");
    const nada = estadoDisco(m(12 * GB, false));
    expect(nada.ok).toBe(false);
    expect(nada.aviso).toBeUndefined();
    expect(nada.arreglo).not.toContain("C:");
  });
});
