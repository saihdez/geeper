import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { manejar, respuestaDeError, sinRutas } from "@/lib/http";
import { ErrorDeComando } from "@/lib/proceso";

describe("errores de la API en palabras simples (SRV-02)", () => {
  it("la validación sale en español y con 400", () => {
    const r = z.object({ nombre: z.string() }).safeParse({ nombre: 3 });
    const { status, error } = respuestaDeError(r.error);
    expect(status).toBe(400);
    expect(error).toMatch(/^nombre: .*se esperaba texto/);
  });

  it("«no encontrado» de Prisma es un 404 claro", () => {
    const e = Object.assign(new Error("No record was found for an update."), { name: "PrismaClientKnownRequestError", code: "P2025" });
    expect(respuestaDeError(e)).toEqual({ status: 404, error: expect.stringMatching(/ya no existe/) });
  });

  it("un comando fallido no enseña el comando ni su salida", () => {
    const e = new ErrorDeComando("ffmpeg -i /home/x/secreto.mp4", { codigo: 1, stdout: "", stderr: "Invalid data found" });
    const { status, error } = respuestaDeError(e);
    expect(status).toBe(500);
    expect(error).not.toMatch(/ffmpeg|home|Invalid/);
  });

  it("otros errores de Prisma y lo que no es Error dan un 500 genérico", () => {
    const prisma = Object.assign(new Error("Invalid `prisma.proyecto.findMany()` invocation"), { name: "PrismaClientValidationError" });
    expect(respuestaDeError(prisma).status).toBe(500);
    expect(respuestaDeError(prisma).error).not.toMatch(/prisma/);
    expect(respuestaDeError("raro").status).toBe(500);
  });

  it("los mensajes propios se conservan, pero sin rutas absolutas", () => {
    expect(respuestaDeError(new Error("Ese archivo es muy grande"))).toEqual({ status: 400, error: "Ese archivo es muy grande" });
    expect(sinRutas("Ruta fuera de /home/ana/geeper-data/datos/clip.mp4")).toBe("Ruta fuera de «clip.mp4»");
    expect(sinRutas("No existe C:\\Users\\ana\\logo.png")).toBe("No existe «logo.png»");
    expect(sinRutas("Mira https://geeper.local/a/b y 9:16 o 1/2")).toBe("Mira https://geeper.local/a/b y 9:16 o 1/2");
  });

  it("manejar registra el error real y responde con el texto simple", async () => {
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await manejar(async () => {
      throw new ErrorDeComando("uv run algo", { codigo: 2, stdout: "", stderr: "boom" });
    });
    expect(r.status).toBe(500);
    expect((await r.json()).error).not.toMatch(/uv run/);
    expect(espia).toHaveBeenCalledOnce();
    espia.mockRestore();
  });
});
