"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormDemo } from "./form-demo";
import { FormNuevo } from "./form-nuevo";

const MODOS = [
  { id: "tema", titulo: "Desde un tema", desc: "Escribes de qué trata y Geeper hace guion, voz e imágenes." },
  { id: "web", titulo: "Desde una página web", desc: "Muestra tu sitio o producto con tu voz." },
] as const;

/** Página Nuevo: elegir de dónde sale el video. `?modo=web` abre directo la demo de una página. */
export function Nuevo() {
  const router = useRouter();
  const modo = useSearchParams().get("modo") === "web" ? "web" : "tema";
  const elegir = (id: (typeof MODOS)[number]["id"]) => router.replace(id === "tema" ? "/nuevo" : "/nuevo?modo=web", { scroll: false });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">Nuevo video</h1>
      <div className="grid gap-2 sm:grid-cols-3">
        {/* El enlace a Clips va fuera del grupo de opciones (A11-09): no es una de ellas, lleva a otra página. */}
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2" role="radiogroup" aria-label="¿De dónde sale el video?"
          onKeyDown={(e) => {
            // Flechas entre las opciones, como en cualquier grupo de opciones.
            const paso = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!paso) return;
            e.preventDefault();
            const i = MODOS.findIndex((m) => m.id === modo);
            const sig = MODOS[(i + paso + MODOS.length) % MODOS.length]!;
            elegir(sig.id);
            (e.currentTarget.querySelector(`[data-modo="${sig.id}"]`) as HTMLElement | null)?.focus();
          }}>
          {MODOS.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={modo === m.id} tabIndex={modo === m.id ? 0 : -1} data-modo={m.id}
              className="opcion-tarjeta p-3"
              onClick={() => elegir(m.id)}>
              <span className="block text-sm font-medium">{m.titulo}</span>
              <span className="block text-xs text-tenue">{m.desc}</span>
            </button>
          ))}
        </div>
        <Link href="/clips" className="tarjeta p-3 hover:bg-white/5">
          <span className="block text-sm font-medium">Desde un video largo →</span>
          <span className="block text-xs text-tenue">Saca clips de un directo, VOD o grabación.</span>
        </Link>
        <Link href="/invitaciones/nueva" className="tarjeta p-3 hover:bg-white/5">
          <span className="block text-sm font-medium">Invitación interactiva →</span>
          <span className="block text-xs text-tenue">Boda, XV, cumpleaños: se abre como un sobre, con música y confirmación por WhatsApp.</span>
        </Link>
      </div>
      {/* Los dos quedan montados (UX-42): cambiar de tarjeta no borra lo que ya se escribió. */}
      <div hidden={modo !== "tema"}><FormNuevo /></div>
      <div hidden={modo !== "web"}><FormDemo /></div>
    </div>
  );
}
