"use client";
/** Acciones del proyecto abierto para el buscador (Ctrl+K). Hacen lo mismo que los botones del editor. */
import { archivo, numero } from "./comun";
import { useAccionesPaleta, type AccionPaleta } from "./paleta";

interface Datos {
  id: string;
  slug: string;
  formato: string | null;
  plantilla: string | null;
  plantillas: { slug: string; nombre: string }[];
  /** Ruta del último video si pasó la revisión (para descargarlo). */
  renderAprobado: string | null;
  hayMusica: boolean;
  dudosas: number;
  versionAnterior: number | null;
  ocupado: boolean;
  editar: (ed: object) => Promise<void>;
  renderizar: () => Promise<void>;
  alinearMusica: () => Promise<void>;
  regenerarVoz: (escena: string | null) => Promise<void>;
  volverA: (numero: number) => Promise<void>;
}

const FORMATOS: Record<string, { nombre: string; palabras: string }> = {
  "9:16": { nombre: "vertical 9:16 (Shorts, TikTok, Reels)", palabras: "vertical shorts tiktok reels celular" },
  "16:9": { nombre: "horizontal 16:9 (YouTube)", palabras: "horizontal youtube ancho pantalla" },
  "1:1": { nombre: "cuadrado 1:1", palabras: "cuadrado instagram feed" },
};

/** Lleva a la primera escena con palabras dudosas y arranca su revisión. */
function revisarDudosas() {
  const b = document.querySelector<HTMLButtonElement>("[data-revisar-dudosas]");
  if (!b) return;
  b.scrollIntoView({ behavior: "smooth", block: "center" });
  b.click();
}

export function useAccionesProyecto(d: Datos | null) {
  const grupo = "Este proyecto";
  const acciones: AccionPaleta[] = !d || !d.formato ? [] : [
    { id: "render", grupo, titulo: "Crear el video", palabras: "render renderizar exportar generar terminar control calidad qc revision", detalle: "No usa la tarjeta de video: arma el video y lo revisa.", deshabilitada: d.ocupado, hacer: d.renderizar },
    ...(d.renderAprobado ? [{ id: "descargar", grupo, titulo: "Descargar el video (MP4)", palabras: "bajar guardar archivo mp4", hacer: () => { window.location.href = archivo(`${d.slug}/${d.renderAprobado}`, true); } }] : []),
    ...(d.dudosas > 0 ? [{ id: "dudosas", grupo, titulo: `Revisar palabras dudosas (${d.dudosas})`, palabras: "confianza tiempos escuchar verificar subtitulos", detalle: "Escucha cada una y confirma que suena bien o recórtala.", hacer: revisarDudosas }] : []),
    { id: "silencios", grupo, titulo: "Acortar silencios largos", palabras: "pausas quitar silencio ritmo", detalle: `Las pausas de más de ${numero(0.6, 1)} s quedan en ${numero(0.25, 2)} s.`, deshabilitada: d.ocupado, hacer: () => d.editar({ tipo: "quitarSilencios" }) },
    { id: "muletillas", grupo, titulo: "Quitar muletillas (eh, em, mmm…)", palabras: "muletillas relleno eh este", deshabilitada: d.ocupado, hacer: () => d.editar({ tipo: "quitarMuletillas" }) },
    { id: "recortes", grupo, titulo: "Deshacer todos los recortes", palabras: "restaurar recuperar volver palabras", confirmar: "¿Deshacer todos los recortes del proyecto?", deshabilitada: d.ocupado, hacer: () => d.editar({ tipo: "quitarRecortes" }) },
    ...Object.entries(FORMATOS).filter(([f]) => f !== d.formato).map(([f, x]) => ({
      id: `formato:${f}`, grupo, titulo: `Cambiar a ${x.nombre}`, palabras: `formato tamaño ${f} ${x.palabras}`, deshabilitada: d.ocupado,
      hacer: () => d.editar({ tipo: "cambiarFormato", formato: f }),
    })),
    ...d.plantillas.filter((x) => x.slug !== d.plantilla).map((x) => ({
      id: `plantilla:${x.slug}`, grupo, titulo: `Usar el estilo del canal «${x.nombre}»`, palabras: "plantilla estilo canal diseño", deshabilitada: d.ocupado,
      hacer: () => d.editar({ tipo: "cambiarPlantilla", plantilla: x.slug }),
    })),
    ...(d.hayMusica ? [{ id: "ritmo", grupo, titulo: "Alinear los cortes al ritmo de la música", palabras: "musica pulsos beat ritmo", deshabilitada: d.ocupado, hacer: d.alinearMusica }] : []),
    { id: "voz", grupo, titulo: "Regenerar la voz de todo el guion", palabras: "voz audio narracion locucion tts", confirmar: "¿Regenerar la voz de todo el guion? Se realinean los subtítulos y se vuelve a crear el video. Con una voz diseñada espera su turno en la tarjeta de video.", deshabilitada: d.ocupado, hacer: () => d.regenerarVoz(null) },
    ...(d.versionAnterior !== null ? [{ id: "deshacer", grupo, titulo: `Volver a la versión anterior (v${d.versionAnterior})`, palabras: "deshacer atras historial undo", confirmar: `¿Volver a la versión ${d.versionAnterior}? Se guarda como versión nueva: no se pierde nada.`, deshabilitada: d.ocupado, hacer: () => d.volverA(d.versionAnterior!) }] : []),
  ];
  useAccionesPaleta(`proyecto:${d?.id ?? ""}`, acciones);
}
