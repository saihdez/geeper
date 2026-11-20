import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { proyectoDePrueba } from "./fixtures";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-procedencia-"));
process.env.GEEPER_DATA = dir;
process.env.GEEPER_COSIGN = path.join(dir, "no-existe", "cosign");

const COSIGN_REAL = path.join(os.homedir(), ".local", "bin", "cosign");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

describe("procedencia in-toto de cada render (C4)", () => {
  it("declara el MP4 y el .srt con su sha256, los assets con origen y licencia, y el QC", async () => {
    const { declaracion, TIPO_PREDICADO, TIPO_STATEMENT } = await import("@/lib/procedencia");
    const p = proyectoDePrueba();
    p.assets["clip-01"]!.regenerar = { modelo: "z-image-turbo", prompt: "un faro", tareaMpt: "t1", imagenesMpt: { "mpt-image-server": "sha256:abc" } };
    p.assets.voz!.regenerar = { modelo: "kokoro-82m", alineacion: { modelo: "whisper-medium", pesos: "f".repeat(64) } };
    const st = declaracion(
      {
        archivos: ["/x/v1.mp4", "/x/v1.srt"],
        proyecto: { slug: "faros", version: 1, hashVersion: "h" },
        p,
        assetsUsados: ["voz", "clip-01"],
        qc: { aprobado: true, reglas: [{ id: "sonoridad", nombre: "x", ok: true, medido: 1, objetivo: "x" }, { id: "visual-ia", nombre: "y", ok: false, aviso: true, medido: 1, objetivo: "y" }] },
        geeper: { version: "0.1.0", commit: "c0ffee" },
        herramientas: { ffmpeg: "6.1", hyperframes: "0.9.27" },
        creado: new Date("2026-11-20T00:00:00Z"),
      },
      { "/x/v1.mp4": "1".repeat(64), "/x/v1.srt": "2".repeat(64) },
    );
    expect(st._type).toBe(TIPO_STATEMENT);
    expect(st.predicateType).toBe(TIPO_PREDICADO);
    expect(st.subject).toEqual([{ name: "v1.mp4", digest: { sha256: "1".repeat(64) } }, { name: "v1.srt", digest: { sha256: "2".repeat(64) } }]);
    const pr = st.predicate as { assets: Record<string, unknown>[]; qc: unknown; geeper: unknown };
    expect(pr.assets).toEqual([
      expect.objectContaining({ id: "voz", source: "mpt", licencia: "x", modelo: "kokoro-82m", pesos: "f".repeat(64) }),
      expect.objectContaining({ id: "clip-01", modelo: "z-image-turbo", prompt: "un faro", tareaMpt: "t1", imagenesMpt: { "mpt-image-server": "sha256:abc" } }),
    ]);
    expect(pr.qc).toEqual({ aprobado: true, reglas: [{ id: "sonoridad", ok: true, aviso: false }, { id: "visual-ia", ok: false, aviso: true }] });
    expect(pr.geeper).toEqual({ version: "0.1.0", commit: "c0ffee" });
  });

  it("escribe el archivo junto al render; sin cosign queda sin firmar y lo dice", async () => {
    const { escribirProcedencia } = await import("@/lib/procedencia");
    const renders = path.join(dir, "p", "renders");
    fs.mkdirSync(renders, { recursive: true });
    fs.writeFileSync(path.join(renders, "v1.mp4"), "video");
    fs.writeFileSync(path.join(renders, "v1.srt"), "subs");
    const log: string[] = [];
    const r = await escribirProcedencia(
      path.join(renders, "v1"),
      { archivos: [path.join(renders, "v1.mp4"), path.join(renders, "v1.srt")], proyecto: { slug: "p", version: 1, hashVersion: null }, p: proyectoDePrueba(), assetsUsados: ["voz"], qc: { aprobado: false, reglas: [] } },
      (l) => log.push(l),
    );
    expect(r).toEqual({ ruta: path.join(renders, "v1.procedencia.json"), firma: null });
    const st = JSON.parse(fs.readFileSync(r!.ruta, "utf8"));
    expect(st.subject[0].digest.sha256).toBe(sha("video"));
    expect(log[0]).toMatch(/sin firmar: cosign no está instalado/);
  });

  it.skipIf(!fs.existsSync(COSIGN_REAL))("con cosign real firma sin red y la verificación detecta un cambio", async () => {
    const { execFileSync } = await import("node:child_process");
    const antes = process.env.GEEPER_COSIGN;
    process.env.GEEPER_COSIGN = COSIGN_REAL;
    vi.resetModules();
    const p = await import("@/lib/procedencia");
    fs.mkdirSync(p.dirClaves(), { recursive: true });
    execFileSync(COSIGN_REAL, ["generate-key-pair"], { cwd: p.dirClaves(), env: { ...process.env, COSIGN_PASSWORD: "" }, stdio: "ignore" });
    const archivo = path.join(dir, "firmar.json");
    fs.writeFileSync(archivo, '{"a":1}\n');
    const f = await p.firmar(archivo);
    expect(f.firma).toBe(`${archivo}.sigstore.json`);
    const verificar = () => execFileSync(COSIGN_REAL, ["verify-blob", "--key", path.join(p.dirClaves(), "cosign.pub"), "--bundle", f.firma!, "--insecure-ignore-tlog=true", archivo], { stdio: "pipe" });
    expect(verificar).not.toThrow();
    fs.writeFileSync(archivo, '{"a":2}\n');
    expect(verificar).toThrow();
    process.env.GEEPER_COSIGN = antes;
    vi.resetModules();
  }, 60_000);

  it("nunca tumba el render: si algo falla, devuelve null y lo registra", async () => {
    const { escribirProcedencia } = await import("@/lib/procedencia");
    const log: string[] = [];
    const r = await escribirProcedencia(path.join(dir, "nada", "v1"), { archivos: [path.join(dir, "nada", "v1.mp4")], proyecto: { slug: "p", version: 1, hashVersion: null }, p: proyectoDePrueba(), assetsUsados: [], qc: { aprobado: true, reglas: [] } }, (l) => log.push(l));
    expect(r).toBeNull();
    expect(log[0]).toMatch(/no se pudo escribir/);
  });
});
