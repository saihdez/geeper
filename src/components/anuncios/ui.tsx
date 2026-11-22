"use client";
import { cloneElement, isValidElement, useId, useState } from "react";
import type { ResultadoChequeo } from "@/lib/anuncios/esquema";

export type Resumen = Record<ResultadoChequeo, number>;

const ESTILO: Record<ResultadoChequeo, { c: string; i: string; n: string }> = {
  pass: { c: "bg-emerald-900/70 text-emerald-200 border-emerald-700/60", i: "✓", n: "Pasa" },
  fail: { c: "bg-red-950/80 text-red-200 border-red-800/70", i: "✕", n: "Falla" },
  unknown: { c: "bg-amber-950/70 text-amber-200 border-amber-700/60", i: "?", n: "Sin saber" },
  not_applicable: { c: "bg-zinc-800/70 text-zinc-400 border-zinc-700", i: "—", n: "No aplica" },
};

export const NOMBRE_RESULTADO = Object.fromEntries(Object.entries(ESTILO).map(([k, v]) => [k, v.n])) as Record<ResultadoChequeo, string>;

/** Pastilla de resultado de un chequeo. */
export function Resultado({ valor, corto = false }: { valor: ResultadoChequeo; corto?: boolean }) {
  const e = ESTILO[valor];
  return (
    <span className={`inline-flex shrink-0 self-start items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${e.c}`} title={e.n}>
      <span aria-hidden>{e.i}</span>
      {corto ? <span className="sr-only">{e.n}</span> : <span>{e.n}</span>}
    </span>
  );
}

/** Contadores de una revisión. */
export function Contadores({ r, compacto = false }: { r: Resumen; compacto?: boolean }) {
  const items: ResultadoChequeo[] = ["pass", "fail", "unknown"];
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Resumen de la revisión">
      {items.map((k) => (
        <span key={k} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${ESTILO[k].c} ${r[k] === 0 ? "opacity-40" : ""}`}>
          <span aria-hidden>{ESTILO[k].i}</span>
          {r[k]}
          <span className={compacto ? "sr-only" : "font-normal"}>{ESTILO[k].n.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

/** Barra apilada pass/fail/unknown. */
export function BarraResumen({ r }: { r: Resumen }) {
  const total = r.pass + r.fail + r.unknown;
  if (!total) return <div className="h-1.5 rounded bg-slate-800" />;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-1.5 overflow-hidden rounded bg-slate-800" role="img" aria-label={`${r.pass} pasan, ${r.fail} fallan, ${r.unknown} sin saber`}>
      <div className="bg-emerald-500" style={{ width: w(r.pass) }} />
      <div className="bg-red-500" style={{ width: w(r.fail) }} />
      <div className="bg-amber-400" style={{ width: w(r.unknown) }} />
    </div>
  );
}

/** Botón «?» que despliega una explicación en lenguaje simple. */
export function Ayuda({ texto, de }: { texto: string; de: string }) {
  const [abierta, setAbierta] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
        aria-controls={id}
        aria-label={`Qué significa «${de}»`}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[0.65rem] leading-none text-slate-300 hover:border-cyan-400 hover:text-white"
      >
        ?
      </button>
      {abierta && (
        <span id={id} role="note" className="mt-1 block rounded-md border border-cyan-900 bg-cyan-950/40 px-2 py-1.5 text-xs text-slate-200">
          {texto}
        </span>
      )}
    </>
  );
}

export function Campo({ etiqueta, ayuda, que, children, contador }: { etiqueta: string; ayuda?: string; que?: string; children: React.ReactNode; contador?: { n: number; max: number } }) {
  const id = useId();
  // La etiqueta apunta al control con htmlFor, así el «?» puede ir al lado sin quedar dentro del <label>.
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id: children.props.id ?? id }) : children;
  return (
    <div>
      <div className="etiqueta">
        <span className="flex items-baseline justify-between gap-2">
          <span>
            <label htmlFor={isValidElement(children) ? id : undefined}>{etiqueta}</label>
            {que && <Ayuda texto={que} de={etiqueta} />}
          </span>
          {contador && <span className={`tabular-nums ${contador.n > contador.max ? "text-red-300" : ""}`}>{contador.n}/{contador.max}</span>}
        </span>
      </div>
      {control}
      {ayuda && <span className="mt-1 block text-xs text-tenue">{ayuda}</span>}
    </div>
  );
}

export function Seccion({ titulo, descripcion, children, accion }: { titulo: string; descripcion?: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <section className="tarjeta p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{titulo}</h3>
          {descripcion && <p className="mt-0.5 text-sm text-tenue">{descripcion}</p>}
        </div>
        {accion}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Interruptor tipo chip (seleccionable). */
export function Chip({ activo, onClick, children, titulo }: { activo: boolean; onClick: () => void; children: React.ReactNode; titulo?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={titulo}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
        activo ? "border-cyan-600 bg-cyan-950/60 text-cyan-100" : "border-borde bg-[#0f131a] text-tenue hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nuevoId(prefijo: string): string {
  return `${prefijo}-${Math.random().toString(36).slice(2, 8)}`;
}
