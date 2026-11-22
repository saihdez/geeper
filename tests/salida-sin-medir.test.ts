/** WEB-09: refrescar Cuentas o el panel de publicar no mide la IP en internet; se pinta la última medida con su hora. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { textoVpn } from "@/components/cuentas";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-salida-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_DB = path.join(dir, "prueba.db");
process.env.GEEPER_CONFIG = path.join(dir, "config");

let salida: typeof import("@/lib/redes/salida");

beforeAll(async () => {
  execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["db", "push"], { env: process.env, stdio: "ignore" });
  salida = await import("@/lib/redes/salida");
});

describe("verificarSinMedir", () => {
  it("con el VPN requerido no llama al medidor: dice que todavía no se midió", async () => {
    let medidas = 0;
    salida.usarMedidor(async () => {
      medidas++;
      return { ip: "203.0.113.7", pais: "AR", fuente: "prueba", medido: new Date().toISOString() };
    });
    await salida.guardarAjustes({ vpn: "requerido", ipEsperada: "", paisEsperado: "AR" });
    const v = await salida.verificarSinMedir();
    expect(medidas).toBe(0);
    expect(v.ok).toBe(false);
    expect(v.estado).toBe("sin_dato");
    expect(v.detalle).toContain("Medir ahora");
  });

  it("después de medir (publicar, conectar, «Medir ahora») usa esa medida aunque tenga más de 60 s", async () => {
    let medidas = 0;
    const vieja = new Date(Date.now() - 10 * 60_000).toISOString();
    salida.usarMedidor(async () => {
      medidas++;
      return { ip: "203.0.113.7", pais: "AR", fuente: "prueba", medido: vieja };
    });
    await salida.verificarSalida(true);
    expect(medidas).toBe(1);
    // El servidor se reinicia: sin memoria, la lee de la base.
    salida.usarMedidor(async () => {
      medidas++;
      return { ip: "198.51.100.1", pais: "US", fuente: "prueba", medido: new Date().toISOString() };
    });
    const v = await salida.verificarSinMedir();
    expect(medidas).toBe(1);
    expect(v).toMatchObject({ ok: true, estado: "activo", salida: { ip: "203.0.113.7", medido: vieja } });
    expect(await salida.ultimaSalida()).toMatchObject({ ip: "203.0.113.7" });
  });

  it("verificarSalida (publicar) sigue midiendo cuando la medida guardada es vieja", async () => {
    let medidas = 0;
    salida.usarMedidor(async () => {
      medidas++;
      return { ip: "198.51.100.1", pais: "US", fuente: "prueba", medido: new Date().toISOString() };
    });
    const v = await salida.verificarSalida();
    expect(medidas).toBe(1);
    expect(v.estado).toBe("caido");
  });
});

describe("GET /api/cuentas", () => {
  it("no mide la salida aunque la medida guardada sea vieja y el VPN sea requerido", async () => {
    const vieja = new Date(Date.now() - 10 * 60_000).toISOString();
    salida.usarMedidor(async () => ({ ip: "203.0.113.7", pais: "AR", fuente: "prueba", medido: vieja }));
    await salida.verificarSalida(true);
    let medidas = 0;
    salida.usarMedidor(async () => {
      medidas++;
      return { ip: "198.51.100.1", pais: "US", fuente: "prueba", medido: new Date().toISOString() };
    });
    await salida.guardarAjustes({ vpn: "requerido", ipEsperada: "", paisEsperado: "AR" });
    const { GET } = await import("@/app/api/cuentas/route");
    for (let i = 0; i < 3; i++) {
      const r = await GET();
      expect(r.status).toBe(200);
      const j = (await r.json()) as { vpn: { estado: string; salida: { medido: string } } };
      expect(j.vpn).toMatchObject({ estado: "activo", salida: { medido: vieja } });
    }
    expect(medidas).toBe(0);
  });
});

describe("textoVpn", () => {
  it("pinta la hora de la medida junto al aviso", () => {
    expect(textoVpn({ detalle: "VPN: caído", salida: { ip: "1.2.3.4", pais: "US", fuente: "x", medido: "2026-11-22T10:05:00Z" } })).toMatch(/^VPN: caído · medido .*2026/);
    expect(textoVpn({ detalle: "VPN no requerido", salida: null })).toBe("VPN no requerido");
  });
});
