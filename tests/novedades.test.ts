import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compararVersiones, consultar, crearPedidor, informeFresco, leerFuentes, marcarRevisada, tieneNovedades, type Fuente, type Guardada, type Informe } from "@/lib/novedades";

const base: Fuente = { id: "vectorcraft", repo: "storytold/vectorcraft", tipo: "release", como: ["binario", "codigo"], version: "0.24.1", commit: "54f58ff", revisado: "2026-11-19", que: "x" };

describe("novedades de los repos integrados", () => {
  it("el registro del repo es válido y no repite fuentes", async () => {
    const fuentes = await leerFuentes();
    expect(new Set(fuentes.map((f) => f.id)).size).toBe(fuentes.length);
    expect(fuentes.map((f) => f.id)).toEqual(expect.arrayContaining(["photocraft", "vectorcraft", "filmcraft", "effectcraft", "hyperframes", "claude-ads"]));
    // Los archivos que dice que dependen de cada fuente existen (si se mueven, el registro miente).
    for (const f of fuentes) for (const a of f.archivos ?? []) await expect(fs.access(path.join(process.cwd(), a))).resolves.toBeUndefined();
  });

  it("compara versiones por número, no como texto", () => {
    expect(compararVersiones("0.24.10", "0.24.9")).toBeGreaterThan(0);
    expect(compararVersiones("v0.25.0", "0.24.1")).toBeGreaterThan(0);
    expect(compararVersiones("0.24.1", "v0.24.1")).toBe(0);
  });

  it("lista sólo releases más nuevas (sin borradores ni previas) y commits posteriores al revisado", async () => {
    const pedidas: string[] = [];
    const pedir = async (url: string) => {
      pedidas.push(url);
      if (url.includes("/releases")) {
        return [
          { tag_name: "v0.25.0", published_at: "2026-11-25T10:00:00Z", html_url: "u25", body: "Arreglos" },
          { tag_name: "v0.26.0-rc1", published_at: "2026-11-26T10:00:00Z", html_url: "rc", prerelease: true },
          { tag_name: "v0.24.1", published_at: "2026-11-12T10:00:00Z", html_url: "u241" },
        ];
      }
      return [
        { sha: "aaaaaaa1111", html_url: "c1", commit: { message: "fix: trazo\n\ndetalle", committer: { date: "2026-11-21T00:00:00Z" } } },
        { sha: "54f58ff2222", html_url: "c0", commit: { message: "el revisado", committer: { date: "2026-11-19T00:00:00Z" } } },
      ];
    };
    // Con `ruta` se filtra por carpeta: va por fecha (compare no filtra por ruta).
    const n = await consultar({ ...base, ruta: "src" }, pedir);
    expect(n.nuevas.map((r) => r.version)).toEqual(["0.25.0"]);
    expect(n.commits).toEqual([{ sha: "aaaaaaa", fecha: "2026-11-21", mensaje: "fix: trazo", url: "c1" }]);
    expect(pedidas[1]).toContain("since=2026-11-19T00%3A00%3A00Z");
    expect(pedidas[1]).toContain("path=src");
    expect(tieneNovedades(n)).toBe(true);
  });

  it("con un commit fijado lista lo que vino después de ese commit, del más nuevo al más viejo (TER-08)", async () => {
    const pedidas: string[] = [];
    const f: Fuente = { ...base, tipo: "commits", como: ["codigo"] };
    const n = await consultar(f, async (url) => {
      pedidas.push(url);
      return {
        total_commits: 32,
        commits: [
          { sha: "bbbbbbb1", html_url: "c1", commit: { message: "uno", committer: { date: "2026-11-10T00:00:00Z" } } },
          { sha: "ccccccc2", html_url: "c2", commit: { message: "dos", committer: { date: "2026-11-20T00:00:00Z" } } },
        ],
      };
    });
    expect(pedidas).toEqual(["https://api.github.com/repos/storytold/vectorcraft/compare/54f58ff...HEAD"]);
    // El primero tiene fecha anterior a la revisión, pero se fusionó después del commit: cuenta.
    expect(n.commits.map((c) => c.mensaje)).toEqual(["dos", "uno"]);
    expect(n.masCommits).toBe(true);
  });

  it("si GitHub no conoce el commit fijado, cae a la fecha", async () => {
    const pedidas: string[] = [];
    const f: Fuente = { ...base, tipo: "commits", como: ["codigo"] };
    const n = await consultar(f, async (url) => {
      pedidas.push(url);
      if (url.includes("/compare/")) throw new Error("api.github.com respondió 404");
      return [{ sha: "ddddddd", html_url: "c", commit: { message: "x", committer: { date: "2026-11-20T00:00:00Z" } } }];
    });
    expect(n.error).toBeUndefined();
    expect(pedidas[1]).toContain("since=");
    expect(n.commits).toHaveLength(1);
  });

  it("manda el ETag guardado y un 304 devuelve la respuesta anterior sin gastar cuota", async () => {
    const memoria = new Map<string, Guardada>();
    const vistos: (string | undefined)[] = [];
    let llamadas = 0;
    const falso = (async (_url: string, init?: RequestInit) => {
      llamadas++;
      const h = (init?.headers ?? {}) as Record<string, string>;
      vistos.push(h["if-none-match"]);
      if (h["if-none-match"] === '"e1"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify([{ v: 1 }]), { status: 200, headers: { etag: '"e1"' } });
    }) as typeof fetch;
    const pedir = crearPedidor(memoria, falso);
    expect(await pedir("https://api.github.com/x")).toEqual([{ v: 1 }]);
    expect(await pedir("https://api.github.com/x")).toEqual([{ v: 1 }]);
    expect(vistos).toEqual([undefined, '"e1"']);
    expect(llamadas).toBe(2);
  });

  it("un informe con errores vale una hora; uno completo, un día", () => {
    const ahora = Date.parse("2026-11-21T12:00:00Z");
    const hace = (h: number) => new Date(ahora - h * 3600_000).toISOString();
    const nov = (error?: string) => ({ id: "x", repo: "a/b", como: [], que: "", base: { revisado: "2026-11-19" }, nuevas: [], commits: [], masCommits: false, error });
    const completo = (h: number): Informe => ({ fecha: hace(h), novedades: [nov()] });
    const conError = (h: number): Informe => ({ fecha: hace(h), novedades: [nov(), nov("GitHub limitó las consultas por ahora")] });
    expect(informeFresco(completo(5), ahora)).toBe(true);
    expect(informeFresco(completo(25), ahora)).toBe(false);
    expect(informeFresco(conError(0.5), ahora)).toBe(true);
    expect(informeFresco(conError(2), ahora)).toBe(false);
    expect(informeFresco(null, ahora)).toBe(false);
  });

  it("un error de red queda en la fuente y no frena a las demás", async () => {
    const n = await consultar(base, async () => {
      throw new Error("sin red");
    });
    expect(n.error).toBe("sin red");
    expect(tieneNovedades(n)).toBe(false);
  });

  it("npm: versiones publicadas después de la fijada", async () => {
    const f: Fuente = { id: "hyperframes", repo: "heygen-com/hyperframes", tipo: "npm", paquete: "hyperframes", como: ["binario"], version: "0.9.27", revisado: "2026-11-19", que: "x" };
    const n = await consultar(f, async () => ({ time: { created: "2025-01-01", "0.9.27": "2026-10-01T00:00:00Z", "0.9.72": "2026-11-20T00:00:00Z", "1.0.0-beta.1": "2026-11-20T00:00:00Z" } }));
    expect(n.nuevas.map((r) => r.version)).toEqual(["0.9.72"]);
  });

  it("marcar revisada mueve la base y deja el JSON válido", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fuentes-"));
    try {
      const archivo = path.join(dir, "fuentes.json");
      await fs.writeFile(archivo, JSON.stringify({ fuentes: [base] }));
      const f = await marcarRevisada("vectorcraft", { version: "v0.25.0", commit: "aaaaaaa", hoy: "2026-11-25" }, archivo);
      expect(f).toMatchObject({ version: "0.25.0", commit: "aaaaaaa", revisado: "2026-11-25" });
      expect((await leerFuentes(archivo))[0]!.version).toBe("0.25.0");
      await expect(marcarRevisada("no-existe", {}, archivo)).rejects.toThrow(/No hay una fuente/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("fuentes archivadas", () => {
  it("gtavi-claudecode queda archivada (el autor borró el repo) con su motivo", async () => {
    const { leerFuentes } = await import("@/lib/novedades");
    const g = (await leerFuentes()).find((f) => f.id === "gtavi-claudecode");
    expect(g?.archivada?.motivo).toMatch(/borró el repo/);
    expect(g?.commit).toBe("dd95d39");
  });
});
