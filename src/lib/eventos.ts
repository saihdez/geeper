/**
 * Vigía de cambios para el canal de avisos (/api/eventos, WEB-13). El motor es otro proceso: la base
 * sigue siendo la fuente de verdad. Una vez por segundo se leen tres marcas baratas (el último cambio y
 * la cantidad de trabajos y de proyectos, y si el motor da señales) y sólo se avisa si cambiaron. Hay
 * un solo vigía por servidor, lo compartan cuantas pestañas lo compartan, y se apaga cuando no queda
 * ninguna escuchando.
 */
import { ultimoLatidoWorker } from "./cola";
import { db } from "./db";
import type { Cambio } from "./eventos-avisos";
import { motorVivo } from "./motor";

export const VIGIA_MS = 1000;
/** Con más proyectos tocados en un segundo, el aviso va sin `ids` (a todos). */
const MAX_IDS = 50;

export interface Marcas {
  trabajos: { max: number; n: number };
  proyectos: { max: number; n: number };
  vivo: boolean;
}

export async function leerMarcas(ahora = Date.now()): Promise<Marcas> {
  const [t, p, latido] = await Promise.all([
    db.trabajo.aggregate({ _max: { actualizado: true }, _count: { _all: true } }),
    db.proyecto.aggregate({ _max: { actualizado: true }, _count: { _all: true } }),
    ultimoLatidoWorker(),
  ]);
  return {
    trabajos: { max: t._max.actualizado?.getTime() ?? 0, n: t._count._all },
    proyectos: { max: p._max.actualizado?.getTime() ?? 0, n: p._count._all },
    vivo: motorVivo(latido, ahora),
  };
}

const ids = (filas: { id: string | null }[]): string[] | undefined => {
  const unicos = [...new Set(filas.map((f) => f.id).filter((x): x is string => !!x))];
  return unicos.length > MAX_IDS ? undefined : unicos;
};

/** Qué cambió entre dos lecturas. Si sólo cambió la última fecha, busca qué proyectos se tocaron. */
export async function cambiosEntre(antes: Marcas, ahora: Marcas): Promise<Cambio[]> {
  const cambios: Cambio[] = [];
  if (antes.trabajos.max !== ahora.trabajos.max || antes.trabajos.n !== ahora.trabajos.n) {
    if (antes.trabajos.n !== ahora.trabajos.n) cambios.push({ tipo: "trabajos" });
    else {
      const filas = await db.trabajo.findMany({ where: { actualizado: { gt: new Date(antes.trabajos.max) } }, select: { proyectoId: true }, distinct: ["proyectoId"] });
      cambios.push({ tipo: "trabajos", ids: ids(filas.map((f) => ({ id: f.proyectoId }))) });
    }
  }
  if (antes.proyectos.max !== ahora.proyectos.max || antes.proyectos.n !== ahora.proyectos.n) {
    if (antes.proyectos.n !== ahora.proyectos.n) cambios.push({ tipo: "proyecto" });
    else cambios.push({ tipo: "proyecto", ids: ids(await db.proyecto.findMany({ where: { actualizado: { gt: new Date(antes.proyectos.max) } }, select: { id: true } })) });
  }
  if (antes.vivo !== ahora.vivo) cambios.push({ tipo: "motor" });
  return cambios;
}

type Oyente = (c: Cambio) => void;

interface Vigia {
  oyentes: Set<Oyente>;
  temporizador: ReturnType<typeof setInterval> | null;
  marcas: Marcas | null;
  leyendo: boolean;
  /** Para las pruebas y la medida: cuántas veces se leyó la base. */
  lecturas: number;
}

// En globalThis: en desarrollo Next puede cargar este módulo más de una vez y habría dos vigías.
const g = globalThis as unknown as { __geeperVigia?: Vigia };
const vigia: Vigia = (g.__geeperVigia ??= { oyentes: new Set(), temporizador: null, marcas: null, leyendo: false, lecturas: 0 });

async function revisar(): Promise<void> {
  if (vigia.leyendo) return; // la anterior sigue (base ocupada): no se enciman
  vigia.leyendo = true;
  try {
    vigia.lecturas++;
    const nuevas = await leerMarcas();
    const antes = vigia.marcas;
    vigia.marcas = nuevas;
    if (!antes || !vigia.oyentes.size) return;
    for (const c of await cambiosEntre(antes, nuevas)) {
      for (const o of [...vigia.oyentes]) {
        try {
          o(c);
        } catch {
          // Un oyente roto (conexión que se cerró) no frena a los demás.
        }
      }
    }
  } catch {
    // Base ocupada o recién creada: se reintenta en la próxima vuelta.
  } finally {
    vigia.leyendo = false;
  }
}

/** Avisa cada cambio a `oyente`. Devuelve cómo dejar de escuchar. */
export function escucharCambios(oyente: Oyente, cadaMs = VIGIA_MS): () => void {
  vigia.oyentes.add(oyente);
  if (!vigia.temporizador) {
    vigia.marcas = null;
    void revisar();
    vigia.temporizador = setInterval(() => void revisar(), cadaMs);
  }
  return () => {
    vigia.oyentes.delete(oyente);
    if (!vigia.oyentes.size && vigia.temporizador) {
      clearInterval(vigia.temporizador);
      vigia.temporizador = null;
      vigia.marcas = null;
    }
  };
}

/** Para las pruebas. */
export function estadoVigia(): { oyentes: number; activo: boolean; lecturas: number } {
  return { oyentes: vigia.oyentes.size, activo: !!vigia.temporizador, lecturas: vigia.lecturas };
}
