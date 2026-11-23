import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Antes de importar rutas.ts: candado de GPU propio en una carpeta temporal (no el gpu-lock del estudio).
// Y un gpu-solo falso: corre el comando y, al salir (también por SIGTERM), deja «restaurado».
const HERRAMIENTAS = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const tmp = `${process.env.TMPDIR || process.env.TEMP || "/tmp"}/geeper-wan2gp-prueba-${process.pid}`;
  fs.mkdirSync(`${tmp}/bin`, { recursive: true });
  fs.writeFileSync(`${tmp}/bin/gpu-solo`, `#!/usr/bin/env bash\ntrap 'echo ok > "${tmp}/restaurado"' EXIT\ntrap 'exit 130' INT TERM\n"$@"\n`, { mode: 0o755 });
  process.env.GEEPER_HERRAMIENTAS = tmp;
  // Las notas de procesos largos (procesos-largos.ts) van a una carpeta de datos temporal.
  process.env.GEEPER_DATA = `${tmp}/datos`;
  process.env.GEEPER_GPU_LOCK_PROPIO = "1";
  process.env.GPU_LOCK = `${tmp}.lock`;
  return tmp;
});

import { comandosWan2gp, FECHA_CORTE, INDICE_TORCH } from "@/lib/instalar-wan2gp";
import { planearPlano, velocidadParaLlenar } from "@/lib/plano";
import { camaraDe, CAMARAS, LENTES, MOVIMIENTOS, NOMBRES, promptConCamara } from "@/lib/prompt-camara";
import {
  ajustesWan2gp, conValoresDelModelo, crearLectorAvance, cuadrosPara, estadoModelos, faltaEnInstalacion, generarPlano, instalacionWan2gp,
  MODELO_POR_DEFECTO, MODELOS_PLANO, modeloPlano, probarWan2gp, resumirCorrida, rutaGuardada, type Avance,
} from "@/lib/wan2gp";
import { etapaDePlano } from "../worker/ejecutores";
import { proyectoDePrueba } from "./fixtures";

const FALSO = path.join(__dirname, "fixtures-wan2gp");
const falso = () => instalacionWan2gp(FALSO, process.execPath);
const tmp = (p: string) => fs.mkdtemp(path.join(os.tmpdir(), p));
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("ajustes de Wan2GP", () => {
  it("cuadros: múltiplo del bloque + 1, con tope en el máximo del modelo", () => {
    const ti2v = modeloPlano("ti2v");
    expect(cuadrosPara(ti2v, 3)).toBe(73); // 72 cuadros a 24 fps
    expect(cuadrosPara(ti2v, 30)).toBe(121); // 5 s
    expect(cuadrosPara(ti2v, 0)).toBe(5);
    expect(cuadrosPara(modeloPlano("ltx2"), 0.1)).toBe(9);
    expect((cuadrosPara(modeloPlano("i2v"), 2) - 1) % 4).toBe(0);
  });

  it("con imagen manda image_prompt_type S (si no, wgp.py la descarta); resolución según el formato", () => {
    const a = ajustesWan2gp(modeloPlano("ti2v"), { prompt: " olas ", formato: "9:16", segundos: 2, imagen: "/p/assets/img.png", semilla: 7 });
    expect(a).toEqual({ model_type: "ti2v_2_2", prompt: "olas", resolution: "704x1280", video_length: 49, seed: 7, image_prompt_type: "S", image_start: "/p/assets/img.png" });
    const t = ajustesWan2gp(modeloPlano("ti2v"), { prompt: "olas", formato: "16:9", segundos: 2, pasos: 20, negativo: "texto" });
    expect(t.image_prompt_type).toBeUndefined();
    expect(t).toMatchObject({ resolution: "1280x704", num_inference_steps: 20, negative_prompt: "texto" });
    expect(Number(t.seed)).toBeGreaterThanOrEqual(0);
  });

  it("I2V sin imagen no se puede pedir; un modelo desconocido dice cuáles hay", () => {
    expect(() => ajustesWan2gp(modeloPlano("i2v"), { prompt: "x", formato: "1:1", segundos: 2 })).toThrow(/imagen de inicio/);
    expect(() => modeloPlano("sora")).toThrow(/ti2v, i2v, ltx2/);
  });
});

describe("catálogo y valores del modelo", () => {
  it("por defecto, el rápido; a la vista sólo rápido y calidad, ambos con licencia comercial", () => {
    expect(MODELO_POR_DEFECTO).toBe("rapido");
    expect(MODELOS_PLANO.filter((m) => m.simple).map((m) => m.id)).toEqual(["rapido", "ti2v"]);
    for (const m of MODELOS_PLANO.filter((x) => x.simple)) expect(m.licencia).toMatch(/^Apache-2\.0/);
    expect(modeloPlano("ltx2").licencia).toMatch(/^revisar/);
  });

  it("los valores de defaults/<modelo>.json van debajo de lo pedido (sin «model» ni su prompt de ejemplo)", async () => {
    const dir = await tmp("wan2gp-def-");
    await fs.mkdir(path.join(dir, "defaults"));
    await fs.writeFile(path.join(dir, "defaults", "ti2v_2_2_fastwan.json"), JSON.stringify({ model: { name: "x" }, prompt: "clown", num_inference_steps: 3, guidance_scale: 1, flow_shift: 3, video_length: 121 }));
    const a = ajustesWan2gp(modeloPlano("rapido"), { prompt: "olas", formato: "9:16", segundos: 2, semilla: 1 });
    expect(conValoresDelModelo(dir, a)).toEqual({ num_inference_steps: 3, guidance_scale: 1, flow_shift: 3, ...a });
    expect(conValoresDelModelo("/no/existe", a)).toBe(a);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("plan de una escena", () => {
  it("usa el prompt de la imagen de MPT y la duración de la escena", () => {
    const p = proyectoDePrueba();
    p.assets["clip-02"]!.regenerar = { prompt: "decaying lighthouse" };
    const plan = planearPlano(p, "2", { camara: { movimiento: "acercar" } });
    expect(plan).toMatchObject({ escena: "e02", numero: 2, origenPrompt: "imagen", promptBase: "decaying lighthouse", prompt: "decaying lighthouse, camera slowly pushes in", conImagen: true, velocidad: null, avisos: [] });
    expect(plan.segundos).toBeCloseTo(plan.duracionEscena);
    // La primera escena cubre también la entrada en silencio.
    expect(planearPlano(p, "1").largo).toBeCloseTo(planearPlano(p, "1").duracionEscena + 0.3);
  });

  it("un poco más corto se pasa más lento; mucho más corto se repite y avisa", () => {
    const p = proyectoDePrueba();
    const lento = planearPlano(p, "e02", { segundos: 2.5 });
    expect(lento.velocidad).toBeCloseTo(2.5 / lento.largo, 3);
    expect(lento.notas.join(" ")).toMatch(/más lento/);
    expect(lento.avisos).toEqual([]);
    const corto = planearPlano(p, "e02", { segundos: 1 });
    expect(corto.velocidad).toBeNull();
    expect(corto.avisos.join(" ")).toMatch(/se repite/);
    expect(velocidadParaLlenar(5, 5.7)).toBe(0.877);
    expect(velocidadParaLlenar(5, 5)).toBeNull();
    expect(velocidadParaLlenar(2, 6)).toBeNull();
  });

  it("sin prompt guardado usa el texto de la escena y lo dice; lo pedido manda", () => {
    const p = proyectoDePrueba();
    const plan = planearPlano(p, "e01");
    expect(plan.origenPrompt).toBe("texto");
    expect(plan.promptBase).toBe("Escena 1 dice GTA seis.");
    expect(plan.notas[0]).toMatch(/Más opciones/);
    expect(planearPlano(p, "e01", { prompt: " waves " }).promptBase).toBe("waves");
  });

  it("errores claros: escena que no existe, I2V sin imagen, licencia por revisar", () => {
    const p = proyectoDePrueba();
    expect(() => planearPlano(p, "e09")).toThrow(/No hay escena e09 \(hay 3\)/);
    expect(() => planearPlano(p, "e01", { modelo: "i2v", sinImagen: true })).toThrow(/necesita partir de la imagen/);
    expect(planearPlano(p, "e01", { modelo: "ltx2" }).avisos.join(" ")).toMatch(/licencia por revisar/);
  });
});

describe("instalación con un clic", () => {
  it("Python 3.11, PyTorch 2.10 con CUDA 13 y las dependencias con PyTorch fijado", () => {
    const c = comandosWan2gp("/h/Wan2GP", "/h/Wan2GP/venv/bin/python");
    expect(c.map((x) => x.paso)).toEqual(["python", "pytorch", "dependencias"]);
    expect(c[0]!.args).toEqual(["venv", "--python", "3.11", "/h/Wan2GP/venv"]);
    expect(c[1]!.args).toContain("torch==2.10.0");
    expect(c[1]!.args.slice(-2)).toEqual(["--index-url", INDICE_TORCH]);
    // Sin mezclar índices: PyTorch queda fijado por restricciones, no por un índice extra.
    expect(c[2]!.args).toEqual(["pip", "install", "--python", "/h/Wan2GP/venv/bin/python", "-r", "/h/Wan2GP/requirements.txt", "-c", "/h/Wan2GP/venv/geeper-restricciones.txt", "--exclude-newer", FECHA_CORTE]);
    // Nada publicado después del commit fijado (reproducible y sin paquetes de hace minutos).
    expect(FECHA_CORTE).toMatch(/^2026-11-18T/);
    expect(c.flatMap((x) => x.args)).not.toContain("unsafe-best-match");
  });
});

describe("etapas en palabras simples", () => {
  it("lo que se ve en Trabajos", () => {
    expect(etapaDePlano({ fase: "descargando", bytes: 3.2 * 1024 ** 3, avance: 0.02 })).toBe("Bajando el modelo (sólo la primera vez): 3.2 GB");
    expect(etapaDePlano({ fase: "generando", paso: 2, pasos: 3, avance: 0.5 })).toBe("Animando: paso 2 de 3");
    expect(etapaDePlano({ fase: "decodificando", avance: 0.95 })).toBe("Armando el video");
  });
});

describe("salida de wgp.py", () => {
  it("avance por fases, que nunca baja y sin repetir", () => {
    const leer = crearLectorAvance();
    const ev: Avance[] = [
      ...leer("Loading Model x\n  [3/3] Loading weights\n"),
      ...leer("  [1/4] Denoising | 1s\r  [2/4] Denoising | 2s\r  [2/4] Deno"),
      ...leer("ising | 2s\n  [0/12] Loading again\n  [1/1] VAE Decoding\n  Saving File x\n"),
    ];
    expect(ev.map((e) => e.fase)).toEqual(["cargando", "cargando", "generando", "generando", "cargando", "decodificando", "guardando"]);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.avance).toBeGreaterThanOrEqual(ev[i - 1]!.avance);
    expect(ev[3]).toMatchObject({ paso: 2, pasos: 4 });
  });

  it("videos largos por partes (InfiniteTalk): el avance es de todo el video, no se queda en «Cargando»", () => {
    const leer = crearLectorAvance();
    // Líneas reales de wgp.log (presentador de 29 s, 10 partes).
    const ev: Avance[] = [
      ...leer("Loading Model 'ckpts/wan2.1_image2video_480p_14B.safetensors' ...\n  [3/3] Loading - Weights Loaded\n"),
      ...leer("  [0/24] Sliding Window 1/10 - Encoding Text Prompt | 0.2s\n  [0/4] Sliding Window 1/10 - Denoising | 10.0s\n"),
      ...leer("  [1/4] Sliding Window 1/10 - Denoising | 41.4s / 2m 15s\r  [1/4] Sliding Window 1/10 - Denoising | 42.9s / 2m 15s\r"),
      ...leer("  [4/4] Sliding Window 1/10 - VAE Decoding | 2m 08s\n  [0/4] Sliding Window 2/10 - Denoising | 2m 30s\n"),
      ...leer("  [2/4] Sliding Window 10/10 - Denoising | 20m 01s\n"),
    ];
    const partes = ev.filter((e) => e.ventanas);
    expect(partes.every((e) => e.fase === "generando" && e.ventanas === 10)).toBe(true);
    expect(partes.find((e) => e.paso === 1)).toMatchObject({ ventana: 1, paso: 1, pasos: 4 });
    expect(partes.filter((e) => e.ventana === 1 && e.paso === 1)).toHaveLength(1);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.avance).toBeGreaterThanOrEqual(ev[i - 1]!.avance);
    const ultima = partes.at(-1)!;
    expect(ultima).toMatchObject({ ventana: 10, paso: 2 });
    expect(ultima.avance).toBeGreaterThan(0.9);
    expect(etapaDePlano(ultima)).toBe("Generando: parte 10 de 10, paso 2 de 4");
  });

  it("ruta guardada: gana la última (posproceso)", () => {
    expect(rutaGuardada("Video file saved to Path: /o/a.mp4\nRemuxed Video saved to Path: /o/b.mp4 \n")).toBe("/o/b.mp4");
    expect(rutaGuardada("nada")).toBeNull();
  });

  it("éxito sólo con código 0 y la cola completa; si no, explica el fallo", () => {
    expect(resumirCorrida(0, null, "Video file saved to Path: /o/a.mp4\nQueue completed: 1/1 tasks in 3s")).toEqual({ ok: true, ruta: "/o/a.mp4" });
    const parcial = resumirCorrida(0, null, "Queue completed: 0/1 tasks in 3s");
    expect(parcial.ok).toBe(false);
    expect(!parcial.ok && parcial.error).toMatch(/0 de 1/);
    const oom = resumirCorrida(1, null, "Traceback (most recent call last):\ntorch.OutOfMemoryError: CUDA out of memory.");
    expect(!oom.ok && oom.error).toMatch(/sin memoria/);
    const falta = resumirCorrida(1, null, "File not found for 'image_start': /x.png");
    expect(!falta.ok && falta.error).toMatch(/«image_start»: \/x\.png/);
    const exc = resumirCorrida(1, null, "Traceback (most recent call last):\n  File x\nValueError: malo");
    expect(!exc.ok && exc.error).toMatch(/^ValueError: malo/);
    const senal = resumirCorrida(null, "SIGTERM", "");
    expect(!senal.ok && senal.error).toMatch(/se detuvo \(SIGTERM\)/);
  });
});

describe("instalación de Wan2GP", () => {
  it("dice qué falta", () => {
    expect(faltaEnInstalacion(instalacionWan2gp("/no/existe", "/no/python"))).toMatch(/No está Wan2GP/);
    expect(faltaEnInstalacion(instalacionWan2gp(os.tmpdir(), process.execPath))).toMatch(/wgp\.py/);
    expect(faltaEnInstalacion(instalacionWan2gp(FALSO, "/no/python"))).toMatch(/Python/);
    expect(faltaEnInstalacion(falso())).toBeNull();
  });

  it("estado de los modelos: defaults/*.json y pesos en ckpts/", async () => {
    const dir = await tmp("wan2gp-inst-");
    await fs.mkdir(path.join(dir, "defaults"));
    await fs.mkdir(path.join(dir, "ckpts"));
    const def = (urls: unknown) => JSON.stringify({ model: { name: "x", URLs: urls } });
    await fs.writeFile(path.join(dir, "defaults", "ti2v_2_2.json"), def(["https://hf.co/x/resolve/main/wan5b.safetensors", "https://hf.co/x/resolve/main/wan5b_int8.safetensors"]));
    await fs.writeFile(path.join(dir, "defaults", "i2v_2_2.json"), def(["https://hf.co/x/resolve/main/i2v.safetensors"]));
    await fs.writeFile(path.join(dir, "ckpts", "wan5b_int8.safetensors"), "");
    // FastWan («rápido») nombra los pesos de ti2v_2_2 en vez de listarlos.
    await fs.writeFile(path.join(dir, "defaults", "ti2v_2_2_fastwan.json"), def("ti2v_2_2"));
    expect(estadoModelos(instalacionWan2gp(dir, process.execPath))).toEqual({ rapido: "listo", ti2v: "listo", i2v: "sin-pesos", ltx2: "no-existe" });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("correr wgp.py (falso)", () => {
  const ajustes = (prompt: string) => ajustesWan2gp(modeloPlano("ti2v"), { prompt, formato: "9:16", segundos: 2, semilla: 7, imagen: "/p/img.png" });

  it("prueba (--dry-run) sin GPU", async () => {
    const dir = await tmp("wan2gp-prueba-");
    expect(await probarWan2gp(falso(), ajustes("ok"), dir)).toEqual({ ok: true, mensaje: "Wan2GP validó la tarea de prueba." });
    expect((await probarWan2gp(instalacionWan2gp("/no/existe"), ajustes("ok"), dir)).ok).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("genera: escribe los ajustes, avisa el avance, deja el log y devuelve el video", async () => {
    const dir = await tmp("wan2gp-corrida-");
    const ev: Avance[] = [];
    const video = await generarPlano({ instalacion: falso(), ajustes: ajustes("ok"), dirCorrida: dir, gpuSolo: false, alAvanzar: (a) => ev.push(a) });
    expect(video).toBe(path.join(dir, "out", "seed7_ok.mp4"));
    expect(JSON.parse(await fs.readFile(path.join(dir, "ajustes.json"), "utf8"))).toMatchObject({ image_prompt_type: "S", video_length: 49 });
    expect(ev.map((e) => e.fase)).toEqual(["cargando", "generando", "generando", "decodificando", "guardando"]);
    await new Promise((r) => setTimeout(r, 50));
    const log = await fs.readFile(path.join(dir, "wgp.log"), "utf8");
    expect(log).toMatch(/PYTHONUNBUFFERED=1/);
    expect(log).toMatch(/image_start=\/p\/img\.png tipo=S/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("un fallo de wgp.py llega explicado", async () => {
    const dir = await tmp("wan2gp-falla-");
    await expect(generarPlano({ instalacion: falso(), ajustes: ajustes("fail"), dirCorrida: dir, gpuSolo: false })).rejects.toThrow(/sin memoria/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("cancelar mata wgp.py y sus hijos, y suelta la GPU", async () => {
    const dir = await tmp("wan2gp-cancela-");
    const ac = new AbortController();
    const corrida = generarPlano({ instalacion: falso(), ajustes: ajustes("hang"), dirCorrida: dir, gpuSolo: false, signal: ac.signal, alAvanzar: () => ac.abort() });
    await expect(corrida).rejects.toThrow(/se detuvo/);
    const pid = Number(await fs.readFile(path.join(dir, "out", "hijo.pid"), "utf8"));
    for (let i = 0; i < 20 && vivo(pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(vivo(pid)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(process.env.GPU_LOCK!)).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("cancelar con gpu-solo", () => {
  it.skipIf(process.platform === "win32")("si wgp.py no se va con SIGTERM, el SIGKILL es sólo para él: gpu-solo alcanza a restaurar", async () => {
    const dir = await tmp("wan2gp-solo-");
    const ac = new AbortController();
    const a = ajustesWan2gp(modeloPlano("ti2v"), { prompt: "terco", formato: "9:16", segundos: 2, semilla: 7 });
    const corrida = generarPlano({ instalacion: falso(), ajustes: a, dirCorrida: dir, gpuSolo: true, signal: ac.signal, alAvanzar: () => ac.abort() });
    await expect(corrida).rejects.toThrow();
    expect(await fs.readFile(path.join(HERRAMIENTAS, "restaurado"), "utf8")).toBe("ok\n");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("lenguaje de cámara", () => {
  it("arma el prompt con movimiento, cámara, lente, focal y apertura", () => {
    const c = camaraDe({ movimiento: "acercar", camara: "pelicula-16mm", lente: "anamorfico", focal: "35", apertura: "f/1.4" });
    expect(promptConCamara("a lighthouse at dusk", c)).toBe(
      "a lighthouse at dusk, camera slowly pushes in, shot on a classic 16mm film camera, using a classic anamorphic lens at 35mm (natural cinematic perspective), aperture f/1.4, shallow depth of field, creamy bokeh",
    );
    expect(promptConCamara("x", camaraDe({}))).toBe("x");
  });

  it("cada opción tiene su nombre en español", () => {
    expect(Object.keys(NOMBRES.movimiento).sort()).toEqual(Object.keys(MOVIMIENTOS).sort());
    expect(Object.keys(NOMBRES.lente).sort()).toEqual(Object.keys(LENTES).sort());
    expect(Object.keys(NOMBRES.camara).sort()).toEqual(Object.keys(CAMARAS).sort());
  });

  it("rechaza lo que no existe y dice qué hay", () => {
    expect(() => camaraDe({ lente: "ojo-de-pez" })).toThrow(/Lente desconocido: ojo-de-pez \(hay: tilt-shift/);
    expect(() => camaraDe({ focal: "40" })).toThrow(/Focal desconocido/);
  });
});
