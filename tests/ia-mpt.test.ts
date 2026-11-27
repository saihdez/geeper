import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encenderIaMpt } from "@/lib/ia-mpt";
import { motivoFallo } from "@/lib/titulos";

/**
 * `docker` falso: cada contenedor es un archivo en `dir` con «true» o «false»; sin archivo, no existe.
 * Anota cada llamada en `dir/llamadas`. Nada de Docker real.
 */
async function dockerFalso(estado: Record<string, boolean>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-docker-"));
  for (const [c, v] of Object.entries(estado)) await fs.writeFile(path.join(dir, c), String(v));
  const bin = path.join(dir, "docker");
  await fs.writeFile(
    bin,
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/llamadas"
case "$1" in
  inspect) c="$4"; [ -f "${dir}/$c" ] || { echo "Error: No such object: $c" >&2; exit 1; }; cat "${dir}/$c"; echo;;
  start) echo true > "${dir}/$2"; echo "$2";;
  exec) [ "$(cat "${dir}/$2" 2>/dev/null)" = true ] || { echo "container $2 is not running" >&2; exit 1; };;
esac
`,
    { mode: 0o755 },
  );
  const llamadas = async () => (await fs.readFile(path.join(dir, "llamadas"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  return { bin, llamadas };
}

describe.skipIf(process.platform === "win32")("encenderIaMpt (GPU-02)", () => {
  it("enciende sólo los que quedaron parados y espera a que Ollama responda", async () => {
    const d = await dockerFalso({ "mpt-ollama": false, "mpt-image-server": true });
    const r = await encenderIaMpt({ docker: d.bin });
    expect(r).toEqual({ encendidos: ["mpt-ollama"], faltan: [] });
    const ll = await d.llamadas();
    expect(ll.filter((l) => l.startsWith("start"))).toEqual(["start mpt-ollama"]);
    expect(ll.at(-1)).toBe("exec mpt-ollama ollama list");
  });

  it("si están encendidos no toca nada; si no existen, lo dice", async () => {
    const d = await dockerFalso({ "mpt-ollama": true });
    const r = await encenderIaMpt({ docker: d.bin });
    expect(r).toEqual({ encendidos: [], faltan: ["mpt-image-server"] });
    expect((await d.llamadas()).some((l) => l.startsWith("start"))).toBe(false);
  });

  it("sin Docker no lanza: avisa", async () => {
    const r = await encenderIaMpt({ docker: "/no/existe/docker" });
    expect(r.sinDocker).toBe(true);
  });
});

describe("motivoFallo de títulos", () => {
  it("un contenedor parado no manda a abrir Docker Desktop", () => {
    expect(motivoFallo("Error response from daemon: container abc is not running")).toMatch(/no está encendida/);
    expect(motivoFallo("Error response from daemon: No such container: mpt-ollama")).toMatch(/no está encendida/);
  });
  it("Docker apagado y modelo que falta", () => {
    expect(motivoFallo("Cannot connect to the Docker daemon at unix:///var/run/docker.sock")).toMatch(/Docker Desktop/);
    expect(motivoFallo("Error: model 'gemma4:12b' not found")).toMatch(/Falta el modelo/);
  });
});
