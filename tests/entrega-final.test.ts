import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { paso, pasoQueEnvuelve } from "@/lib/pasos";

/**
 * REN-08: volver a una versión ya entregada reutiliza su MP4 aunque el archivo intermedio (el crudo,
 * de ruta fija) se haya sobrescrito con el render de otra versión.
 */
it("volver a una versión ya entregada no repite el render aunque el crudo cambió", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-final-"));
  const ctx = { dir, log: () => {} };
  const fuente = path.join(dir, "index.html");
  const crudo = path.join(dir, "build", "crudo.mp4");
  let renders = 0;

  async function entregar(version: number, contenido: string) {
    fs.writeFileSync(fuente, contenido);
    const final = path.join(dir, "renders", `v${version}.mp4`);
    const r = await pasoQueEnvuelve(ctx, "entrega.final", { archivos: [fuente], params: {}, motor: "m" }, final, async () => {
      await paso(ctx, "hyperframes.render", { archivos: [fuente], params: {}, motor: "m" }, [crudo], async ([tmp]) => {
        renders++;
        fs.writeFileSync(tmp!, `crudo de ${contenido}`);
        return {};
      });
      await paso(ctx, "entrega.loudnorm", { archivos: [crudo], params: {}, motor: "m" }, [final], async ([tmp]) => {
        fs.writeFileSync(tmp!, `${fs.readFileSync(crudo, "utf8")} entregado`);
        return {};
      });
      return { gpu: version === 1 };
    });
    return { final, ...r };
  }

  const v1 = await entregar(1, "A");
  expect(v1.saltado).toBe(false);
  expect(v1.resultado).toEqual({ gpu: true });
  await entregar(2, "B");
  expect(renders).toBe(2);
  // «Volver a esta» crea la versión 3 con el contenido de la 1: el crudo es el de B, pero no se renderiza.
  const v3 = await entregar(3, "A");
  expect(renders).toBe(2);
  expect(v3.saltado).toBe(true);
  expect(v3.resultado).toEqual({ gpu: true });
  expect(fs.readFileSync(v3.final, "utf8")).toBe("crudo de A entregado");
  // El MP4 de la versión 1 sigue ahí y es el mismo.
  expect(fs.readFileSync(v1.final, "utf8")).toBe("crudo de A entregado");
});

it("si la entrega guardada se borró, se vuelve a producir", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-final-"));
  const ctx = { dir, log: () => {} };
  const fuente = path.join(dir, "index.html");
  fs.writeFileSync(fuente, "A");
  const final = path.join(dir, "renders", "v1.mp4");
  let corridas = 0;
  const producir = () => pasoQueEnvuelve(ctx, "entrega.final", { archivos: [fuente], params: {}, motor: "m" }, final, async () => {
    corridas++;
    fs.mkdirSync(path.dirname(final), { recursive: true });
    fs.writeFileSync(final, "listo");
    return {};
  });
  await producir();
  fs.rmSync(final);
  await producir();
  expect(corridas).toBe(2);
  expect(fs.readFileSync(final, "utf8")).toBe("listo");
});
