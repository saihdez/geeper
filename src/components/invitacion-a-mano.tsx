"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Invitacion } from "@/lib/invitaciones/esquema";
import { Aviso, pedir, useSondeo } from "./comun";

type Mensaje = { geeper: "retoque"; clave: string; texto: string } | { geeper: "retoque"; seccion: string; oculta: boolean };

/**
 * «Corregir a mano»: la invitación terminada en un iframe aislado (srcDoc, sólo scripts) donde cada texto
 * se escribe en su lugar y cada parte se puede ocultar. El iframe avisa con postMessage; aquí se juntan los
 * cambios y se guardan de una vez.
 */
export function InvitacionAMano({ slug }: { slug: string }) {
  const router = useRouter();
  const { datos, error } = useSondeo<{ invitacion: Invitacion }>(`/api/invitaciones/${slug}`, 3_600_000);
  const [html, setHtml] = useState<string | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ocultas, setOcultas] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const marco = useRef<HTMLIFrameElement>(null);
  const inv = datos?.invitacion;
  const listas = ocultas ?? inv?.ocultas ?? [];
  const cambios = Object.keys(textos).length + (ocultas && ocultas.join() !== (inv?.ocultas ?? []).join() ? 1 : 0);
  const retocados = Object.keys(inv?.retoques ?? {}).length + (inv?.ocultas?.length ?? 0);

  useEffect(() => {
    let vivo = true;
    pedir<{ html: string }>(`/api/invitaciones/${slug}/a-mano`)
      .then((r) => vivo && setHtml(r.html))
      .catch((e: unknown) => vivo && setFalla(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [slug]);

  useEffect(() => {
    function alRecibir(e: MessageEvent) {
      if (e.source !== marco.current?.contentWindow) return;
      const m = e.data as Mensaje;
      if (!m || m.geeper !== "retoque") return;
      if ("clave" in m && typeof m.clave === "string" && typeof m.texto === "string") {
        setTextos((t) => ({ ...t, [m.clave]: m.texto.slice(0, 1200) }));
      } else if ("seccion" in m && typeof m.seccion === "string") {
        setOcultas((o) => {
          const base = new Set(o ?? inv?.ocultas ?? []);
          if (m.oculta) base.add(m.seccion);
          else base.delete(m.seccion);
          return [...base].sort();
        });
      }
    }
    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, [inv?.ocultas]);

  useEffect(() => {
    if (!cambios) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [cambios]);

  async function guardar(cuerpo: { textos: Record<string, string>; ocultas: string[] }) {
    setGuardando(true);
    setFalla(null);
    try {
      const r = await pedir<{ avisos: string[] }>(`/api/invitaciones/${slug}/a-mano`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      setTextos({});
      setOcultas(null);
      router.push(`/invitaciones/${slug}${r.avisos.length ? `?avisos=${encodeURIComponent(JSON.stringify(r.avisos))}` : ""}`);
    } catch (e) {
      setFalla(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  }

  function volverAlOriginal() {
    if (!inv || !confirm("¿Volver a los textos que puso Geeper? Se quitan todas tus correcciones a mano y se muestran todas las partes.")) return;
    void guardar({ textos: Object.fromEntries(Object.keys(inv.retoques ?? {}).map((k) => [k, ""])), ocultas: [] });
  }

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!inv) return <p className="text-sm text-tenue">Cargando…</p>;

  return (
    <div className="grid gap-8 lg:grid-cols-[auto_1fr]">
      <div className="mx-auto">
        <div className="max-w-full rounded-[2.6rem] border-[10px] border-neutral-800 bg-black shadow-2xl" style={{ width: 410, height: 800 }}>
          {html ? (
            <iframe ref={marco} title={`Corregir a mano la invitación de ${inv.nombres}`} srcDoc={html} sandbox="allow-scripts" className="h-full w-full rounded-[2rem] bg-white" />
          ) : (
            <p className="p-6 text-sm text-tenue">{falla ? "" : "Abriendo la invitación…"}</p>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <Link href={`/invitaciones/${slug}`} className="text-xs text-tenue hover:text-white">← Volver a la invitación</Link>
          <h1 className="text-xl font-semibold">Corregir a mano</h1>
          <p className="text-sm text-tenue">{inv.nombres}</p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Toca cualquier texto con línea punteada y escríbelo como quieras.</li>
          <li>Para quitar una parte (por ejemplo, los regalos), toca <b>Ocultar esta parte</b> en su esquina.</li>
          <li>Cuando termines, toca <b>Guardar cambios</b>: se rehace la invitación y el .zip.</li>
        </ol>
        <p className="text-xs text-tenue">
          La fecha, la hora y el lugar también se corrigen aquí, pero sólo cambia lo que se lee: el calendario, la cuenta atrás y el mapa
          siguen con los datos. Para cambiar esos, usa «Cambiar datos».
        </p>
        {falla && <Aviso tipo="error">{falla}</Aviso>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton boton-primario" disabled={!cambios || guardando} onClick={() => guardar({ textos, ocultas: listas })}>
            {guardando ? "Guardando…" : cambios ? `Guardar cambios (${cambios})` : "Guardar cambios"}
          </button>
          <Link className="boton" href={`/invitaciones/${slug}`}>{cambios ? "Salir sin guardar" : "Salir"}</Link>
          {retocados > 0 && <button type="button" className="boton" disabled={guardando} onClick={volverAlOriginal}>Volver a los textos de Geeper</button>}
        </div>
        {retocados > 0 && !cambios && <p className="text-xs text-tenue">Esta invitación ya tiene {retocados === 1 ? "1 corrección" : `${retocados} correcciones`} a mano.</p>}
      </div>
    </div>
  );
}
