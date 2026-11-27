"use client";
import { useRef, useState } from "react";
import type { ColorPaleta, Roles } from "@/lib/colores-marca";
import { ACCEPT_IMAGEN } from "@/lib/formatos-vector";
import { Aviso } from "./comun";

export interface Paleta {
  colores: ColorPaleta[];
  roles: Roles;
}

/** Sube una imagen a /api/paleta (o a otra ruta que devuelva lo mismo) y devuelve sus colores. */
export async function subirParaPaleta<T = Paleta>(url: string, archivo: File): Promise<T> {
  const form = new FormData();
  form.set("archivo", archivo);
  const r = await fetch(url, { method: "POST", body: form });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
}

/** Botón «Subir imagen» que acepta también arrastrar y soltar. */
export function SubirImagen({ etiqueta, alElegir, ocupado, compacto = false }: { etiqueta: string; alElegir: (f: File) => void; ocupado?: boolean; compacto?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        const f = e.dataTransfer.files[0];
        if (f) alElegir(f);
      }}
      className={compacto ? "" : `rounded-lg border border-dashed p-3 text-center text-sm ${encima ? "border-cyan-500 bg-cyan-950/30" : "border-borde"}`}
    >
      <input ref={input} type="file" accept={ACCEPT_IMAGEN} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) alElegir(f); e.target.value = ""; }} />
      <button type="button" className="boton" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? "Leyendo…" : etiqueta}</button>
      {!compacto && <p className="mt-1 text-xs text-tenue">o arrástrala aquí · PNG, JPG, WebP, SVG o un logo .ai, .pdf o .eps</p>}
    </div>
  );
}

/** Fila de colores; tocar uno lo elige. */
export function Muestras({ colores, alElegir, titulo }: { colores: ColorPaleta[]; alElegir: (hex: string) => void; titulo?: string }) {
  return (
    // A11-09: lista de verdad (ul/li) con un botón en cada fila; antes el botón tenía role="listitem" y perdía su rol.
    <ul className="flex flex-wrap gap-1.5" aria-label={titulo ?? "Colores encontrados"}>
      {colores.map((c) => (
        <li key={c.hex}>
          <button type="button" onClick={() => alElegir(c.hex)}
            className="flex items-center gap-1.5 rounded-md border border-borde bg-[#0f131a] px-1.5 py-1 text-xs hover:border-slate-500"
            title={`${c.hex} · ${Math.round(c.parte * 100)} % de la imagen`}>
            <span className="h-5 w-5 rounded border border-white/20" style={{ background: c.hex }} />
            <span className="tabular-nums">{c.hex}</span>
            <span className="text-tenue">{Math.round(c.parte * 100)} %</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Sacar colores de una imagen»: sube un logo o una foto, muestra hasta 5 colores y una propuesta de
 * roles. No guarda la imagen. `alElegir` recibe el color tocado; `alSugerir`, la propuesta completa.
 */
export function PaletaDeImagen({ alElegir, alSugerir, etiqueta = "Sacar colores de una imagen" }: { alElegir: (hex: string) => void; alSugerir?: (r: Roles) => void; etiqueta?: string }) {
  const [paleta, setPaleta] = useState<Paleta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function leer(f: File) {
    setOcupado(true);
    setError(null);
    try {
      setPaleta(await subirParaPaleta("/api/paleta", f));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="space-y-2">
      <SubirImagen etiqueta={etiqueta} alElegir={(f) => void leer(f)} ocupado={ocupado} />
      {error && <Aviso tipo="error">{error}</Aviso>}
      {paleta && (
        <div className="space-y-2">
          <Muestras colores={paleta.colores} alElegir={alElegir} />
          {alSugerir && Object.keys(paleta.roles).length > 0 && (
            <button type="button" className="boton boton-primario" onClick={() => alSugerir(paleta.roles)}>Usar los colores sugeridos</button>
          )}
        </div>
      )}
    </div>
  );
}
