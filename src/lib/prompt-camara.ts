/**
 * Lenguaje de cámara para los prompts de planos generativos. Los modelos (Wan, LTX) responden mejor a
 * descripciones de cámara en inglés que a «cinematográfico». Cámara, lente, focal y apertura vienen de
 * Cinema Studio de Open-Generative-AI (MIT, commit 7858e08, src/lib/promptUtils.js) con nombres en
 * español; el movimiento es de Geeper (Wan 2.2 lo entiende como instrucción de cámara). Plano, luz y look
 * vienen de Cinematic Studio de Comfy Org (MIT, commit f223ccf, lib/prompt.ts), con más opciones.
 */

export const PLANOS = {
  general: "wide establishing shot",
  medio: "medium shot",
  primero: "close-up portrait",
  contrapicado: "low-angle shot",
  cenital: "overhead shot",
} as const;

export const LUCES = {
  ventana: "soft window light",
  "hora-dorada": "golden-hour backlight",
  mediodia: "hard noon sunlight",
  "hora-azul": "blue-hour practical lights",
  estudio: "soft even studio lighting",
  neon: "colorful neon lights",
} as const;

export const LOOKS = {
  "pelicula-calida": "warm cinematic film look",
  "ciencia-ficcion": "cool science-fiction film look",
  documental: "natural documentary color",
  noir: "high-contrast noir look",
  vivo: "vibrant saturated colors",
} as const;

export const CAMARAS = {
  "digital-8k": "modular 8K digital cinema camera",
  "cine-full-frame": "full-frame digital cinema camera",
  "pelicula-70mm": "grand format 70mm film camera",
  "super-35": "Super 35 studio digital camera",
  "pelicula-16mm": "classic 16mm film camera",
  "gran-formato": "premium large-format digital cinema camera",
} as const;

export const LENTES = {
  "tilt-shift": "creative tilt lens effect",
  "anamorfico-compacto": "compact anamorphic lens",
  macro: "extreme macro lens",
  "prime-70s": "1970s cinema prime lens",
  anamorfico: "classic anamorphic lens",
  "prime-moderno": "premium modern prime lens",
  "prime-calido": "warm-toned cinema prime lens",
  "bokeh-espiral": "swirl bokeh portrait lens",
  "prime-vintage": "vintage prime lens",
  halation: "halation diffusion filter",
  "prime-nitido": "ultra-sharp clinical prime lens",
} as const;

export const FOCALES = {
  8: "ultra-wide perspective",
  14: "wide-angle perspective",
  24: "wide-angle dynamic perspective",
  35: "natural cinematic perspective",
  50: "standard portrait perspective",
  85: "classic portrait perspective",
} as const;

export const APERTURAS = {
  "f/1.4": "shallow depth of field, creamy bokeh",
  "f/4": "balanced depth of field",
  "f/11": "deep focus clarity, sharp foreground to background",
} as const;

export const MOVIMIENTOS = {
  fijo: "static locked-off camera",
  acercar: "camera slowly pushes in",
  alejar: "camera slowly pulls back",
  "paneo-izq": "camera pans slowly to the left",
  "paneo-der": "camera pans slowly to the right",
  orbita: "camera orbits slowly around the subject",
  mano: "subtle handheld camera movement",
} as const;

export interface Camara {
  plano?: keyof typeof PLANOS;
  luz?: keyof typeof LUCES;
  look?: keyof typeof LOOKS;
  camara?: keyof typeof CAMARAS;
  lente?: keyof typeof LENTES;
  focal?: keyof typeof FOCALES;
  apertura?: keyof typeof APERTURAS;
  movimiento?: keyof typeof MOVIMIENTOS;
}

/** Valida claves que vienen de la terminal o de un JSON; lanza con las opciones válidas. */
export function camaraDe(o: Record<string, string | undefined>): Camara {
  const elegir = <T extends object>(nombre: string, tabla: T, v: string | undefined): keyof T | undefined => {
    if (v === undefined || v === "") return undefined;
    if (!(v in tabla)) throw new Error(`${nombre} desconocido: ${v} (hay: ${Object.keys(tabla).join(", ")})`);
    return v as keyof T;
  };
  const focal = o.focal === undefined || o.focal === "" ? undefined : Number(o.focal);
  return {
    plano: elegir("Plano", PLANOS, o.plano),
    luz: elegir("Luz", LUCES, o.luz),
    look: elegir("Look", LOOKS, o.look),
    camara: elegir("Cámara", CAMARAS, o.camara),
    lente: elegir("Lente", LENTES, o.lente),
    focal: focal === undefined ? undefined : (elegir("Focal", FOCALES, String(focal)) as unknown as keyof typeof FOCALES),
    apertura: elegir("Apertura", APERTURAS, o.apertura),
    movimiento: elegir("Movimiento", MOVIMIENTOS, o.movimiento),
  };
}

/**
 * Agrega al prompt base lo que se eligió, en el orden en que lo lee el modelo: el plano antes de la escena
 * (como Cinematic Studio), después el movimiento, la cámara y la óptica, y al final la luz y el look.
 */
export function promptConCamara(base: string, c: Camara): string {
  const partes = [c.plano ? PLANOS[c.plano] : "", base.trim()];
  if (c.movimiento) partes.push(MOVIMIENTOS[c.movimiento]);
  if (c.camara) partes.push(`shot on a ${CAMARAS[c.camara]}`);
  if (c.lente || c.focal) {
    const lente = c.lente ? LENTES[c.lente] : "lens";
    partes.push(c.focal ? `using a ${lente} at ${c.focal}mm (${FOCALES[c.focal]})` : `using a ${lente}`);
  }
  if (c.apertura) partes.push(`aperture ${c.apertura}`, APERTURAS[c.apertura]);
  if (c.luz) partes.push(LUCES[c.luz]);
  if (c.look) partes.push(LOOKS[c.look]);
  return partes.filter(Boolean).join(", ");
}

/** Nombres para la persona (la UI muestra éstos; al modelo va el texto en inglés de arriba). */
export const NOMBRES = {
  plano: {
    general: "General (se ve todo el lugar)",
    medio: "Medio (de la cintura para arriba)",
    primero: "Primer plano (la cara)",
    contrapicado: "Desde abajo (imponente)",
    cenital: "Desde arriba",
  } satisfies Record<keyof typeof PLANOS, string>,
  luz: {
    ventana: "Luz suave de ventana",
    "hora-dorada": "Atardecer dorado",
    mediodia: "Sol fuerte de mediodía",
    "hora-azul": "Anochecer con luces",
    estudio: "Estudio pareja",
    neon: "Neones de colores",
  } satisfies Record<keyof typeof LUCES, string>,
  look: {
    "pelicula-calida": "Película cálida",
    "ciencia-ficcion": "Ciencia ficción fría",
    documental: "Natural de documental",
    noir: "Blanco y negro de alto contraste",
    vivo: "Colores vivos",
  } satisfies Record<keyof typeof LOOKS, string>,
  movimiento: {
    fijo: "Quieta",
    acercar: "Acercarse",
    alejar: "Alejarse",
    "paneo-izq": "Hacia la izquierda",
    "paneo-der": "Hacia la derecha",
    orbita: "Rodear",
    mano: "Cámara en mano",
  } satisfies Record<keyof typeof MOVIMIENTOS, string>,
  camara: {
    "digital-8k": "Cine digital 8K",
    "cine-full-frame": "Cine digital full frame",
    "pelicula-70mm": "Película 70 mm",
    "super-35": "Super 35",
    "pelicula-16mm": "Película 16 mm (con grano)",
    "gran-formato": "Gran formato digital",
  } satisfies Record<keyof typeof CAMARAS, string>,
  lente: {
    "tilt-shift": "Tilt-shift (efecto maqueta)",
    "anamorfico-compacto": "Anamórfico compacto",
    macro: "Macro (muy de cerca)",
    "prime-70s": "Fijo de los 70",
    anamorfico: "Anamórfico (destellos horizontales)",
    "prime-moderno": "Fijo moderno",
    "prime-calido": "Fijo cálido",
    "bokeh-espiral": "Bokeh en espiral",
    "prime-vintage": "Fijo antiguo",
    halation: "Difusión con halo",
    "prime-nitido": "Fijo muy nítido",
  } satisfies Record<keyof typeof LENTES, string>,
  apertura: {
    "f/1.4": "f/1.4 · fondo muy desenfocado",
    "f/4": "f/4 · intermedio",
    "f/11": "f/11 · todo enfocado",
  } satisfies Record<keyof typeof APERTURAS, string>,
  focal: {
    8: "8 mm · ultra gran angular",
    14: "14 mm · gran angular",
    24: "24 mm · amplio",
    35: "35 mm · natural",
    50: "50 mm · retrato",
    85: "85 mm · retrato cerrado",
  } satisfies Record<keyof typeof FOCALES, string>,
};
