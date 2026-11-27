/**
 * Canal de avisos (WEB-13): la pantalla deja una conexión abierta y recibe «cambio» cuando algo cambia
 * en la base, en vez de preguntar cada pocos segundos. Si el canal se corta, la pantalla vuelve sola a
 * preguntar como antes (lib/sondeo.ts).
 */
import { escucharCambios } from "@/lib/eventos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comentario cada 25 s para que nada en el medio dé la conexión por muerta. */
const LATIDO_MS = 25_000;

export function GET(req: Request) {
  const cod = new TextEncoder();
  let cerrar = () => {};
  const flujo = new ReadableStream<Uint8Array>({
    start(c) {
      let cerrado = false;
      const enviar = (texto: string) => {
        if (cerrado) return;
        try {
          c.enqueue(cod.encode(texto));
        } catch {
          cerrar();
        }
      };
      const baja = escucharCambios((cambio) => enviar(`event: cambio\ndata: ${JSON.stringify(cambio)}\n\n`));
      const latido = setInterval(() => enviar(": sigo\n\n"), LATIDO_MS);
      cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        baja();
        clearInterval(latido);
        req.signal.removeEventListener("abort", cerrar);
        try {
          c.close();
        } catch {
          // ya cerrado por el otro lado
        }
      };
      // retry: cuánto espera el navegador para reconectar si se corta.
      enviar("retry: 5000\n: abierto\n\n");
      if (req.signal.aborted) cerrar();
      else req.signal.addEventListener("abort", cerrar);
    },
    cancel() {
      cerrar();
    },
  });
  return new Response(flujo, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: que la compresión de Next no lo retenga en un búfer.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
