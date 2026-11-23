/** WEB-13: con el canal de avisos abierto la pantalla pide sólo cuando algo cambia (y un respaldo por minuto). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coincide } from "@/lib/eventos-avisos";
import { crearCanal, type CanalAvisos, type FuenteEventos } from "@/lib/eventos-cliente";
import { crearSondeo, RESPALDO_MS, type Visibilidad } from "@/lib/sondeo";

class Pestana implements Visibilidad {
  hidden = false;
  private fs = new Set<() => void>();
  addEventListener(_t: "visibilitychange", f: () => void) { this.fs.add(f); }
  removeEventListener(_t: "visibilitychange", f: () => void) { this.fs.delete(f); }
  cambiar(oculta: boolean) { this.hidden = oculta; for (const f of [...this.fs]) f(); }
}

/** EventSource falso: se abre, se corta y recibe «cambio» a mano. */
class FuenteFalsa implements FuenteEventos {
  readyState = 0;
  cerrada = false;
  private oyentes = new Map<string, ((e: { data?: unknown }) => void)[]>();
  addEventListener(tipo: string, f: (e: { data?: unknown }) => void) { this.oyentes.set(tipo, [...(this.oyentes.get(tipo) ?? []), f]); }
  close() { this.cerrada = true; this.readyState = 2; }
  emitir(tipo: string, data?: unknown) { for (const f of this.oyentes.get(tipo) ?? []) f({ data }); }
  abrir() { this.readyState = 1; this.emitir("open"); }
  cortar(delTodo = false) { this.readyState = delTodo ? 2 : 0; this.emitir("error"); }
  cambio(c: unknown) { this.emitir("cambio", JSON.stringify(c)); }
}

function fuentes() {
  const creadas: FuenteFalsa[] = [];
  const crearFuente = vi.fn(() => {
    const f = new FuenteFalsa();
    creadas.push(f);
    return f;
  });
  return { creadas, crearFuente };
}

/** Responde al instante con un texto que no cambia (nada cambia en el servidor). */
const servidorQuieto = () => vi.fn(async () => '{"n":1}');

const vaciar = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("qué aviso le toca a cada pantalla", () => {
  it("por tipo, o por proyecto; sin ids, a todos los de ese tipo", () => {
    expect(coincide("trabajos", { tipo: "trabajos", ids: ["a"] })).toBe(true);
    expect(coincide("trabajos:a", { tipo: "trabajos", ids: ["a", "b"] })).toBe(true);
    expect(coincide("trabajos:a", { tipo: "trabajos", ids: ["b"] })).toBe(false);
    expect(coincide("trabajos:a", { tipo: "trabajos", ids: [] })).toBe(false);
    expect(coincide("trabajos:a", { tipo: "trabajos" })).toBe(true);
    expect(coincide("proyecto:a", { tipo: "trabajos", ids: ["a"] })).toBe(false);
    expect(coincide("motor", { tipo: "motor" })).toBe(true);
  });
});

describe("sondeo con el canal de avisos (WEB-13)", () => {
  function armar(intervalo = 3000, filtros: string[] = ["trabajos"]) {
    const pestana = new Pestana();
    const f = fuentes();
    const canal = crearCanal({ crearFuente: f.crearFuente, visibilidad: pestana });
    const pedirTexto = servidorQuieto();
    const sondeo = crearSondeo({ url: "/api/trabajos", intervalo: () => intervalo, alDatos: () => {}, alError: () => {}, visibilidad: pestana, pedirTexto, avisos: { canal, filtros } });
    return { pestana, f, canal, pedirTexto, sondeo };
  }

  it("medida: canal abierto y nada cambiando, 10 minutos → 1 pedido al abrir y 1 por minuto de respaldo (antes, 200)", async () => {
    const { f, pedirTexto, sondeo } = armar(3000);
    sondeo.iniciar();
    f.creadas[0]!.abrir();
    await vaciar();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const conCanal = pedirTexto.mock.calls.length;
    sondeo.detener();
    expect(conCanal).toBeLessThanOrEqual(11);
    expect(conCanal).toBeGreaterThanOrEqual(10);

    // Lo mismo sin canal: el sondeo de siempre (cada 3 s).
    const sin = servidorQuieto();
    const viejo = crearSondeo({ url: "/a", intervalo: () => 3000, alDatos: () => {}, alError: () => {}, visibilidad: null, pedirTexto: sin });
    viejo.iniciar();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    viejo.detener();
    expect(sin.mock.calls.length).toBeGreaterThanOrEqual(199);
  });

  it("un aviso que le toca pide enseguida; uno que no, no", async () => {
    const { f, pedirTexto, sondeo } = armar(3000, ["trabajos:p1"]);
    sondeo.iniciar();
    f.creadas[0]!.abrir();
    await vi.advanceTimersByTimeAsync(5000);
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    f.creadas[0]!.cambio({ tipo: "trabajos", ids: ["p2"] });
    f.creadas[0]!.cambio({ tipo: "proyecto", ids: ["p1"] });
    await vaciar();
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    f.creadas[0]!.cambio({ tipo: "trabajos", ids: ["p1"] });
    await vaciar();
    expect(pedirTexto).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it("avisos seguidos: no corta la consulta en vuelo y pide una sola vez más al terminar", async () => {
    const pestana = new Pestana();
    const f = fuentes();
    const canal = crearCanal({ crearFuente: f.crearFuente, visibilidad: pestana });
    const pendientes: { ok: (t: string) => void; signal: AbortSignal }[] = [];
    const pedirTexto = vi.fn((_u: string, signal: AbortSignal) => new Promise<string>((ok) => pendientes.push({ ok, signal })));
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 3000, alDatos: () => {}, alError: () => {}, visibilidad: pestana, pedirTexto, avisos: { canal, filtros: ["trabajos"] } });
    sondeo.iniciar();
    f.creadas[0]!.abrir();
    pendientes[0]!.ok("{}");
    await vi.advanceTimersByTimeAsync(5000);
    f.creadas[0]!.cambio({ tipo: "trabajos" });
    expect(pedirTexto).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 5; i++) f.creadas[0]!.cambio({ tipo: "trabajos" });
    expect(pendientes[1]!.signal.aborted).toBe(false);
    pendientes[1]!.ok("{}");
    await vi.advanceTimersByTimeAsync(1000);
    expect(pedirTexto).toHaveBeenCalledTimes(3);
    pendientes[2]!.ok("{}");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pedirTexto).toHaveBeenCalledTimes(3);
    sondeo.detener();
  });

  it("si el canal se corta, vuelve a pedir a su ritmo; al volver, pide una vez y se calma", async () => {
    const { f, pedirTexto, sondeo } = armar(3000);
    sondeo.iniciar();
    f.creadas[0]!.abrir();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    f.creadas[0]!.cortar();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pedirTexto.mock.calls.length).toBeGreaterThanOrEqual(10);
    const antes = pedirTexto.mock.calls.length;
    f.creadas[0]!.abrir(); // EventSource reconecta solo
    await vi.advanceTimersByTimeAsync(1000);
    expect(pedirTexto.mock.calls.length).toBeLessThanOrEqual(antes + 1);
    const tras = pedirTexto.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pedirTexto.mock.calls.length).toBe(tras);
    sondeo.detener();
  });

  it("sin EventSource sondea como siempre", async () => {
    const canal = crearCanal({ crearFuente: null, visibilidad: null });
    const pedirTexto = servidorQuieto();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 3000, alDatos: () => {}, alError: () => {}, visibilidad: null, pedirTexto, avisos: { canal, filtros: ["trabajos"] } });
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(canal.abierto()).toBe(false);
    expect(pedirTexto.mock.calls.length).toBeGreaterThanOrEqual(19);
    sondeo.detener();
  });

  it(`el respaldo no acelera a quien ya iba más lento (${RESPALDO_MS / 1000} s como mínimo, Infinity sigue en Infinity)`, async () => {
    const { f, pedirTexto, sondeo } = armar(Infinity);
    sondeo.iniciar();
    f.creadas[0]!.abrir();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pedirTexto).toHaveBeenCalledTimes(1);
    f.creadas[0]!.cambio({ tipo: "trabajos" });
    await vaciar();
    expect(pedirTexto).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });
});

describe("un solo canal por página", () => {
  it("varias pantallas comparten una conexión; al irse todas se cierra (tras un respiro)", async () => {
    const f = fuentes();
    const canal: CanalAvisos = crearCanal({ crearFuente: f.crearFuente, visibilidad: null, graciaMs: 3000 });
    const avisos: string[] = [];
    const bajas = ["a", "b", "c"].map((x) => canal.escuchar([`proyecto:${x}`], () => avisos.push(x), () => {}));
    expect(f.crearFuente).toHaveBeenCalledTimes(1);
    f.creadas[0]!.abrir();
    expect(canal.abierto()).toBe(true);
    f.creadas[0]!.cambio({ tipo: "proyecto", ids: ["b"] });
    expect(avisos).toEqual(["b"]);
    for (const b of bajas) b();
    // Cambiar de página: la nueva pantalla llega antes del respiro y reusa la conexión.
    const otra = canal.escuchar(["motor"], () => {}, () => {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.creadas[0]!.cerrada).toBe(false);
    otra();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.creadas[0]!.cerrada).toBe(true);
    expect(canal.abierto()).toBe(false);
  });

  it("pestaña oculta: cierra la conexión; al volver la abre otra vez", () => {
    const pestana = new Pestana();
    const f = fuentes();
    const canal = crearCanal({ crearFuente: f.crearFuente, visibilidad: pestana });
    const estados: boolean[] = [];
    canal.escuchar(["trabajos"], () => {}, () => estados.push(canal.abierto()));
    f.creadas[0]!.abrir();
    pestana.cambiar(true);
    expect(f.creadas[0]!.cerrada).toBe(true);
    expect(f.creadas).toHaveLength(1);
    pestana.cambiar(false);
    expect(f.creadas).toHaveLength(2);
    f.creadas[1]!.abrir();
    expect(estados).toEqual([true, false, true]);
  });

  it("si el servidor no lo acepta (cierre del todo), prueba otra vez al minuto", async () => {
    const f = fuentes();
    const canal = crearCanal({ crearFuente: f.crearFuente, visibilidad: null, reintentoMs: 60_000 });
    canal.escuchar(["trabajos"], () => {}, () => {});
    f.creadas[0]!.cortar(true);
    expect(f.creadas[0]!.cerrada).toBe(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.creadas).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.creadas).toHaveLength(2);
  });

  it("tras un corte, al reconectar, todas las pantallas piden una vez (por si se perdió un aviso)", () => {
    const f = fuentes();
    const canal = crearCanal({ crearFuente: f.crearFuente, visibilidad: null });
    const avisos = vi.fn();
    canal.escuchar(["trabajos:p1"], avisos, () => {});
    f.creadas[0]!.abrir();
    expect(avisos).not.toHaveBeenCalled();
    f.creadas[0]!.cortar();
    f.creadas[0]!.abrir();
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});
