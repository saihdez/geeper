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
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">Nuevo video</h1>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="¿De dónde sale el video?">
        {MODOS.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={modo === m.id}
            className={`tarjeta p-3 text-left ${modo === m.id ? "ring-2 ring-cyan-600" : "hover:bg-white/5"}`}
            onClick={() => router.replace(m.id === "tema" ? "/nuevo" : "/nuevo?modo=web", { scroll: false })}>
            <span className="block text-sm font-medium">{m.titulo}</span>
            <span className="block text-xs text-tenue">{m.desc}</span>
          </button>
        ))}
        <Link href="/clips" className="tarjeta p-3 hover:bg-white/5">
          <span className="block text-sm font-medium">Desde un video largo →</span>
          <span className="block text-xs text-tenue">Saca clips de un directo, VOD o grabación.</span>
        </Link>
      </div>
      {modo === "web" ? <FormDemo /> : <FormNuevo />}
    </div>
  );
}
