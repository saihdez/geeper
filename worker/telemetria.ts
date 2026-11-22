/**
 * Medidas de la tarjeta por trabajo (GPU-10): para llenar con el uso normal la tabla «VRAM por tarea» sin
 * gastar tarjeta en pruebas. Dos fuentes, que quedan en el `resultado` del trabajo:
 *  - lo que imprimen los scripts de Python (py/voz_voxcpm.py, py/efecto_sonido.py) como líneas JSON
 *    («cargado_s», «vram_pico_gb», «total_s»), que ya llegan al registro del trabajo;
 *  - `nvidia-smi` cada 5 s mientras corre un trabajo de tarjeta (Wan2GP y ComfyUI no imprimen su pico),
 *    en un CSV junto al registro que sobrevive a un reinicio (fsync en cada línea).
 */
import fs from "node:fs/promises";
import os from "node:os";
import { correr } from "@/lib/proceso";

export interface MedidasGpu {
  /** Carga del modelo, en s (lo dice el script). */
  cargado_s?: number;
  /** Pico de VRAM que vio PyTorch, en GB (lo dice el script). */
  vram_pico_gb?: number;
  /** Duración total del script, en s. */
  total_s?: number;
  /** Máximo de VRAM ocupada en toda la tarjeta según nvidia-smi, en MiB. */
  vram_max_mib?: number;
  /** Máxima temperatura vista, en °C. */
  temp_max_c?: number;
  muestras?: number;
}

const CLAVES_SCRIPT = ["cargado_s", "vram_pico_gb", "total_s"] as const;

/** Si `linea` es una línea JSON de medidas de un script, la suma a `m` (se queda con el máximo). */
export function medidasDeLinea(linea: string, m: MedidasGpu): void {
  const t = linea.trim();
  if (!t.startsWith("{") || !CLAVES_SCRIPT.some((k) => t.includes(`"${k}"`))) return;
  try {
    const d = JSON.parse(t) as Record<string, unknown>;
    for (const k of CLAVES_SCRIPT) {
      const v = d[k];
      if (typeof v === "number" && Number.isFinite(v)) m[k] = Math.max(m[k] ?? 0, v);
    }
  } catch {
    /* no era JSON */
  }
}

/** «temp, potencia, vram, uso» de nvidia-smi (CSV sin unidades) → números; null si no se entiende. */
export function leerMuestra(linea: string): { temp: number; potencia: number; vram: number; uso: number } | null {
  const [temp, potencia, vram, uso] = linea.trim().split("\n")[0]!.split(",").map((x) => Number(x.trim()));
  if (![temp, vram].every((x) => Number.isFinite(x))) return null;
  return { temp: temp!, potencia: potencia ?? NaN, vram: vram!, uso: uso ?? NaN };
}

const consultarNvidia = async (): Promise<string | null> => {
  const r = await correr("nvidia-smi", ["--query-gpu=temperature.gpu,power.draw,memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { permitirFallo: true, timeout: 10_000, signal: null });
  return r.codigo === 0 ? r.stdout : null;
};

/** Muestrea la tarjeta cada `pasoMs` en `ruta` (CSV) hasta `parar()`, que devuelve los máximos. */
export function muestrearGpu(ruta: string, op: { consultar?: () => Promise<string | null>; pasoMs?: number } = {}): { parar: () => MedidasGpu } {
  const consultar = op.consultar ?? consultarNvidia;
  const m: MedidasGpu = { muestras: 0 };
  let activo = true;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (!activo) return;
    try {
      const salida = await consultar();
      const s = salida ? leerMuestra(salida) : null;
      if (s && activo) {
        m.muestras = (m.muestras ?? 0) + 1;
        m.vram_max_mib = Math.max(m.vram_max_mib ?? 0, s.vram);
        m.temp_max_c = Math.max(m.temp_max_c ?? 0, s.temp);
        const carga = os.loadavg()[0]!.toFixed(2); // 0 en Windows
        const fh = await fs.open(ruta, "a");
        await fh.write(`${new Date().toISOString()},${salida!.trim().split("\n")[0]!.replace(/\s/g, "")},${carga}\n`);
        await fh.sync();
        await fh.close();
      }
    } catch {
      /* sin nvidia-smi o sin disco: no tumba el trabajo */
    }
    if (activo) (reloj = setTimeout(() => void tick(), op.pasoMs ?? 5000)).unref?.();
  };
  void fs.writeFile(ruta, "tiempo,temp_c,potencia_w,vram_mib,uso_pct,carga1\n").then(tick, tick);
  return {
    parar: () => {
      activo = false;
      clearTimeout(reloj);
      return { ...m };
    },
  };
}

/** El resultado del trabajo con sus medidas (sólo si es un objeto y hay algo medido). */
export function conMedidas(resultado: unknown, m: MedidasGpu): unknown {
  const util = Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== undefined && !(k === "muestras" && v === 0)));
  if (!Object.keys(util).length) return resultado;
  if (resultado === null || resultado === undefined) return { medidas: util };
  if (typeof resultado !== "object" || Array.isArray(resultado)) return resultado;
  return { ...(resultado as Record<string, unknown>), medidas: util };
}
