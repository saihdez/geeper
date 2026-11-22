import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorConexion, SIN_CONEXION, errorDelCuerpo, mensajeHttp, traer } from "@/lib/conexion";
import { pedir } from "@/components/comun";

afterEach(() => vi.unstubAllGlobals());

describe("errores de conexión en palabras simples (A11-04)", () => {
  it("el texto del servidor pasa tal cual", () => {
    expect(mensajeHttp(400, "Escribe al menos un tema")).toBe("Escribe al menos un tema");
  });

  it("sin texto del servidor, un mensaje según el código y nunca «Error 500»", () => {
    expect(mensajeHttp(404)).toBe("Eso ya no existe.");
    expect(mensajeHttp(413)).toBe("El archivo es demasiado grande.");
    expect(mensajeHttp(500)).toBe("Algo falló dentro de Geeper. Vuelve a intentar.");
    expect(mensajeHttp(502, "  ")).not.toMatch(/Error \d/);
    expect(mensajeHttp(500, { raro: 1 })).toBe("Algo falló dentro de Geeper. Vuelve a intentar.");
  });

  it("un fallo de red se vuelve «No hay conexión con Geeper…», no «Failed to fetch»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(traer("/api/x")).rejects.toBeInstanceOf(ErrorConexion);
    await expect(pedir("/api/x")).rejects.toThrow(SIN_CONEXION);
  });

  it("una cancelación no se disfraza de falta de conexión", async () => {
    const c = new AbortController();
    c.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("abortado", "AbortError"); }));
    await expect(traer("/api/x", { signal: c.signal })).rejects.not.toBeInstanceOf(ErrorConexion);
  });

  it("pedir usa el error del servidor o el mensaje simple", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Falta la voz" }), { status: 400 })));
    await expect(pedir("/api/x")).rejects.toThrow("Falta la voz");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>caído</html>", { status: 500 })));
    await expect(pedir("/api/x")).rejects.toThrow("Algo falló dentro de Geeper. Vuelve a intentar.");
  });

  it("errorDelCuerpo tolera cuerpos que no son JSON", () => {
    expect(errorDelCuerpo('{"error":"x"}')).toBe("x");
    expect(errorDelCuerpo("no json")).toBeUndefined();
    expect(errorDelCuerpo("null")).toBeUndefined();
  });
});
