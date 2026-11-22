import { describe, expect, it } from "vitest";
import { intervaloMedia } from "@/components/media";

const fila = (fase: string | null) => ({ instalacion: fase ? { fase: fase as "descargando", progreso: 0, detalle: "" } : null });

describe("Media sondea seguido sólo mientras instala (WEB-08)", () => {
  it("en reposo, 30 s (2 peticiones por minuto en vez de 30)", () => {
    expect(intervaloMedia(null)).toBe(30_000);
    expect(intervaloMedia([fila(null), fila("lista"), fila("error")])).toBe(30_000);
  });
  it("con una app instalándose, 1,5 s", () => {
    for (const f of ["descargando", "verificando", "descomprimiendo"]) expect(intervaloMedia([fila(null), fila(f)])).toBe(1500);
  });
});
