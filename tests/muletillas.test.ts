import { describe, expect, it } from "vitest";
import { aplicarEdicion, esMuletilla, repeticiones } from "@/lib/ediciones";
import { validarProyecto } from "@/lib/esquema";
import { textoADecir } from "@/lib/regenerar";
import { proyectoDePrueba } from "./fixtures";

/** Palabras con tiempos seguidos (0,3 s cada una, 0,05 s entre ellas) salvo las pausas pedidas. */
function palabras(texto: string, pausas: Record<number, number> = {}) {
  let t = 0;
  return texto.split(" ").map((w, i) => {
    t += pausas[i] ?? 0;
    const p = { texto: w, inicio: t, fin: t + 0.3 };
    t += 0.35;
    return p;
  });
}

describe("muletillas (reglas de Cap pasadas al español)", () => {
  it("reconoce vacilaciones estiradas de cualquier largo", () => {
    for (const w of ["eh", "eeeeh,", "ehhhh", "Mmmmmm…", "ehmmm", "uuuum", "aaah", "hmmm"]) expect(esMuletilla(w), w).toBe(true);
    for (const w of ["e", "a", "eme", "ajá", "mjm", "este", "hambre", "uh-huh", ""]) expect(esMuletilla(w), w).toBe(false);
  });

  it("encuentra tartamudeos y quita la primera vez", () => {
    expect(repeticiones(palabras("el el problema es serio"))).toEqual([[0, 1]]);
    expect(repeticiones(palabras("vamos en la en la casa"))).toEqual([[1, 3]]);
    // Con una vacilación en medio («el, eh, el») también cuenta.
    expect(repeticiones(palabras("el, eh, el problema"))).toEqual([[0, 1]]);
  });

  it("respeta lo que se repite a propósito", () => {
    expect(repeticiones(palabras("no no y no"))).toEqual([]);
    expect(repeticiones(palabras("es muy muy bueno"))).toEqual([]);
    expect(repeticiones(palabras("dos dos tres"))).toEqual([]);
    // Si la primera cierra una oración, son dos oraciones.
    expect(repeticiones(palabras("lo dije. Dije que no"))).toEqual([]);
    // Una pausa larga es énfasis, no tartamudeo.
    expect(repeticiones(palabras("fue fue increíble", { 1: 1.2 }))).toEqual([]);
  });

  it("«Quitar muletillas» recorta vacilaciones y tartamudeos, y no duplica al repetirlo", () => {
    const p = proyectoDePrueba();
    const e = p.escenas.e02!;
    // e02: voz 3–6 s.
    e.palabras = palabras("el el juego eeeh sale en mayo.").map((w) => ({ ...w, inicio: w.inicio + 3, fin: w.fin + 3 }));
    e.texto = e.palabras.map((w) => w.texto).join(" ");
    const v = validarProyecto(p);
    const una = aplicarEdicion(v, { tipo: "quitarMuletillas" });
    expect(una.escenas.e02!.recortes.map((r) => r.motivo)).toEqual(["muletilla", "muletilla"]);
    expect(textoADecir(una.escenas.e02!)).toBe("el juego sale en mayo.");
    const dos = aplicarEdicion(una, { tipo: "quitarMuletillas" });
    expect(dos.escenas.e02!.recortes).toEqual(una.escenas.e02!.recortes);
  });
});

describe("tope de 2,5 s por palabra en pantalla (idea de Cap)", () => {
  it("una palabra estirada por whisper no deja el subtítulo congelado", async () => {
    const { todosLosGrupos, MAX_DURACION_PALABRA } = await import("@/lib/linea");
    const p = proyectoDePrueba();
    const e = p.escenas.e02!;
    // e02: voz 3–6 s; «fin» estirada 2,9 s sobre el silencio.
    e.palabras = [
      { texto: "Hola", inicio: 3.0, fin: 3.3 },
      { texto: "fin.", inicio: 3.1, fin: 6.0 },
    ];
    e.texto = "Hola fin.";
    const g = todosLosGrupos(validarProyecto(p)).find((x) => x.texto.includes("fin."))!;
    const ficha = g.fichas.find((f) => f.texto === "fin.")!;
    expect(ficha.fin - ficha.inicio).toBeLessThanOrEqual(MAX_DURACION_PALABRA + 1e-6);
  });
});
