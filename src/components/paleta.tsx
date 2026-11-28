"use client";
/**
 * Buscador de acciones (Ctrl+K o ⌘K, o la lupa de la barra): se escribe lo que se
 * quiere hacer («quitar silencios», «cambiar a 16:9», «renderizar») y se ejecuta sin buscar el botón.
 * Idea de la paleta de comandos de PdfCraft. Las páginas suman sus acciones con useAccionesPaleta.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DESTINOS } from "@/lib/destinos";

export interface AccionPaleta {
  id: string;
  titulo: string;
  /** Sección del listado: «Este proyecto», «Ir a»… */
  grupo: string;
  /** Otras palabras con las que alguien podría buscarla (sinónimos). */
  palabras?: string;
  /** Explicación corta debajo del título. */
  detalle?: string;
  /** Si se pide confirmación antes de ejecutarla. */
  confirmar?: string;
  deshabilitada?: boolean;
  hacer: () => void | Promise<unknown>;
}

// ---- Registro de acciones (fuera de React para que cualquier página las sume).
const registradas = new Map<string, AccionPaleta[]>();
const oyentes = new Set<() => void>();
let instantanea: AccionPaleta[] = [];
function avisar() {
  instantanea = [...registradas.values()].flat();
  for (const o of oyentes) o();
}
const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => void oyentes.delete(o);
};
const VACIO: AccionPaleta[] = [];

/** Lo visible de una lista de acciones (sin `hacer`): si no cambia, no hace falta avisar a la paleta. */
export function firmaAcciones(acciones: AccionPaleta[]): string {
  return JSON.stringify(acciones.map(({ id, titulo, grupo, palabras, detalle, confirmar, deshabilitada }) => [id, titulo, grupo, palabras, detalle, confirmar, deshabilitada]));
}

/** Suma acciones a la paleta mientras el componente esté montado. */
export function useAccionesPaleta(clave: string, acciones: AccionPaleta[]) {
  const ref = useRef(acciones);
  useEffect(() => {
    ref.current = acciones;
  });
  // Sólo se vuelve a registrar (y a repintar la paleta) si cambia lo que se ve, no en cada render.
  const firma = firmaAcciones(acciones);
  useEffect(() => {
    // Se envuelven para llamar siempre a la versión más nueva (los cierres cambian en cada render).
    registradas.set(clave, ref.current.map((a, i) => ({ ...a, hacer: () => ref.current[i]?.hacer() })));
    avisar();
  }, [clave, firma]);
  useEffect(() => () => {
    registradas.delete(clave);
    avisar();
  }, [clave]);
}

/** Las acciones que las páginas registraron ahora mismo (el chat del asistente las ofrece y las ejecuta). */
export function useAccionesRegistradas(): AccionPaleta[] {
  return useSyncExternalStore(suscribir, () => instantanea, () => VACIO);
}

const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Todas las palabras buscadas tienen que aparecer (en cualquier orden); el título pesa más. */
export function filtrar(acciones: AccionPaleta[], consulta: string): AccionPaleta[] {
  const partes = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (partes.length === 0) return acciones;
  return acciones
    .map((a) => {
      const titulo = normalizar(a.titulo);
      const todo = `${titulo} ${normalizar(a.palabras ?? "")} ${normalizar(a.grupo)}`;
      if (!partes.every((p) => todo.includes(p))) return null;
      const puntos = partes.reduce((n, p) => n + (titulo.startsWith(p) ? 3 : titulo.includes(p) ? 2 : 0), 0);
      return { a, puntos };
    })
    .filter((x): x is { a: AccionPaleta; puntos: number } => x !== null)
    .sort((x, y) => y.puntos - x.puntos)
    .map((x) => x.a);
}

export function Paleta() {
  const router = useRouter();
  const propias = useSyncExternalStore(suscribir, () => instantanea, () => VACIO);
  const [abierta, setAbierta] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [activa, setActiva] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const idLista = useId();

  const todas = useMemo<AccionPaleta[]>(() => [
    ...propias,
    ...DESTINOS.map((r) => ({ id: `ir:${r.ruta}`, titulo: r.titulo, grupo: "Ir a", palabras: r.palabras, hacer: () => router.push(r.ruta) })),
  ], [propias, router]);
  const lista = useMemo(() => filtrar(todas, consulta), [todas, consulta]);

  const abrir = useCallback(() => {
    setConsulta("");
    setActiva(0);
    setError(null);
    setAbierta(true);
  }, []);
  const cerrar = useCallback(() => setAbierta(false), []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (abierta) cerrar();
        else abrir();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierta, abrir, cerrar]);

  // Al bajar con las flechas, la opción activa no se sale de la vista.
  useEffect(() => {
    if (abierta) document.getElementById(`${idLista}-${activa}`)?.scrollIntoView({ block: "nearest" });
  }, [abierta, activa, idLista]);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierta && !d.open) d.showModal();
    if (!abierta && d.open) d.close();
  }, [abierta]);

  async function ejecutar(a: AccionPaleta | undefined) {
    if (!a || a.deshabilitada) return;
    if (a.confirmar && !confirm(a.confirmar)) return;
    cerrar();
    try {
      await a.hacer();
    } catch (e) {
      // Las acciones del proyecto muestran su propio aviso; esto cubre las demás.
      setError(e instanceof Error ? e.message : String(e));
      setAbierta(true);
    }
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiva((i) => Math.min(lista.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiva((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void ejecutar(lista[activa]);
    }
  }

  return (
    <>
      <button type="button" onClick={abrir} aria-label="Buscar acción" title="Buscar acción (Ctrl K)"
        className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-borde text-tenue transition hover:bg-white/5 hover:text-white"
        aria-keyshortcuts="Control+K Meta+K">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      <dialog ref={dialogo} onClose={cerrar} onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}
        aria-label="Buscar acción"
        className="m-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-borde bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60">
        {abierta && (
          <div className="flex max-h-[70vh] flex-col">
            <input autoFocus className="w-full border-b border-borde bg-transparent px-4 py-3 text-base outline-none"
              placeholder="¿Qué quieres hacer? Por ejemplo: quitar silencios, 16:9, crear el video"
              value={consulta} onKeyDown={teclas}
              onChange={(e) => { setConsulta(e.target.value); setActiva(0); }}
              role="combobox" aria-expanded aria-controls={idLista} aria-autocomplete="list"
              aria-activedescendant={lista[activa] ? `${idLista}-${activa}` : undefined} />
            {error && <p className="border-b border-red-800 bg-red-950/50 px-4 py-2 text-sm" role="alert">{error}</p>}
            <ul id={idLista} role="listbox" aria-label="Acciones" className="overflow-auto py-1">
              {lista.length === 0 && <li className="px-4 py-3 text-sm text-tenue">No encontré nada con «{consulta}». Prueba con otra palabra.</li>}
              {lista.map((a, i) => {
                const titulo = i === 0 || lista[i - 1]!.grupo !== a.grupo ? a.grupo : null;
                return (
                  <li key={a.id} role="presentation">
                    {titulo && <p className="px-4 pb-1 pt-2 text-xs uppercase tracking-wide text-tenue" aria-hidden>{titulo}</p>}
                    <div id={`${idLista}-${i}`} role="option" aria-selected={i === activa} aria-disabled={a.deshabilitada || undefined}
                      onMouseMove={() => setActiva(i)} onClick={() => void ejecutar(a)}
                      className={`mx-1 cursor-pointer rounded px-3 py-2 ${i === activa ? "bg-sky-800/70" : ""} ${a.deshabilitada ? "cursor-not-allowed opacity-50" : ""}`}>
                      <span className="text-sm">{a.titulo}</span>
                      {a.detalle && <span className="block text-xs text-tenue">{a.detalle}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-borde px-4 py-2 text-xs text-tenue">↑ ↓ para elegir · Enter para hacerlo · Esc para cerrar</p>
          </div>
        )}
      </dialog>
    </>
  );
}
