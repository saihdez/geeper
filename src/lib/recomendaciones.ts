/**
 * El asistente de Geeper: qué conviene hacer con un proyecto para que el video quede mejor, en
 * palabras simples y con una sola acción cada cosa. Puro (sin disco ni GPU): lo usan el panel
 * «Asistente» del editor, `scripts/recomendar.ts` y el agente `geeper-experto` de Claude Code.
 *
 * Cada recomendación con `ediciones` ya se probó contra el proyecto (aplicarPasos): si no aplica, no
 * se ofrece. Lo que necesita criterio (qué texto poner, qué escena quitar) lleva a la parte de la
 * página donde se decide (`ir`), nunca se aplica solo.
 */
import { resumirConfianza } from "./confianza";
import { aplicarPasos } from "./encadenar";
import type { Edicion } from "./ediciones";
import { pista, type Proyecto } from "./esquema";
import { duracionEscenas, ENTRADA, escenasEnLinea, todosLosGrupos } from "./linea";
import { usoComercial } from "./licencias";
import { explicar } from "./qc-explicado";
import { revisarSubtitulos } from "./qc";

export type Prioridad = "bloquea" | "mejora" | "idea";
export type Area = "gancho" | "ritmo" | "subtitulos" | "sonido" | "imagen" | "derechos" | "publicar" | "flujo";

export interface Recomendacion {
  /** Estable entre llamadas (la UI recuerda las descartadas por id). */
  id: string;
  prioridad: Prioridad;
  area: Area;
  titulo: string;
  /** Por qué ayuda, en una o dos frases. */
  porque: string;
  /** Se aplica con un clic (ya validadas contra este proyecto). */
  ediciones?: Edicion[];
  /** Acción del editor que no es una edición. */
  accion?: "renderizar" | "alinearMusica";
  /** Ancla de la página donde se decide (p. ej. `#escena-e02`). */
  ir?: string;
  /** Usa la GPU (va por la cola y pide confirmar). */
  gpu?: boolean;
  /** Lo que gana el video, si se puede medir (p. ej. «−3,2 s»). */
  efecto?: string;
  /** Detalle técnico para quien lo quiera ver (la UI lo muestra plegado). */
  tecnico?: string;
  /** Elegir entre varias respuestas, cada una con sus ediciones (un botón por opción). */
  opciones?: { etiqueta: string; ediciones: Edicion[] }[];
  /** Escribir algo ahí mismo: `{texto}` dentro de las ediciones se cambia por lo escrito. */
  escribir?: {
    etiqueta: string; ejemplo: string; max: number; ediciones: Edicion[];
    /** Ruta (POST, relativa al proyecto) que devuelve `{ganchos: string[]}` con ideas de la IA local. Usa la GPU. */
    sugerir?: string;
  };
}

/** Cada regla del QC dicha como lo que la persona ve (sin LUFS, fps ni «assets»). */
const QC_SIMPLE: Record<string, string> = {
  sonoridad: "El volumen no es el que piden las redes",
  pico: "El sonido se satura en los golpes fuertes",
  color: "Los colores podrían verse distintos en otros teléfonos",
  resolucion: "El tamaño del video no es el correcto",
  fps: "El video no tiene la fluidez correcta",
  duracion: "La imagen y el sonido no duran lo mismo",
  fotogramas: "Faltan o sobran cuadros en el video",
  ampliacion: "Una imagen se ve borrosa por estar estirada",
  duplicados: "La imagen se queda congelada",
  subtitulos: "Hay subtítulos difíciles de leer",
  "subtitulos-ritmo": "Los subtítulos pasan muy rápido",
  "zonas-seguras": "Un texto queda tapado por los botones de la red social",
  "hyperframes-check": "Hay un error al armar el video",
  licencias: "No está claro que puedas usar todo lo que aparece",
  alineacion: "Los subtítulos no van al tiempo con la voz",
  ritmo: "Los cortes no caen al ritmo de la música",
  clip: "El clip no cumple las reglas de la campaña",
};

export interface ReglaQcV {
  id: string;
  nombre: string;
  ok: boolean;
  aviso?: boolean;
  detalle?: string;
}

export interface EntradaRecomendar {
  p: Proyecto;
  /** Duración de la tarjeta final de la plantilla (s). */
  tarjeta?: number;
  versionActual: number;
  /** Último render, si hay. */
  render?: { versionNumero: number; estado: string; reglas?: ReglaQcV[] } | null;
  /** Trabajos pendientes o corriendo de este proyecto. */
  trabajosActivos?: number;
  /** Publicaciones hechas o programadas de este proyecto. */
  publicaciones?: number;
}

/** Lo que dura el gancho: si en este tiempo no pasa nada, la gente desliza. */
export const SEGUNDOS_GANCHO = 2.6;
/** Ahorro mínimo (s) para recomendar acortar silencios o quitar muletillas. */
const AHORRO_MIN = 0.5;
/** Una foto fija más larga que esto cansa (s). */
const FOTO_LARGA = 5;
const ORDEN: Record<Prioridad, number> = { bloquea: 0, mejora: 1, idea: 2 };

const seg = (s: number) => `${s.toFixed(1).replace(".", ",")} s`;
const num = (i: number) => `la escena ${i + 1}`;

/** Prueba las ediciones contra el proyecto: el proyecto nuevo si aplican todas, si no null. */
function probar(p: Proyecto, eds: Edicion[]): Proyecto | null {
  return aplicarPasos(p, eds).nuevo;
}

export function recomendar(e: EntradaRecomendar): Recomendacion[] {
  const { p } = e;
  const out: Recomendacion[] = [];
  const escenas = escenasEnLinea(p);
  const duracion = duracionEscenas(p);
  const total = duracion + (e.tarjeta ?? 0);
  const esClip = escenas.some((x) => x.visual.sincro === "voz");
  const vertical = p.formato === "9:16";

  // --- Flujo: render y QC -------------------------------------------------------------------------
  const r = e.render;
  if (e.trabajosActivos) {
    out.push({ id: "trabajos", prioridad: "idea", area: "flujo", titulo: "Espera a que terminen los trabajos en curso",
      porque: "Lo que cambies ahora puede quedar debajo de lo que esos trabajos guarden al terminar.", ir: "#trabajos" });
  } else if (!r) {
    out.push({ id: "renderizar", prioridad: "mejora", area: "flujo", titulo: "Arma el video para revisarlo",
      porque: "Hasta que no lo armes no se revisa su calidad ni se puede descargar. No usa la tarjeta de video: tarda 1 o 2 minutos.", accion: "renderizar" });
  } else if (r.versionNumero !== e.versionActual) {
    out.push({ id: "renderizar", prioridad: "mejora", area: "flujo", titulo: "Hay cambios que todavía no están en el video",
      porque: "Lo que descargarías es de antes de tus últimos cambios. Vuelve a armarlo para revisarlo y descargarlo tal como lo ves ahora (1 o 2 minutos).", accion: "renderizar" });
  }
  // Fallos del QC del último render (si está al día; si no, pueden estar ya arreglados).
  if (r?.reglas && r.versionNumero === e.versionActual) {
    for (const regla of r.reglas.filter((x) => !x.ok)) {
      const x = explicar(regla.id);
      out.push({
        id: `qc-${regla.id}`, prioridad: regla.aviso ? "mejora" : "bloquea", area: regla.id.startsWith("subtitulos") ? "subtitulos" : regla.id === "licencias" || regla.id === "clip" ? "derechos" : x.tecnico ? "flujo" : "imagen",
        titulo: QC_SIMPLE[regla.id] ?? `Revisión de calidad: ${regla.nombre}`,
        porque: regla.id === "licencias" && /musica/i.test(regla.detalle ?? "") && !esClip
          ? "La música de este video no tiene una licencia clara. Para publicarlo tranquilo, usa una con permiso (por ejemplo, de la Biblioteca de audio de YouTube)."
          : x.hacer,
        tecnico: [regla.nombre, regla.detalle].filter(Boolean).join(": ") || undefined,
        ...(x.tecnico ? { accion: "renderizar" as const } : regla.id === "ritmo" ? { accion: "alinearMusica" as const } : { ir: "#listo" }),
      });
    }
  }

  if (!escenas.length) return ordenar(out);

  // --- Derechos (antes de renderizar: el QC lo bloquearía igual) ---------------------------------
  if (p.comercial) {
    const dudosos = [...new Set([...p.pistas.flatMap((x) => x.clips.map((c) => c.asset))])]
      .map((id) => p.assets[id]).filter((a) => a && usoComercial(a.licencia) !== "si");
    if (dudosos.length) {
      out.push({ id: "licencias", prioridad: "bloquea", area: "derechos", titulo: `${dudosos.length === 1 ? "Un archivo" : `${dudosos.length} archivos`} sin permiso claro para uso comercial`,
        porque: `Marcaste el video para ganar dinero o para un cliente, y no está claro que ${dudosos.length === 1 ? "ese archivo se pueda" : "esos archivos se puedan"} usar así. Cámbia${dudosos.length === 1 ? "lo" : "los"}, o desmarca «Uso comercial» si no lo vas a monetizar.`,
        tecnico: dudosos.map((a) => `${a!.ruta.split("/").pop()}: ${a!.licencia}`).slice(0, 5).join(" · "),
        ir: "#destino" });
    }
  }

  // --- Demo de una página con imágenes que no cargaron al grabarla --------------------------------
  const rotas = Object.values(p.assets).reduce((n, a) => n + (a.regenerar.origen === "demo-web" ? Number(a.regenerar.imagenesRotas) || 0 : 0), 0);
  if (rotas > 0) {
    out.push({ id: "demo-imagenes-rotas", prioridad: "mejora", area: "imagen",
      titulo: rotas === 1 ? "Una imagen de tu página no cargó" : `${rotas} imágenes de tu página no cargaron`,
      porque: `Cuando Geeper grabó la página, ${rotas === 1 ? "esa imagen no apareció y se ve un hueco" : "esas imágenes no aparecieron y se ven huecos"} en la demo. Arréglala${rotas === 1 ? "" : "s"} en tu página y vuelve a crear el video, o sube una grabación de tu pantalla.` });
  }

  // --- Subtítulos que no se pueden leer (sin esperar al render) ----------------------------------
  const grupos = todosLosGrupos(p);
  const subs = revisarSubtitulos(p.formato, grupos, ENTRADA + duracion, p.plataformas);
  if (subs.malosForma.length) {
    const primero = grupos.find((g) => subs.malosForma[0]!.includes(`«${g.texto}»`));
    out.push({ id: "subtitulos-forma", prioridad: "bloquea", area: "subtitulos", titulo: `${subs.malosForma.length === 1 ? "Un subtítulo no cabe" : `${subs.malosForma.length} subtítulos no caben`} en dos líneas`,
      porque: "Así no se puede publicar. Acorta lo que se lee (lo que se oye no cambia).", tecnico: subs.malosForma.slice(0, 3).join(" · "), ir: primero ? `#escena-${primero.escena}` : undefined });
  }

  // --- Ritmo: silencios, muletillas y tartamudeos ------------------------------------------------
  const silencios: Edicion = { tipo: "quitarSilencios", umbral: 0.6, dejar: 0.25 };
  const conSilencios = probar(p, [silencios]);
  const ahorroSil = conSilencios ? duracion - duracionEscenas(conSilencios) : 0;
  if (ahorroSil >= AHORRO_MIN) {
    out.push({ id: "silencios", prioridad: "mejora", area: "ritmo", titulo: "Acorta los silencios largos",
      porque: "Cada pausa de más de 0,6 s queda en 0,25 s. Un video sin huecos retiene más; la imagen se acorta con la voz.",
      ediciones: [silencios], efecto: `−${seg(ahorroSil)}` });
  }
  const muletillas: Edicion = { tipo: "quitarMuletillas" };
  const conMuletillas = probar(p, [muletillas]);
  const ahorroMul = conMuletillas ? duracion - duracionEscenas(conMuletillas) : 0;
  // Cuántos tramos quitaría: los recortes de muletilla que agrega la edición (los ya hechos no cuentan).
  const tramosMuletilla = (q: Proyecto) => Object.values(q.escenas).reduce((n, x) => n + x.recortes.filter((r) => r.motivo === "muletilla").length, 0);
  const cuantas = conMuletillas ? tramosMuletilla(conMuletillas) - tramosMuletilla(p) : 0;
  if (cuantas && ahorroMul >= 0.2) {
    out.push({ id: "muletillas", prioridad: "mejora", area: "ritmo", titulo: cuantas === 1 ? "Quita una muletilla («eh», «este…»)" : `Quita ${cuantas} muletillas y repeticiones («eh», «el el»)`,
      porque: "Suenan a duda. Se quitan del audio y de los subtítulos; puedes devolver cada una desde la edición por texto.",
      ediciones: [muletillas], efecto: `−${seg(ahorroMul)}` });
  }

  // --- Tiempos dudosos de la voz -----------------------------------------------------------------
  const conf = resumirConfianza(escenas.map((x) => ({ id: x.escena.id, palabras: x.escena.palabras })));
  // Si el QC del render al día ya lo marca («alineacion»), no se repite con otra prioridad.
  if (conf.dudosas > 0 && !out.some((x) => x.id === "qc-alineacion")) {
    const primera = conf.escenas[0]?.escena;
    out.push({ id: "dudosas", prioridad: conf.dudosas / Math.max(1, conf.medidas) > 0.2 ? "bloquea" : "mejora", area: "subtitulos",
      titulo: `Escucha ${conf.dudosas === 1 ? "1 palabra con tiempo dudoso" : `${conf.dudosas} palabras con tiempo dudoso`}`,
      porque: "El subtítulo puede ir adelantado o decir otra cosa. Escúchalas y confírmalas o corrígelas; no recortes ahí sin oírlas.",
      ir: primera ? `#escena-${primera}` : undefined });
  }

  // --- Gancho: los primeros 2,6 s ----------------------------------------------------------------
  const textoAlInicio = p.textos.some((t) => t.inicio < SEGUNDOS_GANCHO && t.duracion >= 1);
  const primera = escenas[0]!;
  const primeraPalabra = primera.escena.palabras.find((w) => !primera.escena.recortes.some((x) => (w.inicio + w.fin) / 2 >= x.inicio && (w.inicio + w.fin) / 2 <= x.fin));
  const arranque = primeraPalabra ? Math.max(0, primeraPalabra.inicio - primera.voz.rango.inicio) : 0;
  const arrancar: Edicion = { tipo: "quitarSilencios", escena: primera.escena.id, umbral: 0.6, dejar: 0.25 };
  const conArranque = arranque > 0.8 ? probar(p, [arrancar]) : null;
  if (conArranque && ahorroSil < AHORRO_MIN) {
    // Si ya se recomienda acortar todos los silencios, eso incluye éste.
    out.push({ id: "arranque", prioridad: "mejora", area: "gancho", titulo: "El video tarda en arrancar",
      porque: `La primera palabra llega a los ${seg(arranque)}. En un short, lo primero que se oye tiene que ser el gancho: recorta ese silencio.`,
      ediciones: [arrancar], efecto: `−${seg(duracion - duracionEscenas(conArranque))}` });
  }
  if (!textoAlInicio && vertical) {
    out.push({ id: "gancho-texto", prioridad: "mejora", area: "gancho", titulo: "Pon el gancho escrito en los primeros 2,6 s",
      porque: "Mucha gente ve los shorts sin sonido: un título corto arriba hace que se queden. Usa 3 a 9 palabras con una promesa o un dato, y que el video lo cumpla.",
      escribir: { etiqueta: "Tu gancho", ejemplo: "3 faros que nadie se atreve a visitar", max: 60, sugerir: "ganchos",
        ediciones: [{ tipo: "agregarTexto", texto: { texto: "{texto}", inicio: ENTRADA, duracion: SEGUNDOS_GANCHO, estilo: "titulo", posicion: "arriba" } }] },
      ir: "#textos" });
  }
  if (primera.duracion > 4 && escenas.length > 2 && !esClip) {
    out.push({ id: "primera-larga", prioridad: "idea", area: "gancho", titulo: `La primera escena dura ${seg(primera.duracion)}`,
      porque: "Un cambio de imagen antes de los 3 s mantiene la atención. Pon tu mejor escena primero o recorta palabras del inicio.", ir: `#escena-${primera.escena.id}` });
  }

  // --- Duración --------------------------------------------------------------------------------
  if (vertical && total > 60) {
    out.push({ id: "largo", prioridad: "idea", area: "ritmo", titulo: `El video dura ${seg(total)}`,
      porque: "Los shorts de 20 a 45 s suelen retener mejor. Quita la escena que menos aporta o recorta frases de relleno.", ir: "#escenas" });
  }
  if (total < 8) {
    out.push({ id: "corto", prioridad: "idea", area: "ritmo", titulo: `El video dura sólo ${seg(total)}`,
      porque: "Con menos de 8 s casi no da tiempo de entender el mensaje. Si es a propósito (un loop), está bien." });
  }

  // --- Imagen ----------------------------------------------------------------------------------
  const fijas = escenas.filter((x) => p.assets[x.visual.asset]?.tipo === "imagen" && x.duracion > FOTO_LARGA);
  if (fijas.length) {
    out.push({ id: "fotos-largas", prioridad: "mejora", area: "imagen",
      titulo: fijas.length === 1 ? `${num(fijas[0]!.indice).replace(/^l/, "L")} es una foto fija de ${seg(fijas[0]!.duracion)}` : `${fijas.length} escenas son fotos fijas de más de ${FOTO_LARGA} s`,
      porque: "Una foto quieta tanto tiempo cansa. Dale «Cámara 3D» (profundidad real) o «Animar esta escena con IA», o cambia la imagen por un video.",
      ir: `#escena-${fijas[0]!.escena.id}`, gpu: true });
  }
  const variedad = new Set(escenas.map((x) => x.visual.transicion?.tipo ?? "")).size;
  if (escenas.length >= 4 && !p.estilo?.transicion && variedad <= 1 && !esClip) {
    const ed: Edicion = { tipo: "estiloVideo", transicion: { tipo: "fundido", duracion: 0.35 }, curva: "suave" };
    if (probar(p, [ed])) {
      out.push({ id: "estilo", prioridad: "idea", area: "imagen", titulo: "Dale un estilo parejo a todo el video",
        porque: "Un fundido corto entre escenas y movimiento de cámara suave hacen que se vea editado a mano. Puedes cambiarlo en «Estilo del video».",
        ediciones: [ed] });
    }
  }

  // --- Sonido ----------------------------------------------------------------------------------
  const musica = p.pistas.find((x) => x.id === "musica" && x.clips.length);
  if (!musica && !esClip) {
    out.push({ id: "musica", prioridad: "idea", area: "sonido", titulo: "El video no tiene música",
      porque: "Una música suave debajo de la voz da ritmo. Los videos nuevos la toman de la carpeta de música de la plantilla (elige una con licencia clara); a éste puedes subirle una en «Superposiciones y efectos de sonido».", ir: "#superposiciones" });
  } else if (musica && !p.marcadores.some((m) => m.tipo === "pulso") && escenas.length > 2) {
    out.push({ id: "ritmo-musica", prioridad: "idea", area: "sonido", titulo: "Haz que los cortes caigan al ritmo de la música",
      porque: "Geeper busca los pulsos y mueve la música para que los cambios de escena coincidan. Se nota aunque no se sepa por qué.", accion: "alinearMusica" });
  }
  if (subs.peorCps > 17 && !esClip && p.voz.velocidad > 0.85 && pista(p, "voz").clips.every((c) => p.assets[c.asset]?.source !== "archivo")) {
    out.push({ id: "voz-rapida", prioridad: "idea", area: "subtitulos", titulo: "Los subtítulos pasan muy rápido",
      porque: `En algunas partes no da tiempo de leer. En «Ajustes», baja la velocidad de la voz a ${String(Math.max(0.85, Math.round((p.voz.velocidad - 0.05) * 100) / 100)).replace(".", ",")} y pulsa «Regenerar voz» (unos segundos, sin tarjeta de video): cambiar sólo el número no cambia lo que se oye.`,
      tecnico: `${subs.peorCps.toFixed(1)} caracteres por segundo en el peor tramo (lo cómodo es ≤ 17)`,
      ir: "#vel" });
  }

  // --- Publicar --------------------------------------------------------------------------------
  if (vertical && !p.plataformas.length) {
    out.push({ id: "plataformas", prioridad: "mejora", area: "publicar", titulo: "Di dónde lo vas a publicar",
      porque: "Cada red tapa una parte distinta de la pantalla con sus botones. Al elegirla, Geeper mueve los textos para que nada quede tapado.",
      opciones: [
        { etiqueta: "TikTok", ediciones: [{ tipo: "cambiarDestino", plataformas: ["tiktok"] }] },
        { etiqueta: "YouTube Shorts", ediciones: [{ tipo: "cambiarDestino", plataformas: ["youtube"] }] },
        { etiqueta: "Instagram", ediciones: [{ tipo: "cambiarDestino", plataformas: ["instagram"] }] },
        { etiqueta: "En todas", ediciones: [{ tipo: "cambiarDestino", plataformas: ["tiktok", "youtube", "instagram", "facebook"] }] },
      ],
      ir: "#destino" });
  }
  if (r?.estado === "aprobado" && r.versionNumero === e.versionActual && !e.publicaciones) {
    out.push({ id: "publicar", prioridad: "idea", area: "publicar", titulo: "Listo para publicar",
      porque: "Pasó la revisión de calidad. Descárgalo o publícalo desde «Publicar en redes»: la IA de tu PC te sugiere el título y la descripción.", ir: "#publicar-titulo" });
  }

  return ordenar(out);
}

function ordenar(rs: Recomendacion[]): Recomendacion[] {
  return [...rs].sort((a, b) => ORDEN[a.prioridad] - ORDEN[b.prioridad]);
}
