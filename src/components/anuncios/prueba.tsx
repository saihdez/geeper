"use client";
import { UNIDADES_PRUEBA, VARIABLES_PRUEBA } from "@/lib/anuncios/catalogo";
import type { Prueba } from "@/lib/anuncios/esquema";
import { leerPrueba, type Veredicto } from "@/lib/anuncios/lectura";
import { tamanoMuestra } from "@/lib/anuncios/muestra";
import { Aviso, numero as cifra } from "../comun";
import type { Ctx } from "./campana";
import { QUE } from "./textos";
import { Ayuda, Campo, Chip, NOMBRE_RESULTADO, Seccion } from "./ui";

const METRICAS = ["Clics", "Compras", "Mensajes recibidos", "Registros", "Instalaciones"];
const MEJORAS = [
  { v: 10, t: "Pequeña (10 %)", d: "necesita mucha gente" },
  { v: 25, t: "Mediana (25 %)", d: "lo más común" },
  { v: 50, t: "Grande (50 %)", d: "se nota rápido" },
];

function numero(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

const miles = (n: number) => cifra(n);

export function PestanaPrueba({ ctx }: { ctx: Ctx }) {
  const p = ctx.datos.prueba;
  const conceptos = ctx.datos.conceptos;
  const set = <K extends keyof Prueba>(k: K, v: Prueba[K]) => ctx.cambiar((d) => ({ ...d, prueba: { ...d.prueba, [k]: v } }));
  const m = tamanoMuestra({ tasaBase: p.tasaBase, efectoMinimo: p.efectoMinimo, alfa: p.alfa, potencia: p.potencia, tratamientos: p.tratamientos.length || 1, volumenDiario: p.volumenDiario });
  const nombre = (id: string | null) => conceptos.find((c) => c.id === id)?.nombre;
  const noListos = [p.control, ...p.tratamientos]
    .filter((id): id is string => Boolean(id))
    .map((id) => ctx.revision.conceptos.find((r) => r.conceptoId === id))
    .filter((r) => r && (r.resumen.fail > 0 || r.resumen.unknown > 0));

  if (conceptos.length < 2) {
    return (
      <div className="tarjeta mx-auto max-w-xl p-8 text-center">
        <h2 className="text-lg font-semibold">Para comparar necesitas dos ideas</h2>
        <p className="mt-2 text-sm text-tenue">Comparar dos anuncios con la misma audiencia y al mismo tiempo es la forma confiable de saber cuál funciona mejor, en vez de adivinar.</p>
        <button className="boton boton-primario mt-4" onClick={() => ctx.irA("conceptos")}>Ir a Ideas</button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      {/* min-w-0: sin esto la tabla de resultados ensancha la columna en el celular. */}
      <div className="min-w-0 space-y-4">
        <Seccion titulo="1. ¿Qué ideas comparas?" descripcion="La base es la que ya usas o la más segura; la otra compite contra ella.">
          <Campo etiqueta="Idea base">
            <select className="campo" value={p.control ?? ""} onChange={(e) => {
              const v = e.target.value || null;
              ctx.cambiar((d) => ({ ...d, prueba: { ...d.prueba, control: v, tratamientos: d.prueba.tratamientos.filter((t) => t !== v) } }));
            }}>
              <option value="">Elige…</option>
              {conceptos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <div>
            <span className="etiqueta">Ideas que compiten (toca para elegir)</span>
            <div className="flex flex-wrap gap-2">
              {conceptos.filter((c) => c.id !== p.control).map((c) => (
                <Chip key={c.id} activo={p.tratamientos.includes(c.id)} onClick={() => set("tratamientos", p.tratamientos.includes(c.id) ? p.tratamientos.filter((t) => t !== c.id) : [...p.tratamientos, c.id])}>{c.nombre}</Chip>
              ))}
            </div>
            {p.tratamientos.length > 1 && <p className="mt-1 text-xs text-tenue">Con más de una idea compitiendo hace falta más gente para estar seguro.</p>}
          </div>
          <Campo etiqueta="¿Qué cambia entre ellas?" que={QUE.variable}>
            <select className="campo" value={p.variable} onChange={(e) => set("variable", e.target.value as Prueba["variable"])}>
              {Object.entries(VARIABLES_PRUEBA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          {noListos.length > 0 && (
            <Aviso tipo="alerta">A «{noListos.map((r) => r!.nombre).join("», «")}» le falta terminar la revisión. Arréglalo antes de lanzar, así la comparación es justa.</Aviso>
          )}
        </Seccion>

        <Seccion titulo="2. ¿Cómo sabrás cuál gana?">
          <Campo etiqueta="Lo que vas a contar" que={QUE.metrica}>
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                {METRICAS.map((x) => <Chip key={x} activo={p.metrica === x} onClick={() => set("metrica", x)}>{x}</Chip>)}
              </div>
              <input className="campo" value={p.metrica} maxLength={120} onChange={(e) => set("metrica", e.target.value)} placeholder="U otra cosa: escríbela" aria-label="Métrica" />
            </div>
          </Campo>
          <Campo etiqueta="Lo que no puede empeorar" que={QUE.guardarrailes}>
            <input className="campo" value={p.guardarrailes} maxLength={400} onChange={(e) => set("guardarrailes", e.target.value)} placeholder="Ej.: que cada venta no cueste más de 15 % que ahora" />
          </Campo>
        </Seccion>

        <Seccion titulo="3. ¿Cuánto tiempo hay que dejarla correr?" descripcion="Con estos tres datos Geeper calcula cuánta gente debe ver cada anuncio antes de decidir.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="De cada 100 personas, ¿cuántas lo hacen hoy? (%)" que={QUE.tasaBase}>
              <input className="campo tabular-nums" inputMode="decimal" defaultValue={p.tasaBase ?? ""} onChange={(e) => set("tasaBase", numero(e.target.value))} placeholder="Ej.: 1,2" />
            </Campo>
            <Campo etiqueta="¿Cuántas personas ve cada anuncio por día?" que={QUE.volumen}>
              <input className="campo tabular-nums" inputMode="numeric" defaultValue={p.volumenDiario ?? ""} onChange={(e) => set("volumenDiario", numero(e.target.value))} placeholder="Ej.: 4000" />
            </Campo>
          </div>
          <div>
            <span className="etiqueta">¿Qué mejora te haría cambiar de idea? <Ayuda texto={QUE.efecto} de="mejora mínima" /></span>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mejora mínima">
              {MEJORAS.map((x) => (
                <button key={x.v} type="button" role="radio" aria-checked={p.efectoMinimo === x.v} onClick={() => set("efectoMinimo", x.v)}
                  className={`rounded-lg border p-3 text-left text-sm ${p.efectoMinimo === x.v ? "border-cyan-500 bg-cyan-950/50" : "border-borde bg-[#0f131a] hover:border-slate-500"}`}>
                  <span className="block font-medium">{x.t}</span>
                  <span className="block text-xs text-tenue">{x.d}</span>
                </button>
              ))}
            </div>
          </div>
          <details className="rounded-lg border border-borde p-3">
            <summary className="cursor-pointer text-sm text-tenue hover:text-white">Opciones avanzadas</summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Mejora mínima exacta (%)" que={QUE.efecto}>
                  <input key={p.efectoMinimo ?? "x"} className="campo tabular-nums" inputMode="decimal" defaultValue={p.efectoMinimo ?? ""} onChange={(e) => set("efectoMinimo", numero(e.target.value))} />
                </Campo>
                <Campo etiqueta="Cómo se reparte" que={QUE.unidad}>
                  <select className="campo" value={p.unidad} onChange={(e) => set("unidad", e.target.value as Prueba["unidad"])}>
                    {Object.entries(UNIDADES_PRUEBA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Riesgo de falso ganador (α)" que={QUE.alfa}>
                  <select className="campo" value={p.alfa} onChange={(e) => set("alfa", Number(e.target.value))}>
                    {[0.01, 0.05, 0.1].map((a) => <option key={a} value={a}>{(a * 100).toFixed(0)} %</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Seguridad de notar la mejora (potencia)" que={QUE.potencia}>
                  <select className="campo" value={p.potencia} onChange={(e) => set("potencia", Number(e.target.value))}>
                    {[0.8, 0.9, 0.95].map((a) => <option key={a} value={a}>{(a * 100).toFixed(0)} %</option>)}
                  </select>
                </Campo>
              </div>
              <Campo etiqueta="Qué decisión tomarás con el resultado">
                <input className="campo" value={p.decision} maxLength={400} onChange={(e) => set("decision", e.target.value)} placeholder="Ej.: con qué idea invertimos en diciembre" />
              </Campo>
              <Campo etiqueta="Qué esperas que pase" que={QUE.hipotesis}>
                <input className="campo" value={p.hipotesis} maxLength={400} onChange={(e) => set("hipotesis", e.target.value)} />
              </Campo>
              <Campo etiqueta="Cuándo termina" que={QUE.parada}>
                <input className="campo" value={p.reglaParada} maxLength={400} onChange={(e) => set("reglaParada", e.target.value)} placeholder="Ej.: al llegar a la gente calculada, no antes" />
              </Campo>
            </div>
          </details>
        </Seccion>

        <Resultados ctx={ctx} planeada={m.ok ? m.porVariante : null} />
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="tarjeta p-4" aria-live="polite">
          <h3 className="font-semibold">Cuánta gente hace falta</h3>
          {m.ok ? (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-3xl font-bold tabular-nums">{miles(m.porVariante)}</p>
                <p className="text-sm text-tenue">personas por anuncio · {miles(m.total)} en total</p>
              </div>
              <p className="text-sm">{m.dias != null ? <>Déjala correr unos <b className="tabular-nums">{Math.max(7, m.dias)} días</b>{m.dias < 7 ? " (mínimo una semana)" : ""}.</> : <span className="text-tenue">Dinos cuántas personas ve cada anuncio por día para calcular los días.</span>}</p>
              <p className="text-xs text-tenue">Hoy: {cifra(m.p1 * 100, 2)} %. Para notar la mejora debería llegar a {cifra(m.p2 * 100, 2)} %.</p>
              {m.avisos.filter((a) => !a.startsWith("Menos de una semana")).map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
            </div>
          ) : (
            <p className="mt-2 text-sm text-tenue">Completa las preguntas del paso 3. Geeper no calcula con datos inventados.</p>
          )}
        </section>
        <section className="tarjeta p-4">
          <h3 className="font-semibold">Para que la comparación sea justa</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
            {[
              "Cambia una sola cosa entre las ideas.",
              "Muéstralas al mismo tiempo, al mismo público y con el mismo presupuesto.",
              "No la cortes antes: los primeros días engañan.",
              "Decide con tu número, no con lo que la plataforma marque como «mejor».",
            ].map((r) => <li key={r} className="flex gap-2"><span aria-hidden className="text-acento">•</span>{r}</li>)}
          </ul>
          {p.control && p.tratamientos.length > 0 && (
            <p className="mt-3 text-sm text-tenue">
              Comparas <b className="text-white">{nombre(p.control)}</b> contra {p.tratamientos.map((t) => nombre(t)).filter(Boolean).join(", ")}, cambiando <b className="text-white">{VARIABLES_PRUEBA[p.variable].toLowerCase()}</b>.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

const COLOR_VEREDICTO: Record<Veredicto, string> = {
  gana: "border-emerald-700 bg-emerald-950/40",
  pierde: "border-red-800 bg-red-950/40",
  "sin-diferencia": "border-borde bg-[#0f131a]",
  temprano: "border-amber-700 bg-amber-950/30",
  falta: "border-borde bg-[#0f131a]",
  invalido: "border-red-800 bg-red-950/40",
};

function Resultados({ ctx, planeada }: { ctx: Ctx; planeada: number | null }) {
  const p = ctx.datos.prueba;
  const set = <K extends keyof Prueba>(k: K, v: Prueba[K]) => ctx.cambiar((d) => ({ ...d, prueba: { ...d.prueba, [k]: v } }));
  const variantes = [p.control, ...p.tratamientos].filter((x): x is string => Boolean(x));
  const nombres = Object.fromEntries(ctx.datos.conceptos.map((c) => [c.id, c.nombre]));
  const setConteo = (id: string, campo: "unidades" | "conversiones", v: string) =>
    ctx.cambiar((d) => {
      const n = v.trim() === "" ? null : Math.max(0, Math.floor(Number(v.replace(/[.\s]/g, ""))));
      const actual = d.prueba.resultados[id] ?? { unidades: null, conversiones: null };
      return { ...d, prueba: { ...d.prueba, resultados: { ...d.prueba.resultados, [id]: { ...actual, [campo]: Number.isFinite(n) ? n : null } } } };
    });
  if (!p.control || !p.tratamientos.length) {
    return (
      <Seccion titulo="4. Resultados" descripcion="Cuando la comparación termine, carga aquí los números de la plataforma.">
        <p className="text-sm text-tenue">Primero elige las ideas en el paso 1.</p>
      </Seccion>
    );
  }
  const l = leerPrueba({ control: p.control, tratamientos: p.tratamientos, resultados: p.resultados, alfa: p.alfa, planeada, guardarrailes: p.guardarrailesOk, nombres });
  return (
    <Seccion titulo="4. Resultados" descripcion="Cuando termine, copia los números de la plataforma. Usa el mismo rango de fechas para todas las ideas.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Empezó el"><input type="date" className="campo" value={p.inicio} onChange={(e) => set("inicio", e.target.value)} /></Campo>
        <Campo etiqueta="Terminó el (o último dato)"><input type="date" className="campo" value={p.fin} onChange={(e) => set("fin", e.target.value)} /></Campo>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-tenue">
              <th className="py-1.5 font-normal">Idea</th>
              <th className="py-1.5 font-normal">Personas que la vieron <Ayuda texto={QUE.resultados} de="resultados" /></th>
              <th className="py-1.5 font-normal">{p.metrica || "Acciones"}</th>
              <th className="py-1.5 text-right font-normal">De cada 100</th>
            </tr>
          </thead>
          <tbody>
            {variantes.map((id, i) => {
              const r = p.resultados[id];
              const tasa = r?.unidades && r.conversiones != null ? cifra((r.conversiones / r.unidades) * 100, 2) : "—";
              return (
                <tr key={id} className="border-t border-borde">
                  <td className="py-1.5 pr-2">{nombres[id] ?? id} {i === 0 && <span className="text-xs text-tenue">(base)</span>}</td>
                  <td className="py-1.5 pr-2"><input className="campo tabular-nums" inputMode="numeric" defaultValue={r?.unidades ?? ""} onChange={(e) => setConteo(id, "unidades", e.target.value)} aria-label={`Personas que vieron ${nombres[id]}`} /></td>
                  <td className="py-1.5 pr-2"><input className="campo tabular-nums" inputMode="numeric" defaultValue={r?.conversiones ?? ""} onChange={(e) => setConteo(id, "conversiones", e.target.value)} aria-label={`${p.metrica || "Acciones"} de ${nombres[id]}`} /></td>
                  <td className="py-1.5 text-right tabular-nums">{tasa}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <span className="etiqueta">¿Se mantuvo «{p.guardarrailes || "lo que no podía empeorar"}»?</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-borde" role="radiogroup" aria-label="Lo que no podía empeorar">
          {(["pass", "fail", "unknown"] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={p.guardarrailesOk === o} onClick={() => set("guardarrailesOk", o)}
              className={`px-3 py-1.5 text-xs ${p.guardarrailesOk === o ? "bg-cyan-900 text-white" : "bg-[#0f131a] text-tenue hover:text-white"}`}>
              {o === "pass" ? "Sí" : o === "fail" ? "No, empeoró" : NOMBRE_RESULTADO.unknown}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2" aria-live="polite">
        <p className="rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 font-medium">{l.decision}</p>
        {l.comparaciones.map((c) => <p key={c.tratamiento} className={`rounded-lg border p-2.5 text-sm ${COLOR_VEREDICTO[c.veredicto]}`}>{c.texto}</p>)}
        {l.avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
        <details className="text-xs text-tenue">
          <summary className="cursor-pointer">Cómo se calcula</summary>
          <p className="mt-1">Prueba z de dos proporciones, bilateral, con α = {cifra(l.alfaCorregido * 100, 2)} % por comparación (corregido si hay varias ideas compitiendo). El intervalo es el rango probable de la diferencia real; p es la probabilidad de ver una diferencia así por pura suerte.</p>
        </details>
      </div>
    </Seccion>
  );
}
