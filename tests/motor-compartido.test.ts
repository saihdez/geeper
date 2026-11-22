/** WEB-10 (ronda 2): el editor pedía el estado del motor una vez por escena y «Rehacer la toma» sondeaba cerrado. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { suscribirMotor } from "@/components/motor";
import { intervaloRehacer } from "@/components/panel-rehacer";

afterEach(() => vi.unstubAllGlobals());

describe("estado del motor: un solo sondeo por página", () => {
  it("cinco componentes suscritos hacen una sola petición, y al irse todos se detiene", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ vivo: true })));
    vi.stubGlobal("fetch", fetch);
    const avisos: number[] = [];
    const bajas = [0, 1, 2, 3, 4].map((i) => suscribirMotor(() => avisos.push(i)));
    await vi.waitFor(() => expect(avisos).toHaveLength(5));
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const baja of bajas) baja();
    // Al volver a suscribirse empieza de nuevo (otra página).
    const baja = suscribirMotor(() => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    baja();
  });
});

describe("«Rehacer la toma» no sondea con el panel cerrado y quieto", () => {
  it("abierto: 3 s", () => expect(intervaloRehacer(true, false)).toBe(3000));
  it("cerrado con un trabajo de la escena: 10 s, para el avance del título", () => expect(intervaloRehacer(false, true)).toBe(10_000));
  it("cerrado y sin trabajo: nunca (antes, cada 15 s por escena)", () => expect(intervaloRehacer(false, false)).toBe(Infinity));
});
