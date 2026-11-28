"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { leerBorradorDemo, MAX_CARACTERES_DEMO, segundosEstimados } from "@/lib/demo-web";
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

/** Lo que falta para poder enviar, en palabras de la persona (UX-31): va debajo del botón apagado. */
export function faltaDemo(o: { url: string; linkOk: boolean; largo: number; plantilla: string; cargando?: boolean; fuente?: "link" | "grabacion"; archivo?: boolean }): string[] {
  const falta: string[] = [];
  if (o.fuente === "grabacion") {
    // Con grabación el link es opcional (sólo nombra el proyecto); si se escribe, que esté completo.
    if (!o.archivo) falta.push("la grabación de tu pantalla");
    if (o.url.trim() && !o.linkOk) falta.push("un link completo");
  } else if (!o.url.trim()) falta.push("el link de la página");
  else if (!o.linkOk) falta.push("un link completo");
  if (o.largo < 3) falta.push("lo que dice la voz");
  // Mientras llegan los estilos no se cuenta como faltante (si no, parpadea un momento).
  if (!o.plantilla && !o.cargando) falta.push("el estilo del canal");
  return falta;
}

export function FormDemo() {
  const router = useRouter();
  const params = useSearchParams();
  const { datos } = useSondeo<{ plantillas: Plantilla[] }>("/api/plantillas", 60_000);
  // «Cambiar el link» de un video que falló vuelve aquí con lo que se había escrito (UX-17).
  const [borrador] = useState(() => leerBorradorDemo(params));
  const [url, setUrl] = useState(borrador.url ?? "");
  const [formato, setFormato] = useState<"9:16" | "16:9">(borrador.formato ?? "9:16");
  const [estilo, setEstilo] = useState<"3d" | "plano">(borrador.estilo ?? "3d");
  const [texto, setTexto] = useState(borrador.texto ?? "");
  const [plantilla, setPlantilla] = useState(borrador.plantilla ?? "");
  const [propio, setPropio] = useState(borrador.propio ?? false);
  const [fuente, setFuente] = useState<"link" | "grabacion">(borrador.fuente ?? "link");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subida, setSubida] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seg = segundosEstimados(texto);
  const largo = texto.trim().length;
  const plantillaElegida = (plantilla && (!datos || datos.plantillas.some((p) => p.slug === plantilla)) ? plantilla : datos?.plantillas[0]?.slug) || "";
  const linkOk = /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(url.trim());
  const linkMal = !linkOk && url.trim().length > 0;
  const faltan = faltaDemo({ url, linkOk, largo, plantilla: plantillaElegida, cargando: !datos, fuente, archivo: !!archivo });
  const conGrabacion = fuente === "grabacion";

  /** La grabación va como cuerpo del pedido, en flujo y con barra de avance (como en Clips). */
  function subirGrabacion(f: File) {
    const q = new URLSearchParams({ nombre: f.name, url: url.trim(), formato, estilo, texto, plantilla: plantillaElegida, propio: propio ? "1" : "0" });
    const x = new XMLHttpRequest();
    x.open("POST", `/api/demos/grabacion?${q.toString()}`);
    x.upload.onprogress = (ev) => ev.lengthComputable && setSubida(ev.loaded / ev.total);
    const fallo = (m: string) => {
      setSubida(null);
      setError(m);
      setEnviando(false);
    };
    x.onload = () => {
      try {
        const r = JSON.parse(x.responseText) as { proyecto?: { id: string }; error?: string };
        if (x.status >= 400 || !r.proyecto) fallo(r.error ?? "No pude recibir la grabación. Vuelve a intentar.");
        else router.push(`/proyectos/${r.proyecto.id}`);
      } catch {
        fallo(x.status === 413 ? "Esa grabación es demasiado grande para subirla." : "No pude recibir la grabación. Vuelve a intentar.");
      }
    };
    x.onerror = () => fallo("La subida se cortó. Revisa que Geeper siga abierto y vuelve a intentar.");
    setSubida(0);
    x.send(f);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    if (conGrabacion && archivo) return subirGrabacion(archivo);
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
        {conGrabacion
          ? "Subes una grabación de tu pantalla y Geeper la pone en una tarjeta en movimiento, con tu voz, subtítulos y una revisión antes de publicar. Tarda unos 3 a 5 minutos."
          : "Geeper abre la página, la recorre sola como si alguien la estuviera mostrando y arma un video con tu voz, subtítulos y una revisión antes de publicar. No toca tu mouse ni tus cuentas. Tarda unos 3 a 5 minutos."}
      </p>

      <section>
        <h2 className="mb-2 font-medium">1. ¿Qué página quieres mostrar?</h2>
        <fieldset className="mb-3">
          <legend className="etiqueta">¿Cómo la mostramos?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["link", "Geeper la graba sola", "Pegas el link y listo."], ["grabacion", "Subo una grabación de mi pantalla", "Para páginas que piden iniciar sesión o que no dejan entrar a Geeper."]] as const).map(([v, nombre, desc]) => (
              <label key={v} className="opcion-tarjeta p-2">
                <input type="radio" name="demo-fuente" value={v} checked={fuente === v} onChange={() => setFuente(v)} className="sr-only" />
                <span className="block text-sm font-medium">{nombre}</span>
                <span className="block text-xs text-tenue">{desc}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {conGrabacion && (
          <div className="mb-3 space-y-2">
            <p className="etiqueta">Tu grabación (un video de la pantalla mostrando la página)</p>
            {/* El control del navegador dice «Choose File» en inglés: va oculto y se usa este botón. */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="boton cursor-pointer focus-within:ring-2 focus-within:ring-sky-400">
                {archivo ? "Elegir otra grabación" : "Elegir la grabación"}
                <input id="demo-grabacion" type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v" className="sr-only"
                  onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
              </label>
              <span className="min-w-0 break-all text-sm text-tenue">{archivo ? `«${archivo.name}»` : "Todavía no elegiste ninguna."}</span>
            </div>
            {archivo && <p className="text-xs text-tenue">El sonido de la grabación no se usa: se oye tu voz.</p>}
            <details className="text-xs text-tenue">
              <summary className="cursor-pointer">¿Cómo grabo mi pantalla?</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Windows 11: abre «Recortes», elige el botón de video, marca la parte de la pantalla y graba.</li>
                <li>Mac: aprieta Comando + Mayúsculas + 5 y elige «Grabar la pantalla».</li>
                <li>Teléfono: usa «Grabar pantalla» en el menú rápido y después pasa el video a esta computadora.</li>
                <li>Muestra la página despacio y graba un poco más de lo que dura lo que vas a decir.</li>
              </ul>
            </details>
          </div>
        )}
        <label className="etiqueta" htmlFor="demo-url">{conGrabacion ? "Link de la página (si quieres; sólo para nombrar el video)" : "Link de la página (cópialo de la barra de tu navegador)"}</label>
        <input id="demo-url" className="campo" inputMode="url" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tuproducto.com" required={!conGrabacion}
          aria-invalid={linkMal || undefined} aria-describedby={linkMal ? "demo-url-error" : undefined} style={linkMal ? { borderColor: "#f87171" } : undefined} />
        {linkMal && <p id="demo-url-error" className="mt-1 text-xs text-red-400">Ese link no parece completo (ejemplo: https://tuproducto.com).</p>}
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={propio} onChange={(e) => setPropio(e.target.checked)} />
          <span>Es mi sitio (o tengo permiso para mostrarlo).
            <span className="block text-xs text-tenue">Si no lo marcas, el video queda como «revisar permiso» y la revisión lo avisa antes de publicar.</span>
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
                <label key={f} className="opcion">
                  <input type="radio" name="demo-formato" value={f} checked={formato === f} onChange={() => setFormato(f)} className="sr-only" />
                  {nombre}
                </label>
              ))}
            </div>
            {!conGrabacion && <p className="mt-1 text-xs text-tenue">{formato === "9:16" ? "Se graba la versión para celular de la página." : "Se graba la versión de computadora."}</p>}
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
            {([
              ["3d", "Cinematográfico", conGrabacion ? "Tu grabación flota en perspectiva, con un leve movimiento de cámara." : "La página flota en perspectiva y la cámara se acerca a lo importante."],
              ["plano", "Sencillo", conGrabacion ? "Tu grabación de frente, sin inclinarla." : "La página de frente; se acerca cada vez que se hace clic."],
            ] as const).map(([v, nombre, desc]) => (
              <label key={v} className="opcion-tarjeta p-2">
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
      <div className="space-y-1">
        <button className="boton boton-primario" disabled={enviando || faltan.length > 0 || !plantillaElegida} aria-describedby={faltan.length ? "demo-falta" : undefined}>
          {subida !== null ? `Subiendo la grabación… ${Math.round(subida * 100)} %` : enviando ? "Creando…" : "Crear video de la página"}
        </button>
        {faltan.length > 0 && <p id="demo-falta" className="text-xs text-amber-300">Para continuar falta: {faltan.join(" · ")}.</p>}
      </div>
      <p className="text-xs text-tenue">Después puedes cambiar el texto, la voz o la forma del video desde el proyecto, como en cualquier otro video. No usa la tarjeta de video.</p>
    </form>
  );
}
