import { describe, expect, it } from "vitest";
import { aplicarCambios, etiquetaTexto, modelosDeWorkflow, normalizarCatalogo, notasDeWorkflow, salidasDeHistorial, textosDeWorkflow, type GrafoUi } from "@/lib/comfyui";
import { comandosComfyui, COMFYUI_COMMIT } from "@/lib/instalar-comfyui";
import { archivosDeReceta, PREFIJO_HUB, unirHub } from "@/lib/hub-comfy";
import { argsNodos, carpetaNodo, fijadoDe, requisitosSeguros } from "@/lib/nodos-comfy";
import { aviso, bloqueo, explicarRechazo, pasoDeLinea, tipoDeArchivo } from "@/lib/workflows";

const indice = [
  { title: "Image", templates: [
    { name: "image_z_image_turbo", title: "Z-Image Turbo", description: "Texto a imagen", mediaType: "image", models: ["Z-Image"], size: 12e9, openSource: true, thumbnail: ["output/image_z_image_turbo.webp"], usage: 50 },
    { name: "api_kling_video", title: "Kling", openSource: false, usage: 900 },
  ] },
  { title: "Video", templates: [
    { name: "image_z_image_turbo", title: "repetida" },
    { name: "video_ltx_raro", title: "LTX raro", openSource: true, requiresCustomNodes: ["comfyui-kjnodes", "RES4LYF", "QwenVL"] },
    { name: "video_wan_animate2", title: "Wan Animate", openSource: true, requiresCustomNodes: ["ComfyUI-KJNodes"], io: { inputs: [{ nodeId: 7, nodeType: "LoadImage", file: "chica.png", mediaType: "image" }] } },
  ] },
];

describe("catálogo", () => {
  const ws = normalizarCatalogo(indice, { "image_z_image_turbo.webp": "/x", "video_wan_animate2-1.webp": "/y" });
  it("una plantilla en dos categorías sale una vez, con la categoría en español", () => {
    expect(ws.map((w) => w.id)).toEqual(["image_z_image_turbo", "api_kling_video", "video_ltx_raro", "video_wan_animate2"]);
    expect(ws[0]).toMatchObject({ titulo: "Z-Image Turbo", categoria: "Imágenes", tamano: 12e9, local: true, miniaturas: ["image_z_image_turbo.webp"] });
    expect(ws[3]).toMatchObject({ categoria: "Video", miniaturas: ["video_wan_animate2-1.webp"], entradas: [{ nodo: 7, tipo: "LoadImage", archivo: "chica.png", medio: "image" }] });
  });
  it("de pago y con complementos quedan bloqueados con el motivo en palabras simples", () => {
    expect(bloqueo(ws[0]!)).toBeNull();
    expect(bloqueo(ws[1]!)).toMatch(/pago/);
    // kjnodes está en la lista fijada (con otra mayúscula): no bloquea, pide permiso al correr.
    expect(bloqueo(ws.find((w) => w.id === "video_wan_animate2")!)).toBeNull();
    const raro = bloqueo(ws.find((w) => w.id === "video_ltx_raro")!)!;
    expect(raro).toMatch(/RES4LYF \(el registro de comfy marcó/);
    expect(raro).toMatch(/QwenVL \(no está en el registro oficial/);
    expect(raro).not.toMatch(/kjnodes/);
  });
});

describe("nodos de la comunidad", () => {
  it("cada paquete fijado trae versión activa, url del CDN de Comfy y sha256", () => {
    const { fijado } = fijadoDe("comfyui-kjnodes");
    expect(fijado).toMatchObject({ url: expect.stringMatching(/^https:\/\/cdn\.comfy\.org\//), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
  it("ComfyUI arranca sin nodos extra salvo los del workflow, sin repetir carpetas", () => {
    expect(argsNodos([])).toEqual(["--disable-all-custom-nodes"]);
    expect(argsNodos(["ComfyUI-WanVideoWrapper", "comfyui-wanvideowrapper", "comfyui-kjnodes"])).toEqual(["--disable-all-custom-nodes", "--whitelist-custom-nodes", "comfyui-wanvideowrapper", "comfyui-kjnodes"]);
    expect(carpetaNodo("ComfyUI-KJNodes")).toBe("comfyui-kjnodes");
  });
  it("de su requirements.txt sólo pasan paquetes de PyPI: nada de otros índices ni URLs", () => {
    const r = requisitosSeguros([
      "# deps", "pillow>=10.3.0", "color-matcher", "opencv-python-headless[ffmpeg]==4.10.0 ; sys_platform != 'darwin'", "numpy  # comentario",
      "--index-url https://malo.example/simple", "--extra-index-url https://x", "-e .", "-r otros.txt",
      "torch @ https://malo.example/torch.whl", "git+https://github.com/x/y", "./local", "https://x/y.whl",
    ].join("\n"));
    expect(r.lineas).toEqual(["pillow>=10.3.0", "color-matcher", "opencv-python-headless[ffmpeg]==4.10.0 ; sys_platform != 'darwin'", "numpy"]);
    expect(r.quitadas).toHaveLength(8);
  });
});

const grafo: GrafoUi = {
  nodes: [
    { id: 1, type: "CLIPTextEncode", title: "CLIP Text Encode (Positive Prompt)", widgets_values: ["a lighthouse at dusk, cinematic"] },
    { id: 2, type: "CLIPTextEncode", title: "Negative", widgets_values: ["blurry, low quality"] },
    { id: 3, type: "MarkdownNote", widgets_values: ["## How to use\nDownload the models below"] },
    { id: 4, type: "LoadImage", widgets_values: ["example.png", "image"] },
    { id: 5, type: "UNETLoader", properties: { models: [{ name: "z_image_turbo_bf16.safetensors", url: "https://huggingface.co/x/z.safetensors", directory: "diffusion_models" }] }, widgets_values: ["z_image_turbo_bf16.safetensors"] },
    { id: 6, type: "CLIPTextEncode", mode: 4, widgets_values: ["bypassed prompt text"] },
    { id: 7, type: "3301b744-2960-415a-83b0-fe8a89d99fdb", widgets_values: ["a woman talking to camera", 81] },
    { id: 8, type: "VAELoader", properties: { models: [{ name: "../../etc/passwd", url: "https://x/y", directory: "vae" }, { name: "ae.safetensors", url: "http://inseguro/ae", directory: "vae" }] } },
  ],
  definitions: { subgraphs: [{ id: "3301b744-2960-415a-83b0-fe8a89d99fdb", nodes: [
    { id: 20, type: "CLIPLoader", properties: { models: [{ name: "qwen_3_4b.safetensors", url: "https://huggingface.co/x/q.safetensors", directory: "text_encoders" }] } },
    { id: 21, type: "UNETLoader", properties: { models: [{ name: "z_image_turbo_bf16.safetensors", url: "https://huggingface.co/x/z.safetensors", directory: "diffusion_models" }] } },
  ] }] },
};

describe("lo que hay dentro de un workflow", () => {
  it("modelos: también los de subgrafos, sin repetir, sin rutas que salgan de la carpeta ni http", () => {
    expect(modelosDeWorkflow(grafo)).toEqual([
      { nombre: "z_image_turbo_bf16.safetensors", url: "https://huggingface.co/x/z.safetensors", carpeta: "diffusion_models" },
      { nombre: "qwen_3_4b.safetensors", url: "https://huggingface.co/x/q.safetensors", carpeta: "text_encoders" },
    ]);
  });
  it("textos editables: prompts y entradas de subgrafos; no notas, archivos ni nodos salteados", () => {
    expect(textosDeWorkflow(grafo)).toEqual([
      { nodo: "1", indice: 0, etiqueta: "Qué quieres que salga", valor: "a lighthouse at dusk, cinematic" },
      { nodo: "7", indice: 0, etiqueta: "Qué quieres que salga", valor: "a woman talking to camera" },
      { nodo: "2", indice: 0, etiqueta: "Lo que NO quieres que aparezca", valor: "blurry, low quality" },
    ]);
    expect(notasDeWorkflow(grafo)).toEqual(["## How to use\nDownload the models below"]);
    expect(etiquetaTexto({ id: 1, type: "TextEncodeAceStepAudio1.5", title: "Lyrics" })).toBe("Letra");
  });
  it("aplicar cambios no toca el original y rechaza campos que no existen", () => {
    const nuevo = aplicarCambios(grafo, { textos: [{ nodo: "1", indice: 0, valor: "un faro" }], archivos: [{ nodo: 4, nombre: "geeper-x-entrada-4.png" }] });
    expect(nuevo.nodes![0]!.widgets_values).toEqual(["un faro"]);
    expect(nuevo.nodes![3]!.widgets_values).toEqual(["geeper-x-entrada-4.png", "image"]);
    expect(grafo.nodes![0]!.widgets_values).toEqual(["a lighthouse at dusk, cinematic"]);
    expect(() => aplicarCambios(grafo, { textos: [{ nodo: "5", indice: 3, valor: "x" }] })).toThrow(/ya no existe/);
  });
});

describe("ejecución", () => {
  it("salidas del historial: las guardadas; si no guardó nada, sus vistas previas", () => {
    const h = { outputs: { "9": { images: [{ filename: "ComfyUI_0001.png", subfolder: "", type: "output" }, { filename: "tmp.png", type: "temp" }] }, "12": { gifs: [{ filename: "v.mp4", subfolder: "video", type: "output" }] } } };
    expect(salidasDeHistorial(h)).toEqual([{ archivo: "ComfyUI_0001.png", subcarpeta: "", tipo: "images", carpeta: "output" }, { archivo: "v.mp4", subcarpeta: "video", tipo: "gifs", carpeta: "output" }]);
    const soloVista = { outputs: { "5": { images: [{ filename: "ComfyUI_temp_a_00001_.png", subfolder: "", type: "temp" }, { filename: "ComfyUI_temp_a_00001_.png", subfolder: "", type: "temp" }] } } };
    expect(salidasDeHistorial(soloVista)).toEqual([{ archivo: "ComfyUI_temp_a_00001_.png", subcarpeta: "", tipo: "images", carpeta: "temp" }]);
    expect(salidasDeHistorial(undefined)).toEqual([]);
  });
  it("lee el paso de las barras de avance de ComfyUI", () => {
    expect(pasoDeLinea(" 40%|████      | 8/20 [00:12<00:18,  1.50s/it]")).toEqual({ paso: 8, pasos: 20 });
    expect(pasoDeLinea("Prompt executed in 12.3 seconds")).toBeNull();
  });
  it("explica los rechazos en palabras simples", () => {
    expect(explicarRechazo({ error: { type: "missing_node_type", message: "Node 'WanVideoSampler' not found" } })).toMatch(/piezas que no vienen con ComfyUI/);
    expect(explicarRechazo({ error: { message: "Prompt outputs failed validation" }, node_errors: { "5": { errors: [{ message: "Value not in list", details: "ckpt_name: 'x.safetensors' not in []" }] } } })).toMatch(/Value not in list/);
  });
  it("tipos de archivo de las salidas", () => {
    expect(["a.png", "b.mp4", "c.flac", "d.glb"].map(tipoDeArchivo)).toEqual(["imagen", "video", "audio", "otro"]);
  });
});

describe("instalación", () => {
  it("Python 3.12 propio, PyTorch con CUDA 13 y dependencias con PyTorch fijado", () => {
    const c = comandosComfyui("/h/ComfyUI", "/h/ComfyUI/venv/bin/python");
    expect(c.map((x) => x.paso)).toEqual(["python", "pytorch", "dependencias"]);
    expect(c[0]!.args).toEqual(["venv", "--python", "3.12", "/h/ComfyUI/venv"]);
    expect(c[2]!.args).toContain("-c");
    expect(COMFYUI_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("recetas del hub que el paquete no trae", () => {
  const hub = [
    { title: "Image", templates: [
      { name: "image_z_image_turbo", title: "Z" },
      { name: "templates_rob_image_to_real.app", title: "Ilustración a real", requiresCustomNodes: ["comfyui-kjnodes"], thumbnail: ["input/a b.png", "output/res.png"], io: { inputs: [{ nodeId: 14, nodeType: "LoadImage", file: "rob-input.png" }] } },
      { name: "solo_nube", title: "Nube", includeOnDistributions: ["cloud"] },
      { name: "malo", title: "x", io: { inputs: [{ nodeId: 1, nodeType: "LoadImage", file: "../../etc/passwd" }] } },
    ] },
  ];
  it("archivos de una receta: su .json, sus miniaturas y sus ejemplos, sin rutas raras", () => {
    expect(archivosDeReceta(hub[0]!.templates[1]!)).toEqual([
      { nombre: "templates_rob_image_to_real.app.json", repo: "templates/templates_rob_image_to_real.app.json" },
      { nombre: "a b.png", repo: "input/a b.png" },
      { nombre: "res.png", repo: "output/res.png" },
      { nombre: "templates_rob_image_to_real.app-1.webp", repo: "templates/templates_rob_image_to_real.app-1.webp" },
      { nombre: "rob-input.png", repo: "input/rob-input.png" },
    ]);
    expect(archivosDeReceta(hub[0]!.templates[3]!).map((a) => a.nombre)).toEqual(["malo.json", "malo-1.webp"]);
  });
  it("el índice del hub manda; lo del paquete se conserva y lo que falta queda por bajar", () => {
    const u = unirHub({ "image_z_image_turbo.json": "/pip/z.json" }, hub, (r) => `/hub/${r}`, (r) => r === "/hub/templates/solo_nube.json");
    expect(u.extra).toEqual(["templates_rob_image_to_real.app", "solo_nube", "malo"]);
    expect(u.archivos["image_z_image_turbo.json"]).toBe("/pip/z.json");
    expect(u.archivos["solo_nube.json"]).toBe("/hub/templates/solo_nube.json");
    expect(u.archivos["rob-input.png"]).toBe(`${PREFIJO_HUB}input/rob-input.png`);
    // También los ejemplos de las recetas que sí vienen en el paquete (el paquete no trae input/).
    const conEjemplo = [{ title: "I", templates: [{ name: "image_z_image_turbo", io: { inputs: [{ nodeId: 1, nodeType: "LoadImage", file: "lily.png" }] } }] }];
    expect(unirHub({ "image_z_image_turbo.json": "/pip/z.json" }, conEjemplo, (r) => `/hub/${r}`, () => false).archivos["lily.png"]).toBe(`${PREFIJO_HUB}input/lily.png`);
    const ws = normalizarCatalogo(u.indice, u.archivos);
    expect(ws.find((w) => w.id === "solo_nube")!.local).toBe(false);
    expect(ws.find((w) => w.id === "templates_rob_image_to_real.app")).toMatchObject({ local: true, complementos: ["comfyui-kjnodes"] });
    // Miniatura: primero una imagen aunque el índice ponga antes un .mp4; «None» no es un modelo.
    const conVideo = [{ title: "I", templates: [{ name: "glitch", models: ["None"], thumbnail: ["thumbnail/glitch.mp4"] }] }];
    const g = normalizarCatalogo(conVideo, { "glitch.mp4": "hub:thumbnail/glitch.mp4", "glitch-1.webp": "hub:templates/glitch-1.webp", "glitch.json": "/x" })[0]!;
    expect(g.miniaturas).toEqual(["glitch-1.webp", "glitch.mp4"]);
    expect(g.modelos).toEqual([]);
  });
});

describe("recetas experimentales", () => {
  it("MiniMax H3 corre pero queda como experimental (licencia por revisar)", () => {
    const [h3, z] = normalizarCatalogo([{ title: "Video", templates: [{ name: "video_minimax_h3_i2v", title: "MiniMax H3: Image to Video", models: ["MiniMax H3"] }, { name: "z", title: "Z", models: ["Z-Image"] }] }]);
    expect(aviso(h3!)).toMatch(/Experimental/);
    expect(aviso(z!)).toBeNull();
  });
});
