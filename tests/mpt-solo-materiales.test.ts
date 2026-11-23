/** TER-06 completo: con GEEPER_MPT_SOLO_MATERIALES=1, MPT para al tener los materiales (cli.py por docker exec). */
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ llamadas: [] as string[][], respuestas: [] as { codigo: number; stdout: string }[] }));
vi.mock("@/lib/proceso", async (orig) => ({
  ...(await orig<typeof import("@/lib/proceso")>()),
  correr: async (_c: string, args: string[]) => (m.llamadas.push(args), { stderr: "", ...(m.respuestas.shift() ?? { codigo: 1, stdout: "" }) }),
}));
vi.mock("@/lib/ia-mpt", () => ({ encenderIaMpt: async () => ({ encendidos: [] }) }));

const { argsCli, crearVideo, cuerpoVideo, estadoTarea, leerEstadoCli, logCli, soloMateriales } = await import("@/lib/mpt");
const { PLANTILLAS_INICIALES } = await import("@/lib/plantillas");

const cuerpo = cuerpoVideo("Un tema", "9:16", PLANTILLAS_INICIALES[0]!.datos.mpt, "Hola mundo");
const AYUDA_CON_MATERIALES = "usage: cli.py [--stop-at {script,terms,audio,subtitle,materials,video}]\n  materials  Download online materials";
const guion = JSON.stringify({ script: "Hola mundo", material_sources: [{ local_file: "a.mp4" }] });

function apiFalsa() {
  const pedidos: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    pedidos.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/videos")) return new Response(JSON.stringify({ data: { task_id: "api-1" } }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  return pedidos;
}

afterEach(() => {
  m.llamadas = [];
  m.respuestas = [];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("interruptor GEEPER_MPT_SOLO_MATERIALES (TER-06)", () => {
  it("está apagado por defecto y sólo se enciende con 1", () => {
    expect(soloMateriales({})).toBe(false);
    expect(soloMateriales({ GEEPER_MPT_SOLO_MATERIALES: "0" })).toBe(false);
    expect(soloMateriales({ GEEPER_MPT_SOLO_MATERIALES: "1" })).toBe(true);
  });

  it("apagado: pide el video por la API, como siempre, sin tocar cli.py", async () => {
    vi.stubEnv("GEEPER_MPT_SOLO_MATERIALES", "");
    const pedidos = apiFalsa();
    expect(await crearVideo(cuerpo)).toBe("api-1");
    expect(pedidos).toEqual([expect.stringMatching(/^POST .*\/api\/v1\/videos$/)]);
    expect(m.llamadas).toEqual([]);
  });

  it("encendido: lanza cli.py --stop-at materials en el contenedor y no llama a /videos", async () => {
    vi.stubEnv("GEEPER_MPT_SOLO_MATERIALES", "1");
    const pedidos = apiFalsa();
    m.respuestas = [{ codigo: 0, stdout: AYUDA_CON_MATERIALES }, { codigo: 0, stdout: "" }, { codigo: 0, stdout: "corriendo 5\n" }];
    const id = await crearVideo(cuerpo);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pedidos).toEqual([]);
    const lanzar = m.llamadas[1]!;
    expect(lanzar.slice(0, 2)).toEqual(["exec", "-d"]);
    expect(lanzar).toContain(logCli(id));
    expect(lanzar.join(" ")).toContain(`--task-id ${id} --stop-at materials`);
  });

  it("encendido pero el MPT que corre no trae la parada en materials: vuelve a la API", async () => {
    vi.stubEnv("GEEPER_MPT_SOLO_MATERIALES", "1");
    const pedidos = apiFalsa();
    m.respuestas = [{ codigo: 2, stdout: "" }];
    const avisos: string[] = [];
    expect(await crearVideo(cuerpo, (l) => avisos.push(l))).toBe("api-1");
    expect(pedidos).toHaveLength(1);
    expect(avisos.join("\n")).toContain("se pide el video completo por la API");
  });

  it("los argumentos de cli.py repiten el pedido de la API, sin música ni subtítulos de MPT", () => {
    const a = argsCli("id-1", cuerpo);
    const valor = (k: string) => a[a.indexOf(k) + 1];
    expect(a.slice(0, 4)).toEqual(["--task-id", "id-1", "--stop-at", "materials"]);
    expect(valor("--video-subject")).toBe("Un tema");
    expect(valor("--video-script")).toBe("Hola mundo");
    expect(valor("--voice-name")).toBe(cuerpo.voice_name);
    expect(valor("--video-aspect")).toBe("9:16");
    expect(valor("--video-source")).toBe(cuerpo.video_source);
    expect(valor("--bgm-type")).toBe("none");
    expect(a).toContain("--no-subtitle-enabled");
    expect(argsCli("id-2", cuerpoVideo("Tema", "1:1", PLANTILLAS_INICIALES[0]!.datos.mpt))).not.toContain("--video-script");
  });
});

describe("estado de una tarea de cli.py (TER-06)", () => {
  it("lee lo que devuelve el contenedor", () => {
    expect(leerEstadoCli(3, "")).toBeNull();
    expect(leerEstadoCli(0, "corriendo 40\n")).toEqual({ corriendo: true, progreso: 40 });
    expect(leerEstadoCli(0, "terminada\nERROR materials failed\n")).toEqual({ corriendo: false, log: "ERROR materials failed" });
  });

  it("mientras cli.py corre está «procesando», aunque script.json ya liste algunos clips", async () => {
    apiFalsa();
    m.respuestas = [{ codigo: 0, stdout: "corriendo 40\n" }];
    expect(await estadoTarea("t1")).toEqual({ estado: "procesando", progreso: 40 });
    expect(m.llamadas).toHaveLength(1);
  });

  it("cuando termina con el guion, la voz y los clips: completa (y la tarjeta se suelta ya: no hay video final)", async () => {
    apiFalsa();
    m.respuestas = [{ codigo: 0, stdout: "terminada\n" }, { codigo: 1, stdout: "" }, { codigo: 0, stdout: guion }, { codigo: 0, stdout: "" }];
    expect(await estadoTarea("t1")).toEqual({ estado: "completa", progreso: 100 });
  });

  it("si termina sin los materiales: fallida, con lo último de su log", async () => {
    apiFalsa();
    m.respuestas = [{ codigo: 0, stdout: "terminada\nCLI task failed: stage=materials\n" }, { codigo: 1, stdout: "" }, { codigo: 1, stdout: "" }];
    const e = await estadoTarea("t1");
    expect(e.estado).toBe("fallida");
    expect(e.detalle).toContain("stage=materials");
  });
});
