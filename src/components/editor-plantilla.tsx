"use client";
import { useEffect, useMemo, useState } from "react";
import { aHex, ajustarHasta, aTexto, contrastePeor, leerColor, legibilidad, opacidadHasta, textoSobre, type Roles } from "@/lib/colores-marca";
import { aplicarEstilo, ESTILOS_PLANTILLA, FUENTES_ESTILOS, type EstiloPlantilla } from "@/lib/estilos-plantilla";
import { esVector } from "@/lib/formatos-vector";
import type { MarcaWeb } from "@/lib/marca-web";
import type { DatosPlantilla } from "@/lib/plantillas";
import { Campo } from "./anuncios/ui";
import { Aviso, archivo, pedir, postJson } from "./comun";
import { Muestras, PaletaDeImagen, SubirImagen, subirParaPaleta, type Paleta } from "./paleta-imagen";

export interface FilaPlantilla { slug: string; nombre: string; datos: DatosPlantilla; usos: number; logoRuta: string | null }

type RolColor = keyof DatosPlantilla["colores"];

const ROLES: { id: RolColor; nombre: string; ayuda: string; transparencia?: boolean }[] = [
  { id: "acento1", nombre: "Color principal", ayuda: "El de la marca: título final, botón y detalles." },
  { id: "acento2", nombre: "Color secundario", ayuda: "Acompaña al principal en los degradados." },
  { id: "activa", nombre: "Palabra que suena", ayuda: "Resalta en los subtítulos la palabra que se está diciendo." },
  { id: "tinta", nombre: "Letras", ayuda: "Color del texto de los subtítulos y del botón." },
  { id: "fondoPastilla", nombre: "Fondo de los subtítulos", ayuda: "La caja detrás de los subtítulos. Más opaca = se lee mejor sobre cualquier imagen.", transparencia: true },
  { id: "fondoCierre", nombre: "Fondo del cierre", ayuda: "Oscurece el video en la tarjeta final.", transparencia: true },
];

/** Tipografías de Google Fonts: Hyperframes las descarga y las fija al renderizar. */
const FUENTES = [...new Set([
  "Archivo Black", "Anton", "Bebas Neue", "Oswald", "Montserrat", "Inter", "Poppins", "Outfit", "Rubik",
  "Barlow", "DM Sans", "Work Sans", "Space Grotesk", "Nunito", "Lato", "Roboto", "Raleway",
  "Playfair Display", "Merriweather",
  ...FUENTES_ESTILOS,
])];

const PESOS = [
  { v: 400, n: "Normal" }, { v: 600, n: "Seminegrita" }, { v: 700, n: "Negrita" }, { v: 800, n: "Extranegrita" }, { v: 900, n: "La más gruesa" },
];

/** Carga en esta página las tipografías elegidas, para que la vista previa se parezca al video. */
function useFuentes(familias: string[]) {
  const clave = [...new Set(familias.filter(Boolean))].sort().join("|");
  useEffect(() => {
    if (!clave) return;
    const id = `fuentes-${clave}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${clave.split("|").map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700;800;900`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, [clave]);
}

function Marco({ children, etiqueta, imagen }: { children: React.ReactNode; etiqueta: string; imagen: string }) {
  return (
    <figure className="space-y-1">
      <div className="relative overflow-hidden rounded-lg border border-borde" style={{ width: 180, height: 320, background: imagen }} aria-label={etiqueta} role="img">{children}</div>
      <figcaption className="text-center text-xs text-tenue">{etiqueta}</figcaption>
    </figure>
  );
}

/** Lo que se ve en el video con estos datos: el chip de la marca, un subtítulo y la tarjeta final. */
function VistaPrevia({ d, logoUrl, fondo }: { d: DatosPlantilla; logoUrl: string | null; fondo: "claro" | "oscuro" }) {
  const c = d.colores;
  const t = d.tipografia;
  const titulos = `"${t.titulos}", "${t.texto}", sans-serif`;
  const texto = `"${t.texto}", sans-serif`;
  const imagen = fondo === "claro"
    ? "linear-gradient(160deg, #f8fafc 0%, #cbd5e1 55%, #94a3b8 100%)"
    : "linear-gradient(160deg, #1e293b 0%, #0f172a 60%, #020617 100%)";
  const degradado = { backgroundImage: `linear-gradient(90deg, ${c.acento1}, ${c.acento2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } as const;
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Marco etiqueta="Durante el video" imagen={imagen}>
        <div className="absolute inset-x-0 top-4 flex justify-center">
          <div className="flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1" style={{ background: "rgba(0,0,0,0.5)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl && <img src={logoUrl} alt="" className="h-4 w-auto" />}
            <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: titulos, ...degradado }}>{d.marca.texto || "Tu marca"}</span>
          </div>
        </div>
        <div className="absolute inset-x-3 flex justify-center" style={{ top: 190 }}>
          <div className="rounded-xl px-2.5 py-1.5 text-center leading-tight" style={{ background: c.fondoPastilla, fontFamily: titulos, fontSize: 15 }}>
            <span style={{ color: c.tinta }}>Así se ven </span>
            <span style={{ color: c.activa }}>los</span>
            <br />
            <span style={{ color: c.tinta }}>subtítulos</span>
          </div>
        </div>
      </Marco>
      <Marco etiqueta="Tarjeta final" imagen={imagen}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3 text-center" style={{ background: c.fondoCierre }}>
          <span className="text-xl uppercase leading-none" style={{ fontFamily: titulos, textWrap: "balance", ...degradado }}>{d.tarjetaFinal.titulo || "Tu marca"}</span>
          <span className="rounded-full px-3 py-1 text-[11px]" style={{ background: c.acento1, color: textoSobre(c.acento1, c.tinta), fontFamily: texto, fontWeight: t.pesoTexto }}>{d.cta || "Suscríbete"}</span>
        </div>
      </Marco>
    </div>
  );
}

const NOMBRE_LEGIBILIDAD = { bien: "Se lee bien", justo: "Se lee, pero justo", mal: "Cuesta leerlo" } as const;
const ESTILO_LEGIBILIDAD = { bien: "text-emerald-300", justo: "text-amber-300", mal: "text-red-300" } as const;

/**
 * Cuatro textos que importan, contra el peor caso (video claro u oscuro debajo). Donde se puede, un
 * botón «Arreglar» cambia lo mínimo para que se lea. Las letras del botón final se eligen solas
 * (como en el render: `textoSobre`).
 */
function Legibilidad({ d, cambiar }: { d: DatosPlantilla; cambiar: (f: (x: DatosPlantilla) => void) => void }) {
  const c = d.colores;
  const letrasBoton = textoSobre(c.acento1, c.tinta);
  const pares: { que: string; k: number | null; nota?: string; arreglo?: { texto: string; aplicar: () => void } | null; consejo?: string }[] = [
    (() => {
      const f = opacidadHasta(c.fondoPastilla, [c.tinta, c.activa], 4.5);
      return { que: "Subtítulos", k: contrastePeor(c.tinta, c.fondoPastilla),
        arreglo: f ? { texto: "Oscurecer el fondo de los subtítulos", aplicar: () => cambiar((x) => { x.colores.fondoPastilla = f; }) } : null,
        consejo: "aclara las letras" };
    })(),
    (() => {
      const nuevo = ajustarHasta(c.activa, c.fondoPastilla, 4.5);
      return { que: "Palabra que suena", k: contrastePeor(c.activa, c.fondoPastilla),
        arreglo: nuevo ? { texto: "Ajustar el color de la palabra", aplicar: () => cambiar((x) => { x.colores.activa = nuevo; }) } : null,
        consejo: "elige otro color para la palabra que suena" };
    })(),
    { que: "Botón final", k: contrastePeor(letrasBoton, c.acento1),
      nota: letrasBoton !== c.tinta ? `letras en ${letrasBoton === "#ffffff" ? "blanco" : "negro"} automáticamente` : undefined,
      consejo: "cambia el color principal" },
    (() => {
      // Primero lo cómodo (4,5:1); si no se puede, lo mínimo (3:1). Sin botón si ya no cambia nada.
      const f = opacidadHasta(c.fondoCierre, [c.acento1, c.acento2], 4.5) ?? opacidadHasta(c.fondoCierre, [c.acento1, c.acento2], 3);
      return { que: "Título final", k: Math.min(contrastePeor(c.acento1, c.fondoCierre) ?? 21, contrastePeor(c.acento2, c.fondoCierre) ?? 21),
        arreglo: f && f !== c.fondoCierre ? { texto: "Oscurecer el fondo del cierre", aplicar: () => cambiar((x) => { x.colores.fondoCierre = f; }) } : null,
        consejo: "usa colores de marca más claros" };
    })(),
  ];
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Legibilidad">
      {pares.map((p) => {
        if (p.k === null) return null;
        const l = legibilidad(p.k);
        return (
          <li key={p.que} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-36 shrink-0 text-tenue">{p.que}</span>
            <span className={ESTILO_LEGIBILIDAD[l]}>{l === "bien" ? "●" : l === "justo" ? "◐" : "○"} {NOMBRE_LEGIBILIDAD[l]}</span>
            <span className="text-xs tabular-nums text-tenue">({p.k.toFixed(1)}:1)</span>
            {p.nota && <span className="basis-full text-xs text-tenue">{p.nota}</span>}
            {l !== "bien" && (p.arreglo
              ? <button type="button" className="boton !py-0.5 text-xs" onClick={p.arreglo.aplicar}>Arreglar: {p.arreglo.texto.toLowerCase()}</button>
              : <span className="basis-full text-xs text-tenue">Para mejorarlo: {p.consejo}.</span>)}
          </li>
        );
      })}
    </ul>
  );
}

function ControlColor({ rol, valor, activo, alActivar, alCambiar }: { rol: (typeof ROLES)[number]; valor: string; activo: boolean; alActivar: () => void; alCambiar: (v: string) => void }) {
  const c = leerColor(valor) ?? { r: 0, g: 0, b: 0, a: 1 };
  const hex = aHex(c);
  return (
    <div className={`rounded-lg border p-2 ${activo ? "border-cyan-600 bg-cyan-950/30" : "border-borde bg-[#0f131a]"}`}>
      <button type="button" onClick={alActivar} aria-pressed={activo} className="w-full text-left text-sm font-medium" title="Tócalo y luego toca un color de la imagen para ponerlo aquí">
        {rol.nombre}
      </button>
      <p className="mb-1.5 text-xs text-tenue">{rol.ayuda}</p>
      <div className="flex items-center gap-2">
        <input type="color" value={hex} onChange={(e) => alCambiar(aTexto({ ...leerColor(e.target.value)!, a: c.a }))} onFocus={alActivar}
          className="h-8 w-10 cursor-pointer rounded border border-borde bg-transparent" aria-label={`${rol.nombre}: elegir color`} />
        <input className="campo !py-1 font-mono text-xs" value={hex} maxLength={7} aria-label={`${rol.nombre} en hexadecimal`}
          onChange={(e) => { const n = leerColor(e.target.value); if (n && /^#[0-9a-f]{6}$/i.test(e.target.value)) alCambiar(aTexto({ ...n, a: c.a })); }} />
      </div>
      {rol.transparencia && (
        <label className="mt-1.5 block text-xs text-tenue">
          Opacidad: {Math.round(c.a * 100)} %
          <input type="range" min={0} max={100} value={Math.round(c.a * 100)} className="w-full"
            onChange={(e) => alCambiar(aTexto({ ...c, a: Number(e.target.value) / 100 }))} />
        </label>
      )}
    </div>
  );
}

/** Galería de estilos de partida (src/lib/estilos-plantilla.ts): cada uno se ve como un subtítulo del video. */
function EstilosDePartida({ alElegir }: { alElegir: (e: EstiloPlantilla) => void }) {
  useFuentes(FUENTES_ESTILOS);
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {ESTILOS_PLANTILLA.map((e) => {
        const c = e.colores;
        return (
          <button key={e.id} type="button" onClick={() => alElegir(e)} className="rounded-lg border border-borde bg-[#0f131a] p-2 text-left hover:border-slate-500">
            <div className="mb-2 flex h-16 items-center justify-center rounded-md" style={{ background: "linear-gradient(160deg, #94a3b8, #334155)" }} aria-hidden>
              <span className="rounded-lg px-2 py-1 text-sm uppercase" style={{ background: c.fondoPastilla, fontFamily: `"${e.tipografia.titulos}", sans-serif` }}>
                <span style={{ color: c.tinta }}>Así </span><span style={{ color: c.activa }}>suena</span>
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {[c.acento1, c.acento2].map((x, i) => <span key={i} className="h-3 w-3 rounded-full border border-white/20" style={{ background: x }} />)}
              {e.nombre}
            </span>
            <span className="block text-xs text-tenue">{e.descripcion}</span>
          </button>
        );
      })}
    </div>
  );
}

interface RespuestaMarcaWeb { marca: MarcaWeb; logo: { logo: string; ruta: string } | null; avisos: string[] }

/** «Copiar de mi página web»: lee colores, letras y logo de la página y los propone (no guarda nada). */
function MarcaDeWeb({ slug, alElegir, alUsar }: { slug: string; alElegir: (hex: string) => void; alUsar: (r: RespuestaMarcaWeb) => void }) {
  const [url, setUrl] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [r, setR] = useState<RespuestaMarcaWeb | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function leer() {
    setLeyendo(true);
    setError(null);
    setR(null);
    try {
      setR(await postJson<RespuestaMarcaWeb>(`/api/plantillas/${slug}/marca-web`, { url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLeyendo(false);
    }
  }

  const letra = (f: MarcaWeb["tipografia"]["titulos"]) => (f.exacta ? f.fuente : `${f.fuente} (la más parecida a «${f.original}» de tu página)`);
  return (
    <div className="space-y-2">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim() && !leyendo) void leer(); }}>
        <input className="campo min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="mitienda.com" inputMode="url" autoComplete="url" aria-label="Link de tu página web" />
        <button type="submit" className="boton" disabled={!url.trim() || leyendo}>{leyendo ? "Leyendo la página… (unos 10 s)" : "Copiar de mi página"}</button>
      </form>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {r && (
        <div className="space-y-2 rounded-lg border border-cyan-900 bg-cyan-950/20 p-2 text-sm">
          <p>Esto encontramos en <b>{r.marca.nombre || "tu página"}</b>. Toca un color para ponerlo en el recuadro elegido, o usa todo lo sugerido.</p>
          {r.marca.colores.length > 0 ? <Muestras colores={r.marca.colores} alElegir={alElegir} titulo="Colores de tu página" /> : <p className="text-tenue">No encontramos colores de marca.</p>}
          <p className="text-xs text-tenue">Letra de títulos: {letra(r.marca.tipografia.titulos)} · de textos: {letra(r.marca.tipografia.texto)}</p>
          {r.logo && (
            <div className="flex items-center gap-2 text-xs text-tenue">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={archivo(r.logo.ruta)} alt="Logo encontrado" className="h-10 max-w-40 rounded bg-white/5 object-contain p-1" />
              Logo encontrado
            </div>
          )}
          {r.avisos.map((a) => <p key={a} className="text-xs text-amber-300">{a}</p>)}
          <button type="button" className="boton boton-primario" onClick={() => alUsar(r)}>Usar todo lo sugerido</button>
        </div>
      )}
    </div>
  );
}

function Grupo({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-borde p-3">
      <legend className="px-1 text-sm font-semibold">{titulo}</legend>
      {descripcion && <p className="-mt-1 text-xs text-tenue">{descripcion}</p>}
      {children}
    </fieldset>
  );
}

export function EditorPlantilla({ fila, alGuardar, alCerrar }: { fila: FilaPlantilla; alGuardar: () => void; alCerrar: () => void }) {
  const [d, setD] = useState<DatosPlantilla>(() => structuredClone(fila.datos));
  const [nombre, setNombre] = useState(fila.nombre);
  const [rol, setRol] = useState<RolColor>("acento1");
  const [fondo, setFondo] = useState<"claro" | "oscuro">("claro");
  const [paletaLogo, setPaletaLogo] = useState<Paleta | null>(null);
  const [logoRuta, setLogoRuta] = useState<string | null>(fila.logoRuta);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; t: string } | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [verEstilos, setVerEstilos] = useState(false);
  useFuentes([d.tipografia.titulos, d.tipografia.texto]);

  const sucio = useMemo(() => JSON.stringify(d) !== JSON.stringify(fila.datos) || nombre !== fila.nombre, [d, nombre, fila]);
  useEffect(() => {
    if (!sucio) return;
    const salir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", salir);
    return () => window.removeEventListener("beforeunload", salir);
  }, [sucio]);

  const cambiar = (f: (x: DatosPlantilla) => void) => setD((x) => { const n = structuredClone(x); f(n); return n; });
  const ponerColor = (r: RolColor, valor: string) => cambiar((x) => {
    // Al tocar un color de la imagen se respeta la opacidad que ya tenía el rol.
    const viejo = leerColor(x.colores[r]);
    const nuevo = leerColor(valor);
    x.colores[r] = nuevo && viejo && viejo.a < 1 && nuevo.a === 1 ? aTexto({ ...nuevo, a: viejo.a }) : valor;
  });
  const usarRoles = (roles: Roles) => cambiar((x) => { for (const [k, v] of Object.entries(roles)) if (v) x.colores[k as RolColor] = v; });
  const usarEstilo = (e: EstiloPlantilla) => {
    setD((x) => aplicarEstilo(x, e));
    setMsg({ tipo: "ok", t: `Estilo «${e.nombre}» puesto. Mira la vista previa, cambia lo que quieras y guarda.` });
  };
  const usarMarcaWeb = (r: RespuestaMarcaWeb) => {
    cambiar((x) => {
      for (const [k, v] of Object.entries(r.marca.roles)) if (v) x.colores[k as RolColor] = v;
      x.tipografia.titulos = r.marca.tipografia.titulos.fuente;
      x.tipografia.texto = r.marca.tipografia.texto.fuente;
      if (r.marca.nombre) {
        x.marca.texto = r.marca.nombre;
        x.tarjetaFinal.titulo = r.marca.nombre;
      }
      if (r.logo) x.marca.logo = r.logo.logo;
    });
    if (r.logo) setLogoRuta(r.logo.ruta);
    setMsg({ tipo: "ok", t: "Marca de tu página puesta. Revisa «Así se verá» (si algo cuesta leerse, usa «Arreglar») y guarda." });
  };

  // Ruta del logo para verlo: sólo si está dentro de ~/geeper-data (lo que sube este editor).
  const logoUrl = logoRuta ? archivo(logoRuta) : null;
  const logoNombre = d.marca.logo ? d.marca.logo.split("/").pop() : null;

  async function subirLogo(f: File) {
    setSubiendo(true);
    setMsg(null);
    try {
      const r = await subirParaPaleta<{ logo: string; ruta: string; paleta: Paleta | null; avisos?: string[] }>(`/api/plantillas/${fila.slug}/logo`, f);
      cambiar((x) => { x.marca.logo = r.logo; });
      setLogoRuta(r.ruta);
      setPaletaLogo(r.paleta);
      if (esVector(f.name)) setMsg({ tipo: "ok", t: ["Logo convertido a SVG. Guarda para usarlo.", ...(r.avisos ?? []).map((a) => `Ojo: ${a}`)].join(" ") });
    } catch (e) {
      setMsg({ tipo: "error", t: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubiendo(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      await pedir(`/api/plantillas/${fila.slug}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre, datos: d }) });
      setMsg({ tipo: "ok", t: fila.usos ? `Guardada. Los ${fila.usos} proyectos que la usan la toman en su próximo render.` : "Guardada." });
      alGuardar();
    } catch (e) {
      setMsg({ tipo: "error", t: `No se guardó: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setGuardando(false);
    }
  }

  const fuentes = (actual: string) => (FUENTES.includes(actual) ? FUENTES : [actual, ...FUENTES]);
  const rolActivo = ROLES.find((r) => r.id === rol)!;

  return (
    <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <details className="rounded-lg border border-borde p-3" onToggle={(e) => setVerEstilos((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-semibold">¿No sabes qué colores elegir? Empieza desde un estilo</summary>
          <p className="mt-1 text-xs text-tenue">Pone los colores y la letra; tu marca, logo, voz y música no cambian. Todos se leen bien sobre videos claros y oscuros.</p>
          {verEstilos && <div className="mt-3"><EstilosDePartida alElegir={usarEstilo} /></div>}
        </details>
        <Grupo titulo="Marca">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Nombre de la plantilla" ayuda="Sólo lo ves tú, para elegirla."><input className="campo" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></Campo>
            <Campo etiqueta="Nombre de la marca" ayuda="Aparece arriba durante todo el video."><input className="campo" value={d.marca.texto} maxLength={40} onChange={(e) => cambiar((x) => { x.marca.texto = e.target.value; })} /></Campo>
          </div>
          <div>
            <p className="etiqueta">Logo (opcional)</p>
            <div className="flex flex-wrap items-center gap-3">
              {d.marca.logo ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logoUrl ? <img src={logoUrl} alt="Logo actual" className="h-12 max-w-40 rounded bg-white/5 object-contain p-1" /> : <span className="text-sm">{logoNombre}</span>}
                  <SubirImagen etiqueta="Cambiar logo" alElegir={(f) => void subirLogo(f)} ocupado={subiendo} compacto />
                  <button type="button" className="boton" onClick={() => { cambiar((x) => { x.marca.logo = null; }); setLogoRuta(null); setPaletaLogo(null); }}>Quitar logo</button>
                </>
              ) : (
                <SubirImagen etiqueta="Subir logo" alElegir={(f) => void subirLogo(f)} ocupado={subiendo} />
              )}
            </div>
            {paletaLogo && (
              <div className="mt-2 space-y-2 rounded-lg border border-cyan-900 bg-cyan-950/20 p-2">
                <p className="text-sm">Colores de tu logo. Toca uno para ponerlo en «{rolActivo.nombre}», o usa la sugerencia.</p>
                <Muestras colores={paletaLogo.colores} alElegir={(hex) => ponerColor(rol, hex)} />
                {Object.keys(paletaLogo.roles).length > 0 && (
                  <button type="button" className="boton boton-primario" onClick={() => usarRoles(paletaLogo.roles)}>Usar los colores sugeridos</button>
                )}
              </div>
            )}
          </div>
          <div>
            <p className="etiqueta">Copiar de tu página web (opcional)</p>
            <p className="mb-1.5 text-xs text-tenue">Escribe el link y tomamos sus colores, su letra y su logo. Nada se guarda hasta que pulses «Guardar cambios».</p>
            <MarcaDeWeb slug={fila.slug} alElegir={(hex) => ponerColor(rol, hex)} alUsar={usarMarcaWeb} />
          </div>
        </Grupo>

        <Grupo titulo="Colores" descripcion="Toca un recuadro para elegirlo y cambia su color, o toca un color sacado de una imagen para ponerlo ahí.">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ROLES.map((r) => (
              <ControlColor key={r.id} rol={r} valor={d.colores[r.id]} activo={rol === r.id} alActivar={() => setRol(r.id)} alCambiar={(v) => ponerColor(r.id, v)} />
            ))}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-tenue">Sacar colores de otra imagen (foto del producto, captura de la web…)</summary>
            <div className="mt-2"><PaletaDeImagen alElegir={(hex) => ponerColor(rol, hex)} alSugerir={usarRoles} /></div>
          </details>
        </Grupo>

        <Grupo titulo="Letra">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Títulos y subtítulos">
              <select className="campo" value={d.tipografia.titulos} onChange={(e) => cambiar((x) => { x.tipografia.titulos = e.target.value; })}>
                {fuentes(d.tipografia.titulos).map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Textos y botón">
              <select className="campo" value={d.tipografia.texto} onChange={(e) => cambiar((x) => { x.tipografia.texto = e.target.value; })}>
                {fuentes(d.tipografia.texto).map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Grosor de los textos">
              <select className="campo" value={d.tipografia.pesoTexto} onChange={(e) => cambiar((x) => { x.tipografia.pesoTexto = Number(e.target.value); })}>
                {PESOS.map((p) => <option key={p.v} value={p.v}>{p.n}</option>)}
                {!PESOS.some((p) => p.v === d.tipografia.pesoTexto) && <option value={d.tipografia.pesoTexto}>{d.tipografia.pesoTexto}</option>}
              </select>
            </Campo>
          </div>
        </Grupo>

        <Grupo titulo="Cierre del video">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Título de la tarjeta final"><input className="campo" value={d.tarjetaFinal.titulo} maxLength={40} onChange={(e) => cambiar((x) => { x.tarjetaFinal.titulo = e.target.value; })} /></Campo>
            <Campo etiqueta="Botón (lo que le pides a la gente)" ayuda="Ej.: «Suscríbete para más», «Compra en la web»."><input className="campo" value={d.cta} maxLength={40} onChange={(e) => cambiar((x) => { x.cta = e.target.value; })} /></Campo>
          </div>
          <label className="block text-sm">
            <span className="etiqueta">Duración de la tarjeta final: {d.tarjetaFinal.duracion.toFixed(1)} s</span>
            <input type="range" min={2} max={6} step={0.1} value={d.tarjetaFinal.duracion} className="w-full" onChange={(e) => cambiar((x) => { x.tarjetaFinal.duracion = Number(e.target.value); })} />
          </label>
        </Grupo>

        <Grupo titulo="Música">
          <label className="block text-sm">
            <span className="etiqueta">Volumen de la música: {Math.round(d.musica.volumen * 100)} %</span>
            <input type="range" min={0} max={50} value={Math.round(d.musica.volumen * 100)} className="w-full" onChange={(e) => cambiar((x) => { x.musica.volumen = Number(e.target.value) / 100; })} />
            <span className="text-xs text-tenue">Entre 10 % y 20 % suele dejar la voz clara.</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.musica.ducking} onChange={(e) => cambiar((x) => { x.musica.ducking = e.target.checked; })} />
            Bajar la música mientras alguien habla
          </label>
          {!d.musica.carpeta && <p className="text-xs text-tenue">Esta plantilla no tiene música. La carpeta de canciones se cambia en «Avanzado».</p>}
        </Grupo>

        <details className="rounded-lg border border-borde p-3" onToggle={(e) => setJson((e.target as HTMLDetailsElement).open ? JSON.stringify(d, null, 2) : null)}>
          <summary className="cursor-pointer text-sm font-semibold">Avanzado (voz, MoneyPrinterTurbo, música, portada)</summary>
          <p className="mt-2 text-xs text-tenue">Todos los datos de la plantilla. Lo que cambies aquí se aplica al pulsar «Aplicar»; los campos de arriba se actualizan.</p>
          {json !== null && (
            <>
              <textarea className="campo mt-2 min-h-72 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="Datos de la plantilla en JSON" />
              <button type="button" className="boton mt-2" onClick={() => {
                try {
                  setD(JSON.parse(json) as DatosPlantilla);
                  setMsg(null);
                } catch (e) {
                  setMsg({ tipo: "error", t: `El JSON no es válido: ${e instanceof Error ? e.message : String(e)}` });
                }
              }}>Aplicar</button>
            </>
          )}
        </details>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="tarjeta space-y-3 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Así se verá</h3>
            <div className="flex gap-1 text-xs" role="group" aria-label="Fondo de prueba">
              {(["claro", "oscuro"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={fondo === f} onClick={() => setFondo(f)} className={`rounded px-2 py-0.5 ${fondo === f ? "bg-slate-600" : "bg-[#0f131a]"}`}>Video {f}</button>
              ))}
            </div>
          </div>
          <VistaPrevia d={d} logoUrl={logoUrl} fondo={fondo} />
          <Legibilidad d={d} cambiar={cambiar} />
        </div>
        {fila.usos > 0 && <p className="text-xs text-tenue">La usan {fila.usos} proyecto{fila.usos === 1 ? "" : "s"}. Para probar sin afectarlos, duplícala primero.</p>}
      </aside>
    </div>
    {/* Barra fija abajo: guardar siempre a mano, también en el teléfono. */}
    <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-borde bg-[#141821]/95 px-4 py-3 backdrop-blur">
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="boton boton-primario" disabled={!sucio || guardando} onClick={() => void guardar()}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        <button type="button" className="boton" disabled={!sucio || guardando} onClick={() => { setD(structuredClone(fila.datos)); setNombre(fila.nombre); setLogoRuta(fila.logoRuta); setPaletaLogo(null); setMsg(null); }}>Descartar</button>
        <button type="button" className="boton" onClick={() => (!sucio || confirm("Tienes cambios sin guardar. ¿Cerrar igual?")) && alCerrar()}>Cerrar</button>
        <span className={`text-xs ${sucio ? "text-amber-300" : "text-tenue"}`}>{sucio ? "Cambios sin guardar" : "Todo guardado"}</span>
      </div>
    </div>
    </div>
  );
}

