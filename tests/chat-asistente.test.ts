import { describe, expect, it } from "vitest";
import { buscarAcciones, intencion, limpiarRespuestaChat, PedidoChat, promptChat, type AccionChat } from "@/lib/chat-asistente";
import { DESTINOS } from "@/lib/destinos";

/** Las del editor (acciones-proyecto.ts) y las secciones, como las ve el chat. */
const ACCIONES: AccionChat[] = [
  { id: "render", grupo: "Este proyecto", titulo: "Crear el video", palabras: "render renderizar exportar generar terminar control calidad qc revision" },
  { id: "silencios", grupo: "Este proyecto", titulo: "Acortar silencios largos", palabras: "pausas quitar silencio ritmo" },
  { id: "muletillas", grupo: "Este proyecto", titulo: "Quitar muletillas (eh, em, mmm…)", palabras: "muletillas relleno eh este" },
  { id: "formato:16:9", grupo: "Este proyecto", titulo: "Cambiar a horizontal 16:9 (YouTube)", palabras: "formato tamaño 16:9 horizontal youtube ancho pantalla" },
  { id: "voz", grupo: "Este proyecto", titulo: "Regenerar la voz de todo el guion", palabras: "voz audio narracion locucion tts" },
  ...DESTINOS.map((d) => ({ id: `ir:${d.ruta}`, grupo: "Ir a", titulo: d.titulo, palabras: d.palabras })),
];
const primera = (m: string) => buscarAcciones(m, ACCIONES)[0]?.id;

describe("chat del asistente: entender sin IA", () => {
  it.each([
    ["quita los silencios", "silencios"],
    ["quiero quitar las muletillas por favor", "muletillas"],
    ["ponlo horizontal para youtube", "formato:16:9"],
    ["sacar clips de un directo largo", "ir:/clips"],
    ["quiero un avatar que presente", "ir:/avatares"],
    ["crea el video", "render"],
    ["cambia la voz", "voz"],
    ["hacer una invitación de cumpleaños", "ir:/invitaciones"],
  ])("«%s» → %s", (mensaje, id) => {
    expect(primera(mensaje)).toBe(id);
  });

  it("lo que no tiene que ver con Geeper no encuentra nada", () => {
    expect(buscarAcciones("receta de pizza napolitana", ACCIONES)).toEqual([]);
    expect(buscarAcciones("por favor", ACCIONES)).toEqual([]);
  });

  it("reconoce saludos, agradecimientos, pedidos de consejo y de ayuda", () => {
    expect(intencion("hola")).toBe("saludo");
    expect(intencion("¡Gracias!")).toBe("gracias");
    expect(intencion("¿Qué le falta a mi video?")).toBe("recomendar");
    expect(intencion("qué hago ahora")).toBe("recomendar");
    expect(intencion("¿qué puedes hacer?")).toBe("ayuda");
    expect(intencion("quita los silencios")).toBeNull();
  });
});

describe("chat del asistente: con la IA local", () => {
  const pedido = PedidoChat.parse({
    mensaje: "¿cómo hago que se vea más profesional?",
    pagina: "Editor del proyecto «Faros»",
    acciones: ACCIONES.slice(0, 3).map(({ id, titulo }) => ({ id, titulo })),
    recomendaciones: ["Pon el gancho escrito en los primeros 2,6 s"],
  });

  it("el prompt lleva la página, las recomendaciones y los ids que puede usar", () => {
    const p = promptChat(pedido);
    expect(p).toContain("Editor del proyecto «Faros»");
    expect(p).toContain("- silencios: Acortar silencios largos");
    expect(p).toContain("«Pon el gancho escrito");
    expect(p.trimEnd().endsWith('{"respuesta": "tu respuesta", "acciones": ["id", ...]}')).toBe(true);
  });

  it("sólo deja acciones que existen: la IA no puede inventar botones", () => {
    const r = limpiarRespuestaChat({ respuesta: "  Acorta las pausas.\n", acciones: ["silencios", "borrar-todo", "silencios", "render", "muletillas", "voz"] }, ["silencios", "render", "muletillas"]);
    expect(r).toEqual({ respuesta: "Acorta las pausas.", acciones: ["silencios", "render", "muletillas"] });
    expect(limpiarRespuestaChat({ respuesta: "", acciones: [] }, []).respuesta).toMatch(/No tengo/);
  });

  it("rechaza pedidos demasiado grandes", () => {
    expect(() => PedidoChat.parse({ ...pedido, mensaje: "x".repeat(501) })).toThrow();
  });
});
