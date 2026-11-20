import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Spec, Validation } from "@cyclonedx/cyclonedx-library";
import { describe, expect, it } from "vitest";
import { chequeoSbom, resumirAuditoria } from "@/lib/doctor-evidencia";
import { compararImagenes, leerImagenes, type ImagenContenedor } from "@/lib/imagenes";
import { construirSbom, MODELOS_SBOM, PROPIEDAD_LOCK, serializarSbom } from "@/lib/sbom";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-evidencia-"));
process.env.GEEPER_DATA = dir;

const h = (c: string) => c.repeat(64);
const imagen = (contenedor: string, digest: string | null, id = `sha256:${h("e")}`): ImagenContenedor => ({ contenedor, imagen: `ollama/ollama:latest`, digest, id });

function sbomDePrueba() {
  return construirSbom({
    version: "0.1.0",
    commit: "abc123def4567890",
    paquetes: {
      MIT: [{ name: "zod", versions: ["4.6.7"] }, { name: "@prisma/client", versions: ["7.10.1"] }],
      "MIT and ISC": [{ name: "raro", versions: ["1.0.0"] }],
      Unknown: [{ name: "sin-licencia", versions: ["0.0.1"] }],
      "OpenRAIL++-M": [{ name: "nombre-libre", versions: ["1.0.0"] }],
    },
    pesos: { "whisper-medium": h("a"), "kokoro-82m-onnx": null },
    imagenes: { "mpt-ollama": imagen("mpt-ollama", `sha256:${h("d")}`), "mpt-image-server": imagen("mpt-image-server", null) },
    ffmpeg: "6.1.1-3ubuntu5",
    fecha: new Date("2026-11-20T12:00:00Z"),
    lock: h("f"),
  });
}

describe("SBOM CycloneDX 1.7 (C2)", () => {
  it("cumple el esquema oficial de CycloneDX 1.7", async () => {
    const texto = serializarSbom(sbomDePrueba());
    expect(await new Validation.JsonStrictValidator(Spec.Version.v1dot7).validate(texto)).toBeNull();
  });

  it("incluye paquetes con purl y licencia, modelos con sha256, imágenes con digest, Craft, ffmpeg y Hyperframes", () => {
    const d = JSON.parse(serializarSbom(sbomDePrueba()));
    const por = (ref: string) => d.components.find((c: { "bom-ref": string }) => c["bom-ref"] === ref);
    expect(d.specVersion).toBe("1.7");
    expect(d.metadata.component.version).toBe("0.1.0+abc123def456");
    expect(d.metadata.properties).toContainEqual({ name: PROPIEDAD_LOCK, value: h("f") });
    expect(por("npm:@prisma/client@7.10.1").purl).toBe("pkg:npm/%40prisma/client@7.10.1");
    expect(por("npm:raro@1.0.0").licenses[0].expression).toBe("(MIT AND ISC)");
    expect(por("npm:sin-licencia@0.0.1").licenses).toBeUndefined();
    expect(por("npm:nombre-libre@1.0.0").licenses[0].license.name).toBe("OpenRAIL++-M");
    expect(por("modelo:whisper-medium")).toMatchObject({ type: "machine-learning-model", hashes: [{ alg: "SHA-256", content: h("a") }] });
    expect(por("modelo:kokoro-82m-onnx").hashes).toBeUndefined();
    expect(por("contenedor:mpt-ollama")).toMatchObject({ type: "container", version: `sha256:${h("d")}` });
    expect(por("contenedor:mpt-image-server").description).toMatch(/Construida en local/);
    expect(por("craft:photocraft").externalReferences[0].url).toMatch(/storytold\/photocraft\/releases/);
    expect(por("hyperframes").version).toBe("0.9.27");
    expect(por("ffmpeg").version).toBe("6.1.1-3ubuntu5");
  });

  it("cada modelo del SBOM está en MODELOS.md con su nombre", () => {
    const md = fs.readFileSync(path.join(process.cwd(), "MODELOS.md"), "utf8");
    for (const m of MODELOS_SBOM) expect(md, m.nombre).toContain(m.nombre);
  });

  it("el doctor avisa si el SBOM falta o es de antes del último cambio de dependencias", async () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-sbom-"));
    fs.writeFileSync(path.join(raiz, "pnpm-lock.yaml"), "lock: 1\n");
    expect((await chequeoSbom(raiz)).detalle).toMatch(/falta/);
    fs.mkdirSync(path.join(raiz, "docs", "sbom"), { recursive: true });
    const escribir = (lock: string) =>
      fs.writeFileSync(path.join(raiz, "docs/sbom/geeper.cdx.json"), JSON.stringify({ metadata: { timestamp: "2026-11-20T00:00:00Z", properties: [{ name: PROPIEDAD_LOCK, value: lock }] } }));
    escribir(h("0"));
    expect(await chequeoSbom(raiz)).toMatchObject({ aviso: true, arreglo: expect.stringMatching(/pnpm run sbom/) });
    const { createHash } = await import("node:crypto");
    escribir(createHash("sha256").update("lock: 1\n").digest("hex"));
    expect(await chequeoSbom(raiz)).toMatchObject({ ok: true, detalle: expect.stringMatching(/al día/) });
  });
});

describe("pnpm audit en el doctor", () => {
  it("avisa con las altas y críticas, y su versión arreglada", () => {
    const c = resumirAuditoria({
      metadata: { vulnerabilities: { high: 1, critical: 0, moderate: 1, low: 0 } },
      advisories: { 1: { module_name: "effect", severity: "high", title: "ReDoS", patched_versions: ">=3.20.0" }, 2: { module_name: "fflate", severity: "moderate", title: "loop" } },
    });
    expect(c).toMatchObject({ aviso: true, detalle: "1 alta(s) o crítica(s): effect (high, arreglado en >=3.20.0)" });
    expect(resumirAuditoria({ metadata: { vulnerabilities: {} } })).toMatchObject({ aviso: false, detalle: "sin vulnerabilidades conocidas" });
  });
});

describe("imágenes Docker de MPT (D3)", () => {
  it("lee digest e id de cada contenedor; los que no existen no cuentan", async () => {
    const llamadas: string[][] = [];
    const docker = async (args: string[]) => {
      llamadas.push(args);
      if (args[0] === "inspect") return { codigo: 1, stdout: `/mpt-ollama\tollama/ollama:latest\tsha256:${h("1")}\n/mpt-image-server\tmoneyprinterturbo-image-server\tsha256:${h("2")}\n`, stderr: "Error: No such object: mpt-kokoro" };
      if (args.at(-1) === `sha256:${h("1")}`) return { codigo: 0, stdout: `["ollama/ollama@sha256:${h("3")}"]`, stderr: "" };
      return { codigo: 0, stdout: "[]", stderr: "" };
    };
    const r = await leerImagenes(docker);
    expect(r).toEqual({
      "mpt-ollama": { contenedor: "mpt-ollama", imagen: "ollama/ollama:latest", digest: `sha256:${h("3")}`, id: `sha256:${h("1")}` },
      "mpt-image-server": { contenedor: "mpt-image-server", imagen: "moneyprinterturbo-image-server", digest: null, id: `sha256:${h("2")}` },
    });
    expect(await leerImagenes(async () => ({ codigo: 1, stdout: "", stderr: "failed to connect to the docker API" }))).toBeNull();
  });

  it("detecta el cambio de imagen por digest (o por id si se construyó en local)", () => {
    const antes = { a: imagen("a", "sha256:" + h("1")), b: imagen("b", null, "sha256:" + h("2")) };
    const ahora = { a: imagen("a", "sha256:" + h("4")), b: imagen("b", null, "sha256:" + h("2")), c: imagen("c", "sha256:" + h("5")) };
    expect(compararImagenes(antes, ahora)).toEqual([{ contenedor: "a", antes: "sha256:" + h("1"), ahora: "sha256:" + h("4") }]);
  });
});
