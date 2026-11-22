"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_CARACTERES_DEMO, segundosEstimados } from "@/lib/demo-web";
import { Aviso, postJson, useSondeo } from "./comun";

interface Plantilla {
  slug: string;
  nombre: string;
}

/** Ejemplo visual de cada estilo: la tarjeta inclinada (3D) o derecha con un acercamiento en el clic. */
function Muestra({ estilo, vertical }: { estilo: "3d" | "plano"; vertical: boolean }) {
  const tarjeta = vertical ? "h-20 w-10" : "h-12 w-20";
  return (
    <div className="flex h-28 items-center justify-center rounded-lg" style={{ background: "linear-gradient(135deg, #4c3a8f, #15122b)", perspective: "260px" }} aria-hidden>
      <div className={`${tarjeta} relative rounded-md bg-slate-100 shadow-2xl`}
        style={estilo === "3d" ? { transform: "rotateX(16deg) rotateY(-20deg) rotateZ(1deg)" } : undefined}>
        <div className="mx-1.5 mt-1.5 h-1.5 w-2/3 rounded bg-slate-400" />
        <div className="mx-1.5 mt-1 h-1 w-1/2 rounded bg-slate-300" />
        <div className="mx-1.5 mt-1.5 h-2 w-1/3 rounded bg-violet-500" />
        {estilo === "plano" && <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white/90" />}
      </div>
    </div>
  );
}

export function FormDemo() {
  const router = useRouter();
  const { datos } = useSondeo<{ plantillas: Plantilla[] }>("/api/plantillas", 60_000);
  const [url, setUrl] = useState("");
  const [formato, setFormato] = useState<"9:16" | "16:9">("9:16");
  const [estilo, setEstilo] = useState<"3d" | "plano">("3d");
  const [texto, setTexto] = useState("");
  const [plantilla, setPlantilla] = useState("");
  const [propio, setPropio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seg = segundosEstimados(texto);
  const largo = texto.trim().length;
  const plantillaElegida = plantilla || datos?.plantillas[0]?.slug || "";
  const linkOk = /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(url.trim());

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await postJson<{ proyecto: { id: string } }>("/api/demos", { url: url.trim(), formato, estilo, texto, plantilla: plantillaElegida, propio });
      router.push(`/proyectos/${r.proyecto.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-6">
      <p className="text-sm text-tenue">
        Geeper abre la página, la recorre sola como si alguien la estuviera mostrando y arma un video con tu voz, subtítulos y
        control de calidad. No toca tu mouse ni tus cuentas. Tarda unos 3 a 5 minutos.
      </p>

      <section>
        <h2 className="mb-2 font-medium">1. ¿Qué página quieres mostrar?</h2>
        <label className="etiqueta" htmlFor="demo-url">Link de la página (cópialo de la barra de tu navegador)</label>
        <input id="demo-url" className="campo" inputMode="url" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tuproducto.com" required />
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={propio} onChange={(e) => setPropio(e.target.checked)} />
          <span>Es mi sitio (o tengo permiso para mostrarlo).
            <span className="block text-xs text-tenue">Si no lo marcas, el video queda como «revisar permiso» y el control de calidad lo avisa antes de publicar.</span>
          </span>
        </label>
      </section>

      <section>
        <h2 className="mb-2 font-medium">2. ¿Cómo se ve?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="etiqueta">Forma del video</legend>
            <div className="flex flex-wrap gap-2">
              {([["9:16", "Vertical (TikTok, Reels, Shorts)"], ["16:9", "Horizontal (YouTube, web)"]] as const).map(([f, nombre]) => (
                <label key={f} className={`boton cursor-pointer ${formato === f ? "boton-primario" : ""}`}>
                  <input type="radio" name="demo-formato" value={f} checked={formato === f} onChange={() => setFormato(f)} className="sr-only" />
                  {nombre}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-tenue">{formato === "9:16" ? "Se graba la versión para celular de la página." : "Se graba la versión de computadora."}</p>
          </fieldset>
          <div>
            <label className="etiqueta" htmlFor="demo-plantilla">Estilo del canal (letra, colores, cierre y voz)</label>
            <select id="demo-plantilla" className="campo" value={plantillaElegida} onChange={(e) => setPlantilla(e.target.value)}>
              {datos?.plantillas.map((p) => <option key={p.slug} value={p.slug}>{p.nombre}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="etiqueta">Movimiento</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["3d", "Cinematográfico", "La página flota en perspectiva y la cámara se acerca a lo importante."], ["plano", "Sencillo", "La página de frente; se acerca cada vez que se hace clic."]] as const).map(([v, nombre, desc]) => (
              <label key={v} className={`tarjeta cursor-pointer p-2 ${estilo === v ? "ring-2 ring-cyan-600" : ""}`}>
                <input type="radio" name="demo-estilo" value={v} checked={estilo === v} onChange={() => setEstilo(v)} className="sr-only" />
                <Muestra estilo={v} vertical={formato === "9:16"} />
                <span className="mt-2 block text-sm font-medium">{nombre}</span>
                <span className="block text-xs text-tenue">{desc}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section>
        <h2 className="mb-2 font-medium">3. ¿Qué dice la voz?</h2>
        <label className="etiqueta" htmlFor="demo-texto">Escríbelo como lo dirías en voz alta (1 a 4 frases)</label>
        <textarea id="demo-texto" className="campo min-h-28" value={texto} maxLength={MAX_CARACTERES_DEMO} onChange={(e) => setTexto(e.target.value)}
          placeholder="Conoce Tu Producto: organiza tus pedidos en un solo lugar. Lo pruebas gratis y en dos minutos ya está funcionando." required />
        <p className={`mt-1 text-xs ${seg > 45 ? "text-red-400" : "text-tenue"}`}>
          {largo === 0 ? "El video dura lo que dure la voz." : `Unos ${Math.max(1, Math.round(seg))} s de video${seg < 6 ? " (muy corto: agrega una frase)" : seg > 35 ? " (largo: para redes, mejor menos de 30 s)" : ""} · ${largo}/${MAX_CARACTERES_DEMO}`}
        </p>
      </section>

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="boton boton-primario" disabled={enviando || !linkOk || largo < 3 || !plantillaElegida}>
          {enviando ? "Creando…" : "Crear video de la página"}
        </button>
        {!linkOk && url.trim() && <span className="text-xs text-red-400">Ese link no parece completo (ejemplo: https://tuproducto.com).</span>}
      </div>
      <p className="text-xs text-tenue">Después puedes cambiar el texto, la voz o el formato desde el proyecto, como en cualquier otro video. No usa la tarjeta de video.</p>
    </form>
  );
}
