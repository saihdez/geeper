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
import { tapar } from "@/lib/redes/secretos";
import { dirProyecto } from "@/lib/rutas";
import { cerrarTrazas, enSpan, iniciarTrazas } from "@/lib/trazas";
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

async function correrUno(motor: Motor): Promise<boolean> {
  const t = await reclamar(motor, workerId);
  if (!t) return false;
  const log = await rutaLog({ ...t, payload: t.payload as Payload });
  await db.trabajo.update({ where: { id: t.id }, data: { log: log.rel } });
  const escribir = (linea: string) => {
    try {
      // Ningún token llega al log (PUBLICAR.md §6).
      appendFileSync(log.abs, `${hora()} ${tapar(linea)}\n`);
    } catch {
      /* el log no debe tumbar el trabajo */
    }
  };
  avisar(`${motor}: empieza ${t.tipo} ${t.id}`);
  escribir(`== ${t.tipo} (${t.id}), intento ${t.intentos}, worker ${workerId}`);
  const ctrl = new AbortController();
  enCurso.set(t.id, ctrl);
  const pulso = setInterval(() => {
    void latido(t.id, workerId).then((sigue) => {
      if (!sigue && !ctrl.signal.aborted) {
        escribir("El trabajo ya no está corriendo (cancelado): se detiene");
        ctrl.abort();
      }
    });
  }, LATIDO_MS);
  const proyecto = t.proyectoId ? await db.proyecto.findUnique({ where: { id: t.proyectoId } }) : null;
  try {
    const atributos = { "geeper.trabajo.id": t.id, "geeper.trabajo.tipo": t.tipo, "geeper.motor": motor, "geeper.trabajo.intento": t.intentos, "geeper.proyecto": proyecto?.slug ?? "" };
    const salida = await enSpan(
      `trabajo ${t.tipo}`,
      atributos,
      () =>
        EJECUTORES[t.tipo as TipoTrabajo](
          { id: t.id, tipo: t.tipo, proyectoId: t.proyectoId, payload: t.payload as Payload },
          {
            dir: proyecto ? dirProyecto(proyecto.slug) : dirProyecto("sistema"),
            log: escribir,
            signal: ctrl.signal,
            etapa: async (e, p) => {
              escribir(`— ${e}`);
              await marcarEtapa(t.id, e, p);
            },
          },
        ),
      { noEsError: (e) => e instanceof Espera },
    );
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
  iniciarTrazas("geeper-worker");
  await prepararDb();
  const r = await recuperarAlArrancar();
  avisar(`id ${workerId}. ${r.reinicio.hubo ? "REINICIO DETECTADO: " + r.reinicio.motivo : "Sin reinicio desde la última corrida"}.`);
  if (r.interrumpidos || r.reencolados) avisar(`Recuperación: ${r.interrumpidos} interrumpidos (esperan que los relances), ${r.reencolados} devueltos a la cola`);
  await guardarLatidoWorker();
  const latidoSistema = setInterval(() => {
    void guardarLatidoWorker();
    void recuperarVencidos().then((n) => n && avisar(`${n} trabajo(s) con lease vencido recuperados`));
  }, LATIDO_MS);
  const apagar = async (senal: string) => {
    if (apagando) return;
    apagando = true;
    avisar(`${senal}: apagando; los trabajos en curso quedan «interrumpidos»`);
    for (const c of enCurso.values()) c.abort();
    clearInterval(latidoSistema);
    // Las trazas por OTLP van en lote: se vacían antes de salir (las del JSONL ya están escritas).
    setTimeout(() => void cerrarTrazas().finally(() => process.exit(0)), 4000).unref();
  };
  process.on("SIGINT", () => void apagar("SIGINT"));
  process.on("SIGTERM", () => void apagar("SIGTERM"));
  avisar(`Ejecutores: ${MOTORES.join(", ")}. Datos en ${path.dirname(dirProyecto("x"))}`);
  await Promise.all(MOTORES.map((m) => bucle(m)));
}

void main();
