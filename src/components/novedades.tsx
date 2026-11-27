"use client";
import Link from "next/link";
import { useState } from "react";
import type { Informe, Novedad } from "@/lib/novedades";
import { Aviso, fecha, pedir, useSondeo } from "./comun";

const QUE_HACER: Record<string, string> = {
  web: "Es una app de Media: se actualiza ahí con un clic (y se puede volver a la anterior).",
  binario: "Geeper usa su programa: la versión nueva se prueba al lado de la actual antes de cambiarla.",
  codigo: "Geeper tomó código o ideas de este repo: hay que revisar qué cambió y portar lo que sirva.",
  servicio: "Corre aparte (Docker): conviene revisar las notas antes de actualizarlo.",
};

/** Lo que Claude tiene que hacer con una fuente: la frase para pegarle. */
const pedido = (n: Novedad) => `/novedades ${n.id}`;

/** Novedades de los repos de los que salió Geeper (docs/fuentes.json): versiones nuevas y commits desde la última revisión. */
export function Novedades() {
  const { datos, error, recargar } = useSondeo<Informe>("/api/novedades", 60_000);
  const [buscando, setBuscando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function buscarAhora() {
    setBuscando(true);
    setMsg(null);
    try {
      await pedir("/api/novedades?ahora=1");
      await recargar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscando(false);
    }
  }

  async function copiar(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(t);
    } catch {
      setCopiado(null);
    }
  }

  const con = datos?.novedades.filter((n) => n.nuevas.length || n.commits.length) ?? [];
  const errores = datos?.novedades.filter((n) => n.error) ?? [];
  const soloWeb = (n: Novedad) => n.como.length === 1 && n.como[0] === "web";

  return (
    <section aria-labelledby="titulo-novedades" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="titulo-novedades" className="font-medium">Novedades de los repos integrados</h2>
        {datos && <span className="text-xs text-tenue">revisado {fecha(datos.fecha)}</span>}
        <button type="button" className="boton ml-auto py-1 text-xs" disabled={buscando} onClick={() => void buscarAhora()}>{buscando ? "Buscando…" : "Buscar ahora"}</button>
      </div>
      <p className="text-sm text-tenue">
        Geeper mira una vez al día si los proyectos de los que salió (las apps Craft, Hyperframes, MoneyPrinterTurbo, claude-ads…) publicaron
        mejoras. Nada se cambia solo: las apps de <Link href="/media" className="underline">Media</Link> se actualizan con un clic, y para lo
        demás le pides a Claude que lo revise y te proponga qué traer.
      </p>
      {error && <Aviso tipo="error">No se pudieron leer las novedades: {error}</Aviso>}
      {msg && <Aviso tipo="error">{msg}</Aviso>}
      {datos && !con.length && <Aviso tipo="ok">Todo al día: ningún repo tiene cambios desde la última revisión.</Aviso>}
      <ul className="space-y-2">
        {con.map((n) => (
          <li key={n.id} className="tarjeta space-y-1.5 p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <a href={`https://github.com/${n.repo}`} target="_blank" rel="noreferrer" className="font-medium underline">{n.repo}</a>
              {n.nuevas[0] && <span className="rounded bg-sky-900 px-1.5 text-xs">nueva {n.nuevas[0].version}{n.base.version ? ` (usamos ${n.base.version})` : ""}</span>}
              {n.commits.length > 0 && <span className="rounded bg-slate-700 px-1.5 text-xs">{n.commits.length}{n.masCommits ? "+" : ""} cambios desde el {n.base.revisado}</span>}
            </div>
            <p className="text-xs text-tenue">En Geeper: {n.que}</p>
            <p className="text-xs">{n.como.map((c) => QUE_HACER[c]).filter(Boolean).join(" ")}</p>
            {n.nuevas.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-tenue">Notas de {n.nuevas.length === 1 ? "la versión" : `las ${n.nuevas.length} versiones`}</summary>
                {n.nuevas.slice(0, 5).map((r) => (
                  <div key={r.version} className="mt-2">
                    <a href={r.url} target="_blank" rel="noreferrer" className="font-medium underline">{r.version}</a> <span className="text-tenue">{r.fecha}</span>
                    {r.notas && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-sans">{r.notas.slice(0, 1500)}</pre>}
                  </div>
                ))}
              </details>
            )}
            {n.commits.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-tenue">Cambios en el código</summary>
                <ul className="mt-1 space-y-0.5">
                  {n.commits.slice(0, 15).map((c) => (
                    <li key={c.sha}><a href={c.url} target="_blank" rel="noreferrer" className="font-mono underline">{c.sha}</a> <span className="text-tenue">{c.fecha}</span> {c.mensaje}</li>
                  ))}
                </ul>
              </details>
            )}
            {soloWeb(n) ? (
              <Link href="/media" className="inline-block text-xs underline">Actualizar en Media</Link>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-tenue">Pídele a Claude Code en este proyecto:</span>
                <code className="rounded bg-black/40 px-1.5 py-0.5">{pedido(n)}</code>
                <button type="button" className="underline" onClick={() => void copiar(pedido(n))}>{copiado === pedido(n) ? "Copiado" : "Copiar"}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {errores.length > 0 && <p className="text-xs text-amber-200">No se pudo revisar: {errores.map((n) => `${n.repo} (${n.error})`).join("; ")}</p>}
    </section>
  );
}
