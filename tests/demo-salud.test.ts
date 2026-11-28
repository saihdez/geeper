import { describe, expect, it } from "vitest";
import { revisarPagina } from "../src/lib/demo-web";

const sana = { estado: 200, texto: 1500, medios: 4, rotas: 0 };

describe("demo desde una web: ¿vale la pena grabar la página?", () => {
  it("una página normal se graba sin avisos", () => {
    expect(revisarPagina(sana)).toEqual({ error: null, avisos: [] });
  });

  it("una página que no existe, bloqueada o caída no se graba, con un mensaje distinto para cada caso", () => {
    expect(revisarPagina({ ...sana, estado: 404 }).error).toMatch(/no existe/);
    expect(revisarPagina({ ...sana, estado: 403 }).error).toMatch(/no dejó entrar/);
    expect(revisarPagina({ ...sana, estado: 429 }).error).toMatch(/no dejó entrar/);
    expect(revisarPagina({ ...sana, estado: 503 }).error).toMatch(/en un rato/);
    expect(revisarPagina({ ...sana, estado: 418 }).error).toMatch(/respondió con un error/);
  });

  it("los mensajes no traen códigos ni palabras técnicas", () => {
    for (const estado of [401, 404, 418, 500]) expect(revisarPagina({ ...sana, estado }).error).not.toMatch(/\d{3}|HTTP|status/i);
  });

  it("una página en blanco no se graba; con poco texto pero con imágenes, sí", () => {
    expect(revisarPagina({ estado: 200, texto: 0, medios: 0, rotas: 0 }).error).toMatch(/en blanco/);
    expect(revisarPagina({ estado: 200, texto: 5, medios: 2, rotas: 0 }).error).toBeNull();
  });

  it("sin respuesta del servidor (página local) decide sólo por lo que se ve", () => {
    expect(revisarPagina({ ...sana, estado: null }).error).toBeNull();
    expect(revisarPagina({ estado: null, texto: 0, medios: 0, rotas: 0 }).error).toMatch(/en blanco/);
  });

  it("las imágenes rotas sólo se avisan en el registro", () => {
    expect(revisarPagina({ ...sana, rotas: 1 })).toEqual({ error: null, avisos: [expect.stringMatching(/una imagen/)] });
    expect(revisarPagina({ ...sana, rotas: 3 }).avisos[0]).toMatch(/3 imágenes/);
  });
});
