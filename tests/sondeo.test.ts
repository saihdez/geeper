import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorConexion, RECONECTANDO } from "@/lib/conexion";
import { crearSondeo, type Visibilidad } from "@/lib/sondeo";

class Pestana implements Visibilidad {
  hidden = false;
  private f: (() => void) | null = null;
  addEventListener(_t: "visibilitychange", f: () => void) { this.f = f; }
  removeEventListener() { this.f = null; }
  cambiar(oculta: boolean) { this.hidden = oculta; this.f?.(); }
}

/** Respuestas en orden; cada petición queda pendiente hasta `resolver`. */
function servidor() {
  const pendientes: { url: string; signal: AbortSignal; ok: (t: string) => void; mal: (e: unknown) => void }[] = [];
  const pedirTexto = vi.fn((url: string, signal: AbortSignal) => new Promise<string>((ok, mal) => pendientes.push({ url, signal, ok, mal })));
  return { pedirTexto, pendientes };
}

const vaciar = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSondeo por dentro (WEB-01)", () => {
  it("espera la respuesta antes de programar la siguiente: nunca se enciman", async () => {
    const s = servidor();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos: () => {}, alError: () => {}, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.pedirTexto).toHaveBeenCalledTimes(1); // la primera sigue sin responder
    s.pendientes[0]!.ok("{}");
    await vaciar();
    await vi.advanceTimersByTimeAsync(999);
    expect(s.pedirTexto).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.pedirTexto).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it("no avisa si el texto no cambió", async () => {
    const s = servidor();
    const alDatos = vi.fn();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos, alError: () => {}, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    s.pendientes[0]!.ok('{"n":1}');
    await vaciar();
    await vi.advanceTimersByTimeAsync(1000);
    s.pendientes[1]!.ok('{"n":1}');
    await vaciar();
    await vi.advanceTimersByTimeAsync(1000);
    s.pendientes[2]!.ok('{"n":2}');
    await vaciar();
    expect(alDatos.mock.calls.map((c) => c[0])).toEqual([{ n: 1 }, { n: 2 }]);
    sondeo.detener();
  });

  it("con la pestaña oculta no pide; al volver pide enseguida", async () => {
    const s = servidor();
    const p = new Pestana();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos: () => {}, alError: () => {}, visibilidad: p, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    s.pendientes[0]!.ok("{}");
    await vaciar();
    p.cambiar(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.pedirTexto).toHaveBeenCalledTimes(1);
    p.cambiar(false);
    expect(s.pedirTexto).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it("recargar descarta la respuesta vieja que llega tarde", async () => {
    const s = servidor();
    const alDatos = vi.fn();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos, alError: () => {}, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    const r = sondeo.recargar();
    expect(s.pendientes[0]!.signal.aborted).toBe(true);
    s.pendientes[1]!.ok('{"v":"nueva"}');
    await r;
    s.pendientes[0]!.ok('{"v":"vieja"}');
    await vaciar();
    expect(alDatos.mock.calls.map((c) => c[0])).toEqual([{ v: "nueva" }]);
    sondeo.detener();
  });

  it("tras detener no avisa nada ni vuelve a pedir", async () => {
    const s = servidor();
    const alDatos = vi.fn();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos, alError: () => {}, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    sondeo.detener();
    s.pendientes[0]!.ok("{}");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(alDatos).not.toHaveBeenCalled();
    expect(s.pedirTexto).toHaveBeenCalledTimes(1);
  });

  it("el intervalo depende de los datos (rápido con trabajo activo, lento en reposo)", async () => {
    const s = servidor();
    const sondeo = crearSondeo<{ activo: boolean }>({ url: "/a", intervalo: (d) => (d?.activo ? 1000 : 30_000), alDatos: () => {}, alError: () => {}, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    s.pendientes[0]!.ok('{"activo":false}');
    await vaciar();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(s.pedirTexto).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    s.pendientes[1]!.ok('{"activo":true}');
    await vaciar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.pedirTexto).toHaveBeenCalledTimes(3);
    sondeo.detener();
  });

  it("sin conexión dice «Reconectando…» y lo borra al volver", async () => {
    const s = servidor();
    const alError = vi.fn();
    const sondeo = crearSondeo({ url: "/a", intervalo: () => 1000, alDatos: () => {}, alError, visibilidad: null, pedirTexto: s.pedirTexto });
    sondeo.iniciar();
    s.pendientes[0]!.mal(new ErrorConexion());
    await vaciar();
    expect(alError).toHaveBeenLastCalledWith(RECONECTANDO);
    await vi.advanceTimersByTimeAsync(1000);
    s.pendientes[1]!.ok("{}");
    await vaciar();
    expect(alError).toHaveBeenLastCalledWith(null);
    sondeo.detener();
  });
});
