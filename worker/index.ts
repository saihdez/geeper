/**
 * Worker de Geeper: un ejecutor por motor (mpt, voz, render, red), cada uno con concurrencia 1.
 * Uso: pnpm run worker
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import {
  Espera, esperar, fallar, guardarLatidoWorker, latido, LATIDO_MS, marcarEtapa, MOTORES, nuevoWorkerId, reclamar,
  recuperarAlArrancar, recuperarVencidos, terminar, type Motor, type Payload, type TipoTrabajo,
} from "@/lib/cola";
import { db, prepararDb } from "@/lib/db";
import { enTrabajo } from "@/lib/proceso";
import { tapar } from "@/lib/redes/secretos";
import { dirProyecto } from "@/lib/rutas";
import { EJECUTORES, rutaLog } from "./ejecutores";

const workerId = nuevoWorkerId();
let apagando = false;
const enCurso = new Map<string, AbortController>();

function hora() {
  return new Date().toLocaleTimeString("es-MX", { hour12: false });
}

function avisar(msg: string) {
  console.log(`[worker ${hora()}] ${msg}`);
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

async function correrUno(motor: Motor): Promise<boolean> {
  const t = await reclamar(motor, workerId);
  if (!t) return false;
  let logAbs: string | undefined;
  const escribir = (linea: string) => {
    if (!logAbs) return;
    try {
      // Ningún token llega al log (PUBLICAR.md §6).
      appendFileSync(logAbs, `${hora()} ${tapar(linea)}\n`);
    } catch {
      /* el log no debe tumbar el trabajo */
    }
  };
  const ctrl = new AbortController();
  enCurso.set(t.id, ctrl);
  let pulso: ReturnType<typeof setInterval> | undefined;
  let proyecto: Awaited<ReturnType<typeof db.proyecto.findUnique>> = null;
  try {
    const log = await rutaLog({ ...t, payload: t.payload as Payload });
    logAbs = log.abs;
    await db.trabajo.update({ where: { id: t.id }, data: { log: log.rel } });
    avisar(`${motor}: empieza ${t.tipo} ${t.id}`);
    escribir(`== ${t.tipo} (${t.id}), intento ${t.intentos}, worker ${workerId}`);
    pulso = setInterval(() => {
      latido(t.id, workerId).then(
        (sigue) => {
          if (!sigue && !ctrl.signal.aborted) {
            escribir("El trabajo ya no está corriendo (cancelado): se detiene");
            ctrl.abort();
          }
        },
        // Un fallo de la base (bloqueo largo, disco lleno) no tumba el worker: el latido reintenta.
        (e: unknown) => escribir(`(el latido no pudo escribir en la base: ${mensaje(e)}; se reintenta)`),
      );
    }, LATIDO_MS);
    proyecto = t.proyectoId ? await db.proyecto.findUnique({ where: { id: t.proyectoId } }) : null;
    // Dentro de enTrabajo, cancelar llega a todo correr() del ejecutor, aunque no reciba la señal (WRK-05).
    const salida = await enTrabajo(ctrl.signal, () => EJECUTORES[t.tipo as TipoTrabajo](
      { id: t.id, tipo: t.tipo, proyectoId: t.proyectoId, payload: t.payload as Payload },
      {
        dir: proyecto ? dirProyecto(proyecto.slug) : dirProyecto("sistema"),
        log: escribir,
        signal: ctrl.signal,
        etapa: async (e, p) => {
          escribir(`— ${e}`);
          // La etapa es sólo informativa: si la base falla, el trabajo sigue.
          await marcarEtapa(t.id, e, p).catch((err: unknown) => escribir(`(no se pudo anotar la etapa: ${mensaje(err)})`));
        },
      },
    ));
    await terminar(t.id, workerId, salida.resultado, salida.siguiente && { ...salida.siguiente, proyectoId: t.proyectoId });
    escribir(`== hecho${salida.siguiente ? `; sigue ${salida.siguiente.tipo}` : ""}`);
    avisar(`${motor}: terminó ${t.tipo} ${t.id}`);
  } catch (e) {
    if (e instanceof Espera && !apagando && !ctrl.signal.aborted) {
      // Espera algo externo (VPN, cuota): vuelve a la cola sin gastar el intento.
      escribir(`.. ${e.etapa}; vuelve a la cola hasta ${e.hasta.toISOString()}`);
      await esperar(t.id, workerId, e.hasta, e.etapa);
      avisar(`${motor}: ${t.tipo} ${t.id} en espera: ${tapar(e.etapa)}`);
      return true;
    }
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    escribir(`!! ${msg}`);
    if (apagando) await fallar(t.id, workerId, "Interrumpido: el worker se apagó a mitad. Relánzalo cuando quieras.", "interrumpido");
    else if (!ctrl.signal.aborted) {
      await fallar(t.id, workerId, tapar(e instanceof Error ? e.message : String(e)));
      // Una publicación fallida no cambia el estado del proyecto (el render sigue entregado).
      if (proyecto && t.motor !== "red") await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "fallido" } }).catch(() => undefined);
    }
    avisar(`${motor}: ${t.tipo} ${t.id} ${ctrl.signal.aborted ? "detenido" : "falló"}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    clearInterval(pulso);
    enCurso.delete(t.id);
  }
  return true;
}

async function bucle(motor: Motor) {
  while (!apagando) {
    let hubo = false;
    try {
      hubo = await correrUno(motor);
    } catch (e) {
      avisar(`${motor}: error del ejecutor: ${e instanceof Error ? e.message : e}`);
    }
    if (!hubo) await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  await prepararDb();
  const r = await recuperarAlArrancar();
  avisar(`id ${workerId}. ${r.reinicio.hubo ? "REINICIO DETECTADO: " + r.reinicio.motivo : "Sin reinicio desde la última corrida"}.`);
  if (r.interrumpidos || r.reencolados) avisar(`Recuperación: ${r.interrumpidos} interrumpidos (esperan que los relances), ${r.reencolados} devueltos a la cola`);
  await guardarLatidoWorker();
  const latidoSistema = setInterval(() => {
    guardarLatidoWorker().catch((e: unknown) => avisar(`No se pudo guardar el latido del worker: ${mensaje(e)} (se reintenta en ${LATIDO_MS / 1000} s)`));
    recuperarVencidos().then(
      (n) => n && avisar(`${n} trabajo(s) con lease vencido recuperados`),
      (e: unknown) => avisar(`No se pudo revisar los leases vencidos: ${mensaje(e)} (se reintenta en ${LATIDO_MS / 1000} s)`),
    );
  }, LATIDO_MS);
  const apagar = async (senal: string) => {
    if (apagando) return;
    apagando = true;
    avisar(`${senal}: apagando; los trabajos en curso quedan «interrumpidos»`);
    for (const c of enCurso.values()) c.abort();
    clearInterval(latidoSistema);
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on("SIGINT", () => void apagar("SIGINT"));
  process.on("SIGTERM", () => void apagar("SIGTERM"));
  // Cerrar la ventana de la terminal manda SIGHUP: sin esto el worker moría sin apagar sus procesos.
  process.on("SIGHUP", () => void apagar("SIGHUP"));
  avisar(`Ejecutores: ${MOTORES.join(", ")}. Datos en ${path.dirname(dirProyecto("x"))}`);
  await Promise.all(MOTORES.map((m) => bucle(m)));
}

// Una promesa rechazada sin atender no debe tumbar el worker entero (y con él hasta 4 trabajos).
process.on("unhandledRejection", (e) => avisar(`AVISO: error sin atender (el worker sigue): ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));

main().catch((e: unknown) => {
  avisar(`No pudo arrancar: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
