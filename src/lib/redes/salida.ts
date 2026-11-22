/**
 * Chequeo de la salida a internet (VPN). Geeper no levanta el túnel: lo vigila. El corte real lo hace
 * WireGuard con «Block untunneled traffic» (PUBLICAR.md §8). Aquí sólo se decide si se puede llamar
 * a una red ahora o si el trabajo espera.
 */
import { db } from "../db";

export type ModoVpn = "apagado" | "requerido";

export interface AjustesRed {
  vpn: ModoVpn;
  /** IP pública esperada (la del servidor VPN). Opcional si se da el país. */
  ipEsperada: string;
  /** Código ISO de 2 letras del país esperado. Opcional si se da la IP. */
  paisEsperado: string;
}

export interface Salida {
  ip: string | null;
  pais: string | null;
  /** «sin dato» si ningún servicio respondió. */
  fuente: string | null;
  medido: string;
}

export interface Veredicto {
  ok: boolean;
  /** activo | caido | sin_dato | apagado | sin_configurar */
  estado: "activo" | "caido" | "sin_dato" | "apagado" | "sin_configurar";
  detalle: string;
  salida: Salida | null;
}

const CLAVES = { vpn: "red.vpn", ipEsperada: "red.ipEsperada", paisEsperado: "red.paisEsperado", salida: "red.salida" } as const;
export const CACHE_MS = 60_000;

export async function leerAjustes(): Promise<AjustesRed> {
  const filas = await db.sistema.findMany({ where: { clave: { in: [CLAVES.vpn, CLAVES.ipEsperada, CLAVES.paisEsperado] } } });
  const v = (k: string) => filas.find((f) => f.clave === k)?.valor ?? "";
  return { vpn: v(CLAVES.vpn) === "requerido" ? "requerido" : "apagado", ipEsperada: v(CLAVES.ipEsperada), paisEsperado: v(CLAVES.paisEsperado).toUpperCase() };
}

export async function guardarAjustes(a: Partial<AjustesRed>): Promise<AjustesRed> {
  const pares: [string, string | undefined][] = [
    [CLAVES.vpn, a.vpn],
    [CLAVES.ipEsperada, a.ipEsperada?.trim()],
    [CLAVES.paisEsperado, a.paisEsperado?.trim().toUpperCase()],
  ];
  for (const [clave, valor] of pares) {
    if (valor === undefined) continue;
    await db.sistema.upsert({ where: { clave }, create: { clave, valor }, update: { valor } });
  }
  return leerAjustes();
}

/** Servicios de IP pública, en orden. Sólo reciben la petición (no se les manda nada de Geeper). */
const SERVICIOS: { nombre: string; url: string; leer: (j: Record<string, unknown>) => { ip?: unknown; pais?: unknown } }[] = [
  { nombre: "ipinfo.io", url: "https://ipinfo.io/json", leer: (j) => ({ ip: j.ip, pais: j.country }) },
  { nombre: "api.country.is", url: "https://api.country.is/", leer: (j) => ({ ip: j.ip, pais: j.country }) },
];

export type Medidor = () => Promise<Salida>;

export const medirSalida: Medidor = async () => {
  for (const s of SERVICIOS) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const { ip, pais } = s.leer((await r.json()) as Record<string, unknown>);
      if (typeof ip === "string" && ip) return { ip, pais: typeof pais === "string" ? pais.toUpperCase() : null, fuente: s.nombre, medido: new Date().toISOString() };
    } catch {
      /* siguiente servicio */
    }
  }
  return { ip: null, pais: null, fuente: null, medido: new Date().toISOString() };
};

let medidor: Medidor = medirSalida;
/** Para pruebas. */
export function usarMedidor(m: Medidor | null) {
  medidor = m ?? medirSalida;
  memoria = null;
}

let memoria: { salida: Salida; hasta: number } | null = null;

/** Salida actual, guardada 60 s (en memoria y en `Sistema` para que la vea la web). */
export async function salidaActual(forzar = false): Promise<Salida> {
  if (!forzar && memoria && memoria.hasta > Date.now()) return memoria.salida;
  if (!forzar) {
    const f = await db.sistema.findUnique({ where: { clave: CLAVES.salida } });
    if (f) {
      const s = JSON.parse(f.valor) as Salida;
      if (s.ip && Date.now() - new Date(s.medido).getTime() < CACHE_MS) {
        memoria = { salida: s, hasta: new Date(s.medido).getTime() + CACHE_MS };
        return s;
      }
    }
  }
  const s = await medidor();
  memoria = { salida: s, hasta: Date.now() + CACHE_MS };
  const valor = JSON.stringify(s);
  await db.sistema.upsert({ where: { clave: CLAVES.salida }, create: { clave: CLAVES.salida, valor }, update: { valor } });
  return s;
}

export function juzgar(a: AjustesRed, s: Salida | null): Veredicto {
  const texto = s?.ip ? `${s.pais ?? "??"} · ${s.ip}` : "sin dato";
  if (a.vpn === "apagado") return { ok: true, estado: "apagado", detalle: `VPN no requerido (salida: ${texto})`, salida: s };
  if (!a.ipEsperada && !a.paisEsperado) return { ok: false, estado: "sin_configurar", detalle: "VPN requerido pero sin IP ni país esperados: configúralos en Cuentas", salida: s };
  if (!s?.ip) return { ok: false, estado: "sin_dato", detalle: "No se pudo medir la IP de salida (ningún servicio respondió)", salida: s };
  const ipOk = !a.ipEsperada || a.ipEsperada === s.ip;
  const paisOk = !a.paisEsperado || a.paisEsperado === s.pais;
  if (ipOk && paisOk) return { ok: true, estado: "activo", detalle: `VPN: activo · ${texto}`, salida: s };
  return {
    ok: false,
    estado: "caido",
    detalle: `VPN: caído · salida ${texto}, se esperaba ${[a.paisEsperado, a.ipEsperada].filter(Boolean).join(" · ")}`,
    salida: s,
  };
}

/** La última salida medida (en memoria o guardada en `Sistema`), sin salir a internet. */
export async function ultimaSalida(): Promise<Salida | null> {
  if (memoria) return memoria.salida;
  const f = await db.sistema.findUnique({ where: { clave: CLAVES.salida } });
  if (!f) return null;
  try {
    return JSON.parse(f.valor) as Salida;
  } catch {
    return null;
  }
}

/**
 * El aviso del VPN con la última medida guardada, sin medir (WEB-09): para pintar la barra de Cuentas
 * y el panel de publicar, que se refrescan cada 30–60 s. La medida trae su hora (`salida.medido`).
 * Se mide sólo en «Medir ahora» (/api/red), al conectar una cuenta y antes de publicar.
 */
export async function verificarSinMedir(): Promise<Veredicto> {
  const a = await leerAjustes();
  const s = await ultimaSalida();
  const v = juzgar(a, s);
  if (!s && v.estado === "sin_dato") return { ...v, detalle: "Todavía no se midió la salida a internet: toca «Medir ahora» en Cuentas" };
  return v;
}

/** ¿Se puede llamar a una red ahora? */
export async function verificarSalida(forzar = false): Promise<Veredicto> {
  const a = await leerAjustes();
  // Con el VPN apagado no se mide antes de cada llamada, sólo si lo piden («Medir ahora», doctor).
  if (a.vpn === "apagado") return juzgar(a, forzar ? await salidaActual(true) : (memoria?.salida ?? null));
  return juzgar(a, await salidaActual(forzar));
}
