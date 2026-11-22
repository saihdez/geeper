import { describe, expect, it } from "vitest";
import { reglasDuplicados } from "@/lib/qc";

describe("QC: duplicados en clips de material ajeno (REN-02)", () => {
  it("en un proyecto propio, pasarse de la proporción bloquea", () => {
    const [r] = reglasDuplicados(0.132, [], 0, false);
    expect(r!.id).toBe("duplicados");
    expect(r!.ok).toBe(false);
    expect(r!.aviso).toBeUndefined();
  });

  it("en un clip, la proporción sólo avisa con un texto simple", () => {
    const rs = reglasDuplicados(0.132, [], 0, true);
    const bloqueo = rs.find((r) => r.id === "duplicados")!;
    const aviso = rs.find((r) => r.id === "duplicados-material")!;
    expect(bloqueo.ok).toBe(true);
    expect(aviso.ok).toBe(false);
    expect(aviso.aviso).toBe(true);
    expect(aviso.detalle).toContain("casi no se mueve");
    expect(rs.every((r) => r.ok || r.aviso)).toBe(true);
  });

  it("en un clip, un congelado de 1 s o más sigue bloqueando", () => {
    const rs = reglasDuplicados(0.02, [{ inicio: 4, dur: 1.5 }], 0, true);
    const bloqueo = rs.find((r) => r.id === "duplicados")!;
    expect(bloqueo.ok).toBe(false);
    expect(bloqueo.aviso).toBeUndefined();
    expect(bloqueo.detalle).toContain("1.5 s");
  });
});
