"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { etapaSimple, explicarError, nombreTipo } from "@/lib/textos";
import { Aviso, Barra, Estado, haceCuanto, MotorApagado, postJson, segundos, useSondeo } from "./comun";
import { CambiarLink, ofreceCambiarLink } from "./cambiar-link";

interface Trabajo {
  id: string;
  tipo: string;
  motor: string;
  estado: string;
  etapa: string;
  progreso: number;
  error: string | null;
  intentos: number;
  usaGpu: boolean;
  creado: string;
  iniciado: string | null;
  terminado: string | null;
  proyecto: { nombre: string; slug: string } | null;
  proyectoId: string | null;
}

function duracion(t: Trabajo, ahora: number) {
  if (!t.iniciado) return "";
  const fin = t.terminado ? new Date(t.terminado).getTime() : ahora;
  return segundos(Math.max(0, (fin - new Date(t.iniciado).getTime()) / 1000));
}

/** Cuándo se pidió, para encontrar lo de hoy sin leer todo (UX-41). */
function cuando(t: Trabajo, ahora: number) {
  return haceCuanto(t.creado, ahora);
}

/** Terminados que se muestran antes de «Ver más». */
export const MAX_TERMINADOS = 20;

type Grupo = { id: "curso" | "turno" | "atencion" | "terminados"; titulo: string; trabajos: Trabajo[] };

/** UX-41: lo que pasa ahora arriba; lo que necesita atención aparte; lo terminado al final. */
export function agruparTrabajos<T extends Pick<Trabajo, "estado">>(trabajos: T[]): { id: Grupo["id"]; titulo: string; trabajos: T[] }[] {
  const de = (...estados: string[]) => trabajos.filter((t) => estados.includes(t.estado));
  return [
    { id: "curso", titulo: "En curso", trabajos: de("corriendo") },
    { id: "turno", titulo: "Esperando su turno", trabajos: de("pendiente") },
    { id: "atencion", titulo: "Necesitan atención", trabajos: de("fallido", "interrumpido") },
    { id: "terminados", titulo: "Terminados", trabajos: trabajos.filter((t) => !["corriendo", "pendiente", "fallido", "interrumpido"].includes(t.estado)) },
  ];
}

/** ¿La caja está (casi) al final? Si la persona subió para leer, no se la baja de golpe (UX-41). */
export function cercaDelFinal(el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">, margen = 40): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < margen;
}

function Log({ id, vivo }: { id: string; vivo: boolean }) {
  const [texto, setTexto] = useState("Cargando…");
  const caja = useRef<HTMLPreElement>(null);
  // Se abre por el final (lo último que pasó) y lo sigue mientras la persona no suba a leer (UX-41).
  // Se mide al desplazarse, antes de que llegue texto nuevo: después la caja ya creció.
  const pegado = useRef(true);
  useEffect(() => {
    const el = caja.current;
    if (el && pegado.current) el.scrollTop = el.scrollHeight;
  }, [texto]);
  useEffect(() => {
    let activo = true;
    const cargar = () =>
      fetch(`/api/trabajos/${id}/log?lineas=300`).then((r) => r.text()).then((t) => activo && setTexto(t)).catch(() => undefined);
    void cargar();
    const i = vivo ? setInterval(cargar, 2000) : undefined;
    return () => {
      activo = false;
      if (i) clearInterval(i);
    };
  }, [id, vivo]);
  return <pre ref={caja} onScroll={(e) => { pegado.current = cercaDelFinal(e.currentTarget); }} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-3 text-xs leading-relaxed text-slate-300">{texto}</pre>;
}

/** UX-14: el error en palabras simples; el texto tal cual, plegado, para quien dé soporte. */
export function ErrorTrabajo({ error }: { error: string }) {
  const { simple, detalle } = explicarError(error);
  return (
    <div className="mt-2 text-sm text-red-200">
      <p>{simple}</p>
      {detalle && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-tenue">Ver detalle técnico</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-black/60 p-2 text-red-300">{detalle}</pre>
        </details>
      )}
    </div>
  );
}

export function ListaTrabajos({ proyectoId }: { proyectoId?: string }) {
  const { datos, error, recargar } = useSondeo<{ trabajos: Trabajo[]; workerVivo: boolean; escritorio?: boolean; ahora: number }>(
    `/api/trabajos${proyectoId ? `?proyecto=${proyectoId}` : ""}`,
    2000,
  );
  const [abierto, setAbierto] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const workerVivo = datos?.workerVivo;

  const [verTodos, setVerTodos] = useState(false);
  const grupos = agruparTrabajos(datos?.trabajos ?? []);
  // «hace 5 min» se refresca solo cada minuto, aunque la lista no cambie.
  const [ahoraCliente, setAhoraCliente] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setAhoraCliente(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);

  function fila(t: Trabajo) {
    const vivo = t.estado === "corriendo" || t.estado === "pendiente";
    return (
      <li key={t.id} className="tarjeta p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Estado valor={t.estado} />
          <span className="font-medium">{nombreTipo(t.tipo)}</span>
          {!proyectoId && t.proyecto && (
            <Link href={`/proyectos/${t.proyectoId}`} className="truncate text-sm text-acento hover:underline">{t.proyecto.nombre}</Link>
          )}
          <span className="text-xs text-tenue">{cuando(t, ahoraCliente)}{t.iniciado ? ` · ${duracion(t, datos?.ahora || ahoraCliente)}` : ""}</span>
          <span className="ml-auto flex gap-2">
            {["fallido", "interrumpido", "cancelado"].includes(t.estado) && (
              <button type="button" className="boton" onClick={() => void accion(t.id, "relanzar")}>Volver a intentar</button>
            )}
            {/* UX-17: si el link de la página web no abría, se corrige sin escribir todo otra vez. */}
            {ofreceCambiarLink(t) && <CambiarLink trabajoId={t.id} />}
            {vivo && <button type="button" className="boton boton-peligro" onClick={() => void accion(t.id, "cancelar")}>Cancelar</button>}
            <button type="button" className="boton" aria-expanded={abierto === t.id} onClick={() => setAbierto(abierto === t.id ? null : t.id)}>
              {abierto === t.id ? "Ocultar el registro" : "Ver el registro"}
            </button>
          </span>
        </div>
        {t.estado === "corriendo" && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-sky-200">{etapaSimple(t.etapa, t.estado)}</p>
            <Barra valor={t.progreso} etiqueta={`Avance: ${nombreTipo(t.tipo)}`} />
          </div>
        )}
        {t.error && <ErrorTrabajo error={t.error} />}
        {abierto === t.id && <Log id={t.id} vivo={vivo} />}
      </li>
    );
  }

  async function accion(id: string, a: "relanzar" | "cancelar") {
    setFallo(null);
    try {
      await postJson(`/api/trabajos/${id}`, { accion: a });
      await recargar();
    } catch (e) {
      setFallo(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-3">
      {datos && !workerVivo && <MotorApagado escritorio={datos.escritorio} />}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {fallo && <Aviso tipo="error">{fallo}</Aviso>}
      {datos?.trabajos.length === 0 && <p className="text-sm text-tenue">Todavía no hay nada: aquí verás cada cosa que Geeper haga por ti.</p>}
      {datos && grupos.map((g) => {
        if (!g.trabajos.length) return null;
        const lista = g.id === "terminados" && !verTodos ? g.trabajos.slice(0, MAX_TERMINADOS) : g.trabajos;
        const filas = <ul className="space-y-2">{lista.map(fila)}</ul>;
        const titulo = <>{g.titulo} <span className="font-normal text-tenue">({g.trabajos.length})</span></>;
        return g.id === "terminados" ? (
          <details key={g.id} className="space-y-2">
            <summary className="cursor-pointer font-medium">{titulo}</summary>
            <div className="mt-2 space-y-2">
              {filas}
              {g.trabajos.length > MAX_TERMINADOS && !verTodos && (
                <button type="button" className="boton" onClick={() => setVerTodos(true)}>Ver más ({g.trabajos.length - MAX_TERMINADOS})</button>
              )}
            </div>
          </details>
        ) : (
          <section key={g.id} className="space-y-2" aria-label={g.titulo}>
            <h3 className="font-medium">{titulo}</h3>
            {filas}
          </section>
        );
      })}
    </div>
  );
}