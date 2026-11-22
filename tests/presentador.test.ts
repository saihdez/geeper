import { describe, expect, it } from "vitest";
import { compilar, segmentosVisuales } from "@/lib/compilador";
import { aplicarEdicion } from "@/lib/ediciones";
import { Marco, pista, validarProyecto, type Asset } from "@/lib/esquema";
import { caracteresPorLinea, metricas } from "@/lib/formatos";
import { ENTRADA, escenasEnLinea } from "@/lib/linea";
import { cajaMarco, estiloMarco, MARGEN_MARCO, MAX_ANCHO_ABAJO } from "@/lib/marco";
import { PLANTILLAS_INICIALES } from "@/lib/plantillas";
import { ajustesHablar, aplicarPresentador, vocesDe, argsAudio, cuadrosHablar, estadoPresentador, LORA_HABLAR, MAX_SEGUNDOS, MODELO_HABLAR, PISTA_PRESENTADOR, planearPresentador } from "@/lib/presentador";
import { proyectoDePrueba } from "./fixtures";

const plantilla = PLANTILLAS_INICIALES[0]!.datos;
const asset = (plan: ReturnType<typeof planearPresentador>): Asset => ({
  id: "avatar-abc123def456", tipo: "video", ruta: "assets/avatar-abc123def456.mp4", hash: "b".repeat(64), source: "wan", licencia: "Apache-2.0",
  duracion: plan.segundos, ancho: 480, alto: 832, regenerar: { motor: MODELO_HABLAR, avatar: "sofia-1a2b", modo: plan.modo, huella: plan.huella },
});

describe("presentador: plan", () => {
  it("pantalla: el audio de cada escena elegida sin recortes, después de la entrada", () => {
    const p = proyectoDePrueba();
    const plan = planearPresentador(p, { avatar: "sofia-1a2b", modo: "pantalla", escenas: ["e01", "e03"] });
    expect(plan.escenas.map((e) => e.numero)).toEqual([1, 3]);
    expect(plan.silencioInicial).toBe(ENTRADA);
    expect(plan.tramos).toEqual([
      { asset: "voz", inicio: 0, duracion: 3, escena: "e01", offset: ENTRADA },
      { asset: "voz", inicio: 6, duracion: 3, escena: "e03", offset: ENTRADA + 3 },
    ]);
    expect(plan.segundos).toBeCloseTo(6.3);
    expect(plan.resolucion).toBe("480x832");
    expect(plan.marco).toBeNull();
  });

  it("burbuja: la voz tal como suena en el video (con los recortes) y el marco por defecto", () => {
    const p = aplicarEdicion(proyectoDePrueba(), { tipo: "recortarPalabras", escena: "e02", desde: 1, hasta: 2 });
    const plan = planearPresentador(p, { avatar: "a-1", modo: "burbuja" });
    const total = escenasEnLinea(p).reduce((s, e) => s + e.duracion, 0);
    expect(plan.segundos).toBeCloseTo(ENTRADA + total);
    expect(plan.tramos.length).toBeGreaterThan(3); // la escena 2 quedó en dos tramos
    expect(plan.marco).toEqual(Marco.parse({}));
    expect(plan.resolucion).toBe("480x640");
  });

  it("cuadros 4k+1 a 25 fps que cubren la voz", () => {
    expect(cuadrosHablar(4)).toBe(101);
    expect(cuadrosHablar(6.3)).toBe(161);
    expect((cuadrosHablar(33.3) - 1) % 4).toBe(0);
    expect(cuadrosHablar(33.3) / 25).toBeGreaterThanOrEqual(33.3);
  });

  it("errores claros: sin escenas, escenas que no existen, demasiado largo", () => {
    const p = proyectoDePrueba();
    expect(() => planearPresentador(p, { avatar: "a", modo: "pantalla", escenas: ["zz"] })).toThrow(/ya no está/);
    const largo = proyectoDePrueba();
    pista(largo, "voz").clips[0]!.rango.duracion = MAX_SEGUNDOS + 5;
    largo.assets.voz!.duracion = MAX_SEGUNDOS + 20;
    expect(() => planearPresentador(largo, { avatar: "a", modo: "burbuja" })).toThrow(/admite hasta/);
  });

  it("ajustes de InfiniteTalk: imagen en image_refs (0KI), audio en audio_guide, acelerador de 4 pasos", () => {
    const plan = planearPresentador(proyectoDePrueba(), { avatar: "a", modo: "pantalla", escenas: ["e01"] });
    const a = ajustesHablar(plan, "/r.png", "/v.wav", "normal", 5);
    expect(a).toMatchObject({ model_type: "infinitetalk", image_prompt_type: "", image_refs: ["/r.png"], video_prompt_type: "0KI", audio_guide: "/v.wav", audio_prompt_type: "A", video_length: plan.cuadros, sliding_window_size: 81, activated_loras: [LORA_HABLAR], num_inference_steps: 4, seed: 5 });
    expect(a).not.toHaveProperty("image_start");
  });
});

describe("presentador: audio para InfiniteTalk", () => {
  it("recorta, concatena, pone el silencio inicial y sale mono a 16 kHz", () => {
    const plan = planearPresentador(proyectoDePrueba(), { avatar: "a", modo: "pantalla", escenas: ["e01", "e02"] });
    const args = argsAudio(plan, { voz: "/p/assets/voz.mp3" }, "/o.wav");
    expect(args.filter((x) => x === "-i")).toHaveLength(1);
    const f = args[args.indexOf("-filter_complex") + 1]!;
    expect(f).toContain("[0:a]atrim=start=0.0000:duration=3.0000");
    expect(f).toContain("[0:a]atrim=start=3.0000:duration=3.0000");
    expect(f).toContain("concat=n=2:v=0:a=1,adelay=delays=300:all=1[a]");
    expect(args.slice(-5)).toEqual(["-ac", "1", "-ar", "16000", "/o.wav"]);
  });

  it("sin la ruta de un audio, falla antes de llamar a ffmpeg", () => {
    const plan = planearPresentador(proyectoDePrueba(), { avatar: "a", modo: "burbuja" });
    expect(() => argsAudio(plan, {}, "/o.wav")).toThrow(/Falta el audio voz/);
  });
});

describe("presentador: en el proyecto", () => {
  it("pantalla: el clip de la escena pasa al avatar en sincro con la voz y la boca sigue a la voz con recortes", () => {
    const p = proyectoDePrueba();
    const plan = planearPresentador(p, { avatar: "a", modo: "pantalla", escenas: ["e01", "e03"] });
    const nuevo = aplicarPresentador(p, plan, asset(plan));
    const vis = pista(nuevo, "visual").clips;
    expect(vis[0]).toMatchObject({ asset: "avatar-abc123def456", sincro: "voz", rango: { inicio: ENTRADA, duracion: 3 } });
    expect(vis[1]!.asset).toBe("clip-02");
    expect(vis[2]).toMatchObject({ asset: "avatar-abc123def456", rango: { inicio: ENTRADA + 3 } });
    expect(nuevo.assets["clip-01"]).toBeUndefined(); // ya no lo usa nadie
    // La primera escena cubre la entrada con el silencio inicial del propio video, sin saltos.
    const e0 = escenasEnLinea(nuevo)[0]!;
    expect(segmentosVisuales(e0, nuevo.assets["avatar-abc123def456"]!, 1, ENTRADA)).toEqual([{ t: -ENTRADA, dur: 3 + ENTRADA, desde: 0 }]);
    // Recortar una palabra de la escena 3 después: imagen y voz se cortan en el mismo lugar del audio.
    const recortado = aplicarEdicion(nuevo, { tipo: "recortarPalabras", escena: "e03", desde: 2, hasta: 3 });
    const e2 = escenasEnLinea(recortado)[2]!;
    const segs = segmentosVisuales(e2, recortado.assets["avatar-abc123def456"]!, 1, 0);
    for (const [k, s] of segs.entries()) expect(s.desde).toBeCloseTo(ENTRADA + 3 + (e2.tramos[k]!.inicio - 6));
    // Recortar no lo deja viejo (la imagen se recorta igual); cambiar la voz de una escena, sí.
    const conVoces = (x: typeof recortado) => {
      const y = structuredClone(x);
      y.assets["avatar-abc123def456"]!.regenerar.voces = vocesDe(p, plan);
      return y;
    };
    expect(estadoPresentador(conVoces(recortado))).toMatchObject({ burbuja: false, escenas: ["e01", "e03"], viejo: false, avatar: "sofia-1a2b" });
    const otraVoz = conVoces(recortado);
    pista(otraVoz, "voz").clips[2]!.rango = { inicio: 6, duracion: 2.5 };
    expect(estadoPresentador(otraVoz).viejo).toBe(true);
  });

  it("burbuja: una pista libre con marco que empieza en 0 y dura toda la voz; el estado avisa si la voz cambió", () => {
    const p = proyectoDePrueba();
    const plan = planearPresentador(p, { avatar: "a", modo: "burbuja", marco: { esquina: "arriba-izquierda" } });
    const nuevo = aplicarPresentador(p, plan, asset(plan));
    const c = pista(nuevo, PISTA_PRESENTADOR).clips;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ inicio: 0, rango: { inicio: 0, duracion: plan.segundos }, marco: { esquina: "arriba-izquierda", forma: "circulo" } });
    expect(estadoPresentador(nuevo)).toMatchObject({ burbuja: true, viejo: false });
    const otro = aplicarEdicion(nuevo, { tipo: "recortarPalabras", escena: "e01", desde: 0, hasta: 1 });
    expect(estadoPresentador(otro).viejo).toBe(true);
    // Generarlo otra vez reemplaza la burbuja anterior (no se apilan).
    const plan2 = planearPresentador(otro, { avatar: "a", modo: "burbuja" });
    const segundo = aplicarPresentador(otro, plan2, { ...asset(plan2), id: "avatar-999999999999", hash: "c".repeat(64) });
    expect(pista(segundo, PISTA_PRESENTADOR).clips.map((x) => x.asset)).toEqual(["avatar-999999999999"]);
    expect(segundo.assets["avatar-abc123def456"]).toBeUndefined();
  });

  it("la burbuja se compila como un recuadro en la esquina, dentro de la banda segura", () => {
    const p = proyectoDePrueba();
    const plan = planearPresentador(p, { avatar: "a", modo: "burbuja" });
    const { html } = compilar(validarProyecto(aplicarPresentador(p, plan, asset(plan))), plantilla, "/tmp/m.wav", "/tmp/p");
    const caja = cajaMarco(plan.marco!, metricas("9:16"));
    expect(html).toMatch(/class="clip superpuesta marco"/);
    expect(html).toContain(`left: ${caja.x}px; top: ${caja.y}px; width: ${caja.w}px; height: ${caja.h}px; border-radius: 50%`);
    // Va abajo a la derecha: los subtítulos se corren a su izquierda, sin taparla.
    const s = metricas("9:16", { burbuja: caja }).subs;
    expect(s.x + s.w).toBeLessThanOrEqual(caja.x);
    expect(html).toContain(`#subtitulos { position: absolute; left: ${s.x}px; top: ${s.y}px; width: ${s.w}px;`);
  });
});

describe("marco", () => {
  const m = metricas("9:16");
  it("en las esquinas de la banda segura: arriba, debajo de la marca; abajo, en el borde de abajo", () => {
    for (const esquina of ["abajo-derecha", "abajo-izquierda", "arriba-derecha", "arriba-izquierda"] as const) {
      const c = cajaMarco(Marco.parse({ esquina }), m);
      expect(c.x).toBeGreaterThanOrEqual(m.segura.x);
      expect(c.x + c.w).toBeLessThanOrEqual(m.segura.x + m.segura.w);
      expect(c.y).toBeGreaterThan(m.marcaTop);
      if (esquina.startsWith("arriba")) expect(c.y + c.h).toBeLessThanOrEqual(m.subs.y);
      else expect(c.y + c.h).toBe(m.segura.y + m.segura.h - MARGEN_MARCO);
    }
  });

  it("abajo, los subtítulos se corren al lado de la burbuja (más angostos) y no se tapan", () => {
    for (const esquina of ["abajo-derecha", "abajo-izquierda"] as const) {
      for (const tamano of [0.26, 0.34, 0.45]) {
        const c = cajaMarco(Marco.parse({ esquina, tamano }), m);
        expect(c.w).toBeLessThanOrEqual(Math.round(m.segura.w * MAX_ANCHO_ABAJO));
        const s = metricas("9:16", { burbuja: c }).subs;
        expect(s.x + s.w <= c.x || s.x >= c.x + c.w).toBe(true);
        expect(s.w).toBeGreaterThan(m.subs.w * 0.5);
        expect(caracteresPorLinea("9:16", { burbuja: c })).toBeLessThan(caracteresPorLinea("9:16"));
      }
    }
    // Arriba no cambia nada.
    const arriba = cajaMarco(Marco.parse({ esquina: "arriba-derecha" }), m);
    expect(metricas("9:16", { burbuja: arriba }).subs).toEqual(m.subs);
  });

  it("círculo cuadrado; rectángulo 3:4 con esquinas redondeadas", () => {
    const c = cajaMarco(Marco.parse({ forma: "circulo", tamano: 0.3 }), m);
    expect(c.w).toBe(c.h);
    const r = cajaMarco(Marco.parse({ forma: "redondeado", tamano: 0.3 }), m);
    expect(r.h).toBe(Math.round((r.w * 4) / 3));
    expect(estiloMarco(Marco.parse({ forma: "redondeado" }), m)).not.toContain("50%");
  });

  it("si no entra, se achica (arriba, entre la marca y los subtítulos; abajo, dentro de la banda)", () => {
    const m16 = metricas("16:9");
    const c = cajaMarco(Marco.parse({ tamano: 0.6, forma: "redondeado", esquina: "arriba-derecha" }), m16);
    expect(c.y + c.h).toBeLessThanOrEqual(m16.subs.y);
    expect(c.y).toBeGreaterThanOrEqual(m16.segura.y);
    const d = cajaMarco(Marco.parse({ tamano: 0.6, forma: "redondeado", esquina: "abajo-derecha" }), m16);
    expect(d.y).toBeGreaterThanOrEqual(m16.segura.y);
    expect(d.y + d.h).toBeLessThanOrEqual(m16.segura.y + m16.segura.h);
  });
});
