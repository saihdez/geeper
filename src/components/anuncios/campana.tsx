"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ESTADOS_CAMPANA, type DatosCampana } from "@/lib/anuncios/esquema";
import type { Revision } from "@/lib/anuncios/revision";
import type { Paso } from "@/lib/anuncios/siguiente";
import { Aviso, pedir, postJson } from "../comun";
import { PestanaBrief } from "./brief";
import { PestanaConceptos } from "./conceptos";
import { PestanaExportar } from "./exportar";
import { SiguientePaso } from "./guia";
import { PestanaPrueba } from "./prueba";
import { PestanaRevision } from "./revision";
import { Contadores } from "./ui";

interface Vista {
  campana: { id: string; nombre: string; estado: string; actualizado: string };
  datos: DatosCampana;
  revision: Revision;
  siguiente: Paso;
}

const NOMBRES_ESTADO: Record<(typeof ESTADOS_CAMPANA)[number], string> = {
  borrador: "Borrador",
  "en-revision": "En revisión",
  lista: "Lista para lanzar",
  activa: "Activa",
  archivada: "Archivada",
};

type Pestana = "brief" | "conceptos" | "revision" | "prueba" | "exportar";
type Guardado = "guardado" | "pendiente" | "guardando" | "error";

/** Lo que las pestañas necesitan para leer y cambiar la campaña. */
export interface Ctx {
  id: string;
  datos: DatosCampana;
  revision: Revision;
  cambiar: (f: (d: DatosCampana) => DatosCampana) => void;
  /** Guarda lo pendiente, corre una acción del servidor y recarga todo. */
  accion: (cuerpo: Record<string, unknown>) => Promise<unknown>;
  irA: (p: Pestana, concepto?: string) => void;
  conceptoActivo: string | null;
  setConceptoActivo: (id: string | null) => void;
}

export function Campana({ id }: { id: string }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("brief");
  const [guardado, setGuardado] = useState<Guardado>("guardado");
  const [conceptoActivo, setConceptoActivo] = useState<string | null>(null);
  const router = useRouter();

  const datosRef = useRef<DatosCampana | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const secuencia = useRef(0);
  const enVuelo = useRef<Promise<void> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const v = await pedir<Vista>(`/api/anuncios/${id}`);
      datosRef.current = v.datos;
      setVista(v);
      setError(null);
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const guardarAhora = useCallback(async (extra?: { nombre?: string; estado?: string }) => {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    const n = ++secuencia.current;
    setGuardado("guardando");
    const tarea = (async () => {
      try {
        const v = await pedir<Vista>(`/api/anuncios/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ datos: datosRef.current, ...extra }),
        });
        // Sólo la respuesta más nueva manda; los datos locales no se pisan mientras se escribe.
        if (n === secuencia.current) {
          setVista((prev) => (prev ? { ...prev, campana: v.campana, revision: v.revision, siguiente: v.siguiente } : v));
          setGuardado("guardado");
          setError(null);
        }
      } catch (e) {
        if (n === secuencia.current) {
          setGuardado("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    enVuelo.current = tarea;
    await tarea;
  }, [id]);

  const cambiar = useCallback((f: (d: DatosCampana) => DatosCampana) => {
    if (!datosRef.current) return;
    const nuevos = f(structuredClone(datosRef.current));
    datosRef.current = nuevos;
    setVista((prev) => (prev ? { ...prev, datos: nuevos } : prev));
    setGuardado("pendiente");
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void guardarAhora(), 700);
  }, [guardarAhora]);

  const accion = useCallback(async (cuerpo: Record<string, unknown>) => {
    if (temporizador.current || guardado === "pendiente") await guardarAhora();
    else if (enVuelo.current) await enVuelo.current;
    const r = await postJson<unknown>(`/api/anuncios/${id}/accion`, cuerpo);
    await cargar();
    return r;
  }, [cargar, guardarAhora, guardado, id]);

  // Mientras un video se genera o renderiza, la revisión se refresca sola.
  const ocupado = vista?.revision.conceptos.some((c) => c.proyecto?.ocupado) ?? false;
  useEffect(() => {
    if (!ocupado) return;
    const i = setInterval(async () => {
      if (guardado !== "guardado") return;
      try {
        const v = await pedir<Vista>(`/api/anuncios/${id}`);
        setVista((prev) => (prev ? { ...prev, revision: v.revision, siguiente: v.siguiente } : prev));
      } catch {
        /* el próximo intento lo vuelve a probar */
      }
    }, 5000);
    return () => clearInterval(i);
  }, [ocupado, guardado, id]);

  // Ctrl/Cmd+S guarda ya; al salir con cambios pendientes, el navegador avisa.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void guardarAhora();
      }
    };
    const salir = (e: BeforeUnloadEvent) => {
      if (guardado === "pendiente" || guardado === "guardando") e.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    window.addEventListener("beforeunload", salir);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("beforeunload", salir);
    };
  }, [guardarAhora, guardado]);

  if (!vista) return error ? <Aviso tipo="error">{error}</Aviso> : <p className="text-sm text-tenue">Cargando…</p>;

  const { campana, datos, revision } = vista;
  const pendientes = revision.resumen.fail + revision.resumen.unknown;
  const ctx: Ctx = {
    id, datos, revision, cambiar, accion,
    irA: (p, c) => {
      if (c) setConceptoActivo(c);
      setPestana(p);
    },
    conceptoActivo, setConceptoActivo,
  };

  const PESTANAS: { id: Pestana; nombre: string; insignia?: number; alerta?: boolean }[] = [
    { id: "brief", nombre: "Tu negocio" },
    { id: "conceptos", nombre: "Ideas", insignia: datos.conceptos.length },
    { id: "revision", nombre: "Revisión", insignia: pendientes || undefined, alerta: revision.resumen.fail > 0 },
    { id: "prueba", nombre: "Comparar" },
    { id: "exportar", nombre: "Lanzar" },
  ];

  async function duplicar() {
    await guardarAhora();
    const r = await postJson<{ campana: { id: string } }>("/api/anuncios", { nombre: `${campana.nombre} (copia)`, duplicarDe: id });
    router.push(`/anuncios/${r.campana.id}`);
  }

  async function borrar() {
    if (!confirm(`¿Borrar la campaña «${campana.nombre}»? Los videos vinculados no se borran.`)) return;
    await pedir(`/api/anuncios/${id}`, { method: "DELETE" });
    router.push("/anuncios");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href="/anuncios" className="text-sm text-tenue hover:text-white">← Anuncios</Link>
        <input
          className="min-w-0 flex-1 basis-full rounded-md border border-transparent bg-transparent px-1 text-xl font-bold tracking-tight hover:border-borde focus:border-borde focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento sm:basis-auto"
          defaultValue={campana.nombre}
          aria-label="Nombre de la campaña"
          maxLength={120}
          onBlur={(e) => {
            const n = e.target.value.trim();
            if (n && n !== campana.nombre) void guardarAhora({ nombre: n });
          }}
        />
        <select className="campo !w-auto" value={campana.estado} aria-label="Estado de la campaña" onChange={(e) => void guardarAhora({ estado: e.target.value })}>
          {ESTADOS_CAMPANA.map((e) => <option key={e} value={e}>{NOMBRES_ESTADO[e]}</option>)}
        </select>
        <IndicadorGuardado estado={guardado} />
        <details className="relative">
          <summary className="boton cursor-pointer list-none" aria-label="Más acciones">⋯</summary>
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-borde bg-panel p-1 shadow-xl">
            <button className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#232a38]" onClick={() => void duplicar()}>Duplicar campaña</button>
            <button className="w-full rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-[#3b1219]" onClick={() => void borrar()}>Borrar campaña</button>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Secciones de la campaña">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                pestana === p.id ? "border-cyan-400 text-white" : "border-transparent text-tenue hover:text-white"
              }`}
            >
              {p.nombre}
              {p.insignia !== undefined && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${p.alerta ? "bg-red-900 text-red-100" : "bg-slate-700 text-slate-200"}`}>{p.insignia}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="pb-2"><Contadores r={revision.resumen} compacto /></div>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}

      <SiguientePaso ctx={ctx} paso={vista.siguiente} />

      <div role="tabpanel">
        {pestana === "brief" && <PestanaBrief ctx={ctx} />}
        {pestana === "conceptos" && <PestanaConceptos ctx={ctx} />}
        {pestana === "revision" && <PestanaRevision ctx={ctx} />}
        {pestana === "prueba" && <PestanaPrueba ctx={ctx} />}
        {pestana === "exportar" && <PestanaExportar ctx={ctx} guardar={guardarAhora} />}
      </div>
    </div>
  );
}

function IndicadorGuardado({ estado }: { estado: Guardado }) {
  const t = { guardado: "Guardado", pendiente: "Sin guardar…", guardando: "Guardando…", error: "No se guardó" }[estado];
  const c = { guardado: "text-tenue", pendiente: "text-amber-300", guardando: "text-sky-300", error: "text-red-300" }[estado];
  return <span className={`text-xs ${c}`} role="status" aria-live="polite">{t}</span>;
}
