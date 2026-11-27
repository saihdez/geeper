/**
 * «Tu avatar en el video» como protagonista (pedido del dueño, 2026-11-23): el avatar sale en todas las
 * escenas y es la única persona del video. Lo de atrás son los fondos del tema (las imágenes que hizo MPT
 * para cada escena, de acuerdo al prompt), sin nadie más; el avatar habla a cámara y gesticula en cada una,
 * como un humano.
 *
 * 1. La voz del video pasa a ser la del avatar (si tiene una elegida y el video habla con otra).
 * 2. En cada escena, una imagen del avatar dentro de ese fondo (actuar.ts: misma luz y perspectiva; la
 *    gente que trajera la imagen sale). El producto, si hay, en la primera y en la última.
 * 3. Todas las tomas en una sola corrida de Wan2GP (el modelo se carga una vez), cada una con la voz de su
 *    escena. Una que falla deja su escena como estaba y no tumba el video.
 */
import path from "node:path";
import { componerCuadro, PedidoActuar, promptHabla, type CuerpoAvatar } from "./actuar";
import { leerAvatar, type VozAvatar } from "./avatares";
import { aplicarEdicion } from "./ediciones";
import type { Proyecto } from "./esquema";
import { ENTRADA, escenasEnLinea } from "./linea";
import { generarPresentadores, MAX_SEGUNDOS, type ContextoPresentador, type OpcionesPresentador } from "./presentador";
import { regenerarVoz } from "./regenerar";
import { leerGuardado } from "./almacen";
import { versionDeProyecto } from "./render";
import { segundosTomasJuntas } from "./tiempo-hablar";

export interface EscenaProtagonista {
  escena: string;
  numero: number;
  /** Segundos de voz de la toma (con la entrada en silencio). */
  segundos: number;
}

/** Una toma por escena (función pura). Una escena con más voz de la que entra en una toma se avisa. */
export function escenasProtagonista(p: Proyecto): EscenaProtagonista[] {
  return escenasEnLinea(p).map((e) => {
    const segundos = ENTRADA + e.voz.rango.duracion;
    if (segundos > MAX_SEGUNDOS) throw new Error(`La escena ${e.indice + 1} tiene más de ${Math.floor(MAX_SEGUNDOS - ENTRADA)} s de voz y no entra en una toma: pártela en el editor y vuelve a intentarlo.`);
    return { escena: e.escena.id, numero: e.indice + 1, segundos };
  });
}

/** Minutos estimados en la RTX 5080: ~1 por escena para ponerlo en su fondo, y las tomas juntas. Función pura. */
export function minutosProtagonista(segundos: number[]): number {
  return Math.ceil(segundos.length + segundosTomasJuntas(segundos) / 60);
}

/** ¿El video ya habla con la voz del avatar? (MPT antepone «kokoro:»). */
export function hablaConSuVoz(voz: Proyecto["voz"], v: VozAvatar): boolean {
  return v.motor === "voxcpm" ? voz.motor === "voxcpm" && voz.voz === v.voz : voz.motor !== "voxcpm" && voz.voz.split(":").pop() === v.voz;
}

export interface PedidoProtagonista {
  avatar: string;
  cuerpo: CuerpoAvatar;
  producto?: string;
  semilla?: number;
}

export interface AvanceProtagonista {
  etapa: string;
  avance: number;
}

const motivo = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** Pone al avatar de protagonista en todo el video. Devuelve las escenas que quedaron con él. */
export async function protagonizarVideo(
  ctx: ContextoPresentador,
  proyectoId: string,
  o: PedidoProtagonista,
  etapa: (a: AvanceProtagonista) => void | Promise<void>,
): Promise<{ escenas: number[]; tomas: number }> {
  const avatar = await leerAvatar(o.avatar);
  let { p } = await versionDeProyecto(proyectoId);
  // SEG-05: lo guardado junto con `p`; las tomas se guardan encima de lo que se edite mientras tanto.
  let guardada = await leerGuardado(proyectoId);

  // 1. Su voz. Antes de las tomas: la boca sigue a la voz que va a quedar.
  if (avatar.voz && !hablaConSuVoz(p.voz, avatar.voz)) {
    await etapa({ etapa: `Poniendo la voz de ${avatar.nombre} («${avatar.voz.nombre}») en todo el video`, avance: 0.02 });
    const conVoz = aplicarEdicion(p, { tipo: "cambiarVoz", motor: avatar.voz.motor, voz: avatar.voz.voz });
    try {
      await regenerarVoz(ctx, proyectoId, conVoz, null);
      ({ p } = await versionDeProyecto(proyectoId));
      guardada = await leerGuardado(proyectoId);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      ctx.log(`No se pudo poner la voz de ${avatar.nombre} (${motivo(e)}); sigue con la del video.`);
    }
  }
  const escenas = escenasProtagonista(p);

  // 2. El avatar dentro del fondo de cada escena, solo.
  const corrida = path.join(ctx.dir, "build", "protagonista", new Date().toISOString().replace(/[:.]/g, "-"));
  const semilla = o.semilla ?? Math.floor(Math.random() * 2 ** 30);
  const tomas: { e: EscenaProtagonista; op: OpcionesPresentador }[] = [];
  for (const [i, e] of escenas.entries()) {
    await etapa({ etapa: `Poniendo a ${avatar.nombre} en la escena ${e.numero} (${i + 1} de ${escenas.length})`, avance: 0.05 + (0.25 * i) / escenas.length });
    const conProducto = o.producto && (i === 0 || i === escenas.length - 1);
    const pedido = PedidoActuar.parse({ avatar: o.avatar, tipo: "habla", encuadre: o.cuerpo, que: "", lugar: "escena", producto: conProducto ? o.producto : undefined, semilla: semilla + i });
    try {
      const imagen = await componerCuadro(ctx, p, e.escena, pedido, path.join(corrida, e.escena));
      // Cada toma con su semilla (así se reconoce su video en el lote), su imagen y la voz de su escena.
      tomas.push({ e, op: { avatar: o.avatar, modo: "pantalla", escenas: [e.escena], imagen, prompt: promptHabla(o.cuerpo), semilla: semilla + i } });
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      ctx.log(`Escena ${e.numero}: no se pudo poner a ${avatar.nombre} en su fondo (${motivo(err)}); queda como estaba.`);
    }
  }
  if (!tomas.length) return { escenas: [], tomas: 0 };

  // 3. Todas las tomas en una corrida (480p: tiempo-hablar.ts).
  await etapa({ etapa: `${avatar.nombre} hablando a cámara (${tomas.length} ${tomas.length === 1 ? "escena" : "escenas"})`, avance: 0.3 });
  try {
    const r = await generarPresentadores(ctx, proyectoId, p, tomas.map((t) => t.op), `${avatar.nombre} protagoniza el video (${tomas.length} escenas)`, guardada);
    return { escenas: r.hechas.map((i) => tomas[i]!.e.numero), tomas: tomas.length };
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    ctx.log(`${avatar.nombre} no pudo hablar en las escenas (${motivo(err)}); el video queda con las imágenes.`);
    return { escenas: [], tomas: tomas.length };
  }
}
