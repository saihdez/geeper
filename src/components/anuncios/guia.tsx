"use client";
import { useEffect, useState } from "react";
import { ETAPAS, type Paso } from "@/lib/anuncios/siguiente";
import { Aviso } from "../comun";
import type { Ctx } from "./campana";

/** «Propónme ideas»: borradores del modelo local, con aviso de GPU y espera visible. */
export function BotonIdeas({ ctx, texto = "Propónme ideas", primario = false, ancho = false }: { ctx: Ctx; texto?: string; primario?: boolean; ancho?: boolean }) {
  const [fase, setFase] = useState<"nada" | "confirmar" | "pensando">("nada");
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fase !== "pensando") return;
    const t0 = Date.now();
    const i = setInterval(() => setSegundos(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(i);
  }, [fase]);

  async function pedir() {
    setFase("pensando");
    setSegundos(0);
    setError(null);
    try {
      const r = (await ctx.accion({ tipo: "ideas" })) as { nuevas: string[] };
      setFase("nada");
      ctx.irA("conceptos", r.nuevas[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFase("nada");
    }
  }

  return (
    <div className={ancho ? "w-full" : ""}>
      {fase === "nada" && (
        <button className={`boton ${primario ? "boton-primario" : ""} ${ancho ? "w-full justify-center" : ""}`} onClick={() => setFase("confirmar")}>
          <span aria-hidden>✦</span> {texto}
        </button>
      )}
      {fase === "confirmar" && (
        <div className="space-y-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm">
          <p>El asistente escribe 3 ideas con tu información. Usa la tarjeta de video cerca de un minuto, en esta PC y sin costo.</p>
          <p className="text-tenue">Son borradores: revisa que suenen a tu marca y que todo lo que dicen sea cierto.</p>
          <div className="flex gap-2">
            <button className="boton boton-primario" onClick={() => void pedir()}>Pedir ideas</button>
            <button className="boton" onClick={() => setFase("nada")}>Cancelar</button>
          </div>
        </div>
      )}
      {fase === "pensando" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 text-sm">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent motion-reduce:animate-none" aria-hidden />
          {/* Lo que se anuncia no cambia cada segundo: el contador va fuera de la región viva. */}
          <span role="status">Pensando ideas… <span className="text-tenue">(hasta 1 a 2 minutos la primera vez)</span></span>
          <span className="tabular-nums text-tenue" aria-hidden>{segundos} s</span>
        </div>
      )}
      {error && <div className="mt-2"><Aviso tipo="error">{error}</Aviso></div>}
    </div>
  );
}

/** Tarjeta fija arriba: en qué etapa va la campaña y qué hacer ahora, con un solo botón. */
export function SiguientePaso({ ctx, paso }: { ctx: Ctx; paso: Paso }) {
  return (
    <section className={`rounded-xl border p-4 ${paso.listo ? "border-emerald-800 bg-emerald-950/25" : "border-cyan-900 bg-cyan-950/25"}`} aria-labelledby="siguiente-paso">
      <ol className="mb-3 flex flex-wrap gap-x-1 gap-y-1 text-xs" aria-label="Etapas">
        {ETAPAS.map((e, i) => {
          const n = i + 1;
          const estado = n < paso.etapa ? "hecha" : n === paso.etapa ? "actual" : "pendiente";
          return (
            <li key={e} className="flex items-center gap-1" aria-current={estado === "actual" ? "step" : undefined}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.65rem] font-bold ${
                estado === "hecha" ? "bg-emerald-700 text-white" : estado === "actual" ? "bg-cyan-500 text-black" : "bg-slate-800 text-slate-400"
              }`}>{estado === "hecha" ? "✓" : n}</span>
              <span className={estado === "actual" ? "font-semibold text-white" : "text-tenue"}>{e}</span>
              {n < ETAPAS.length && <span className="mx-1 text-slate-600" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-acento">Siguiente paso</p>
          <h2 id="siguiente-paso" className="text-lg font-semibold">{paso.titulo}</h2>
          <p className="text-sm text-slate-300">{paso.detalle}</p>
        </div>
        {paso.accion === "ideas" ? (
          <div className="flex flex-wrap items-start gap-2">
            <BotonIdeas ctx={ctx} primario />
            <button className="boton" onClick={() => ctx.irA("conceptos")}>Escribirla yo</button>
          </div>
        ) : (
          <button className="boton boton-primario" onClick={() => ctx.irA(paso.ir, paso.concepto)}>{paso.boton}</button>
        )}
      </div>
    </section>
  );
}
