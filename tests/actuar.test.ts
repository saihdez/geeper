import { describe, expect, it } from "vitest";
import { LIGHTNING_I2V, PedidoActuar, PedidoStreamer, promptAccion, promptComponer, promptPose, proponerEscenas } from "@/lib/actuar";
import { Marco, pista, validarProyecto } from "@/lib/esquema";
import { metricas } from "@/lib/formatos";
import { cajaMarco, estiloMarco, MARGEN_MARCO } from "@/lib/marco";
import { argsRecorte } from "@/lib/presentador";
import { proyectoDePrueba } from "./fixtures";

const realista = { estilo: "realista" as const };

describe("tu avatar en el video: instrucciones para la IA", () => {
  it("encuadre: conserva la cara y la ropa; el verde es plano y sin sombras", () => {
    const p = promptPose(realista, "completo", "verde");
    expect(p).toMatch(/full body shot/);
    expect(p).toMatch(/same face, identity/);
    expect(p).toMatch(/#00FF00/);
    expect(promptPose({ estilo: "anime" }, "medio", "neutro")).toMatch(/waist up/);
  });
  it("componer: el avatar es la imagen 1, la escena la 2 y el producto la 3 (o la 2 si no hay escena)", () => {
    const base = PedidoActuar.parse({ avatar: "sofia-1", tipo: "accion", encuadre: "medio", que: "levanta la botella", lugar: "escena" });
    const con = promptComponer(realista, base, { escena: true, producto: true });
    expect(con).toMatch(/inside the place shown in image 2/);
    expect(con).toMatch(/product from image 3/);
    expect(con).toMatch(/about to do this: levanta la botella/);
    const sinEscena = promptComponer(realista, { ...base, lugar: "estudio" }, { escena: false, producto: true });
    expect(sinEscena).toMatch(/product from image 2/);
    expect(sinEscena).toMatch(/studio background/);
    const habla = promptComponer(realista, { ...base, tipo: "habla", lugar: "describir", donde: "una ciudad de videojuego" }, { escena: false, producto: false });
    expect(habla).toMatch(/in this place: una ciudad de videojuego/);
    expect(habla).toMatch(/about to talk, mouth closed/);
  });
  it("acción: movimiento humano y la misma cara; sin acción, gestos naturales", () => {
    expect(promptAccion({ que: "camina hacia la cámara", encuadre: "completo" })).toMatch(/^The person camina hacia la cámara\. Natural, realistic human motion, consistent face/);
    expect(promptAccion({ que: "", encuadre: "medio" })).toMatch(/small natural gestures/);
  });
  it("Wan 2.2 I2V con Lightning: 4 pasos, dos fases y sus dos aceleradores", () => {
    expect(LIGHTNING_I2V).toMatchObject({ num_inference_steps: 4, guidance_phases: 2, loras_multipliers: "1;0 0;1" });
    expect(LIGHTNING_I2V.activated_loras).toHaveLength(2);
  });
});

describe("Geeper propone dónde sale", () => {
  it("habla en el gancho y en el cierre; actúa en las del medio que hablan de personas", () => {
    const p = proyectoDePrueba();
    p.escenas.e02!.texto = "Imagina que eres el jugador que llega primero.";
    const pr = proponerEscenas(validarProyecto(p), "sofia-1", { producto: "assets/producto-abc.png" });
    expect(pr.map((x) => [x.numero, x.pedido.tipo, x.pedido.encuadre])).toEqual([[1, "habla", "medio"], [2, "accion", "medio"], [3, "habla", "cara"]]);
    expect(pr[1]!.pedido).toMatchObject({ producto: "assets/producto-abc.png", que: expect.stringMatching(/producto/) });
    expect(pr[2]!.pedido.producto).toBe("assets/producto-abc.png");
  });
  it("sin personas en el medio, sólo gancho y cierre; con una escena, sólo el gancho", () => {
    expect(proponerEscenas(proyectoDePrueba(), "a").map((x) => x.numero)).toEqual([1, 3]);
    const una = proyectoDePrueba();
    pista(una, "visual").clips.splice(1);
    pista(una, "voz").clips.splice(1);
    delete una.escenas.e02;
    delete una.escenas.e03;
    expect(proponerEscenas(validarProyecto(una), "a").map((x) => x.numero)).toEqual([1]);
  });
});

describe("streamer: el avatar recortado sobre el video", () => {
  it("figura vertical apoyada abajo, dentro de la banda segura, sin borde y con sombra", () => {
    const m = metricas("9:16");
    const marco = Marco.parse({ forma: "recorte", esquina: "abajo-derecha", tamano: 0.4 });
    const c = cajaMarco(marco, m);
    expect(c.h).toBeGreaterThan(c.w);
    expect(c.x + c.w).toBeLessThanOrEqual(m.segura.x + m.segura.w);
    expect(c.y + c.h).toBe(m.segura.y + m.segura.h - MARGEN_MARCO);
    const css = estiloMarco(marco, m);
    expect(css).toMatch(/object-fit: contain; object-position: 50% 100%/);
    expect(css).not.toMatch(/border/);
  });
  it("quita el verde a un WebM VP9 con transparencia que Hyperframes conserva", () => {
    const a = argsRecorte("in.mp4", "out.webm");
    expect(a[a.indexOf("-vf") + 1]).toMatch(/^chromakey=0x00FF00.*despill.*format=yuva420p$/);
    expect(a).toEqual(expect.arrayContaining(["libvpx-vp9", "yuva420p", "alpha_mode=1", "-an"]));
  });
  it("pedido por defecto: medio cuerpo, abajo a la derecha", () => {
    expect(PedidoStreamer.parse({ avatar: "sofia-1" })).toMatchObject({ encuadre: "medio", lado: "derecha", tamano: 0.4 });
  });
});
