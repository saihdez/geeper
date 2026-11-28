/**
 * Datos de una invitación interactiva (docs/INVITACIONES.md). `invitacion.json` es la fuente de verdad:
 * la página, el .ics, la portada y el zip se rehacen desde aquí cada vez que algo cambia.
 */
import { z } from "zod";
import { Tema } from "./tema";

export const TIPOS = ["boda", "xv", "cumpleanos", "bautizo", "babyshower", "graduacion", "otro"] as const;
export const PLANTILLAS = ["vino-oro", "jardin", "minimal"] as const;

export const Tipo = z.enum(TIPOS);
export const PlantillaId = z.enum(PLANTILLAS);
/** Un estilo fijo o «tema»: el que se diseñó con una idea (ver tema.ts). */
export const EstiloId = z.enum([...PLANTILLAS, "tema"]);
export type EstiloId = z.infer<typeof EstiloId>;
export type Tipo = z.infer<typeof Tipo>;
export type PlantillaId = z.infer<typeof PlantillaId>;

/** Partes de la página que se pueden ocultar en «Corregir a mano». */
export const SECCIONES = ["mensaje", "cancion", "fecha", "cuenta", "lugar", "dress", "rsvp", "regalos", "comparte"] as const;
export const Seccion = z.enum(SECCIONES);

/**
 * Textos corregidos a mano sobre la página terminada: `clave` → el texto nuevo y `base`, el texto que
 * Geeper puso ahí. Si después cambian los datos y ese texto ya no es el mismo, el retoque deja de valer.
 */
export const Retoques = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,29}$/), z.object({ texto: z.string().max(1200), base: z.string().max(2000) }));
export type Retoques = z.infer<typeof Retoques>;

export const SLUG = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** ¿Es una zona horaria que entiende el sistema (IANA)? */
export function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return /\//.test(zona) || zona === "UTC";
  } catch {
    return false;
  }
}

const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).optional().transform((v) => (v ? v : undefined));
const httpsUrl = z.string().trim().max(2000).refine((v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}, "debe ser un enlace que empiece con https://");

export const Musica = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("ninguna") }),
  z.object({ tipo: z.literal("spotify"), clase: z.enum(["track", "album", "playlist"]), id: z.string().regex(/^[A-Za-z0-9]{22}$/) }),
  z.object({ tipo: z.literal("youtube"), id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
  z.object({ tipo: z.literal("archivo"), archivo: z.literal("musica.mp3") }),
]);
export type Musica = z.infer<typeof Musica>;

/** Lo que sale volando del sobre al abrirlo (efecto-sobre.ts). «auto»: el que va con el tema. */
export const EFECTOS_SOBRE = ["auto", "propio", "mariposas", "luciernagas", "petalos", "corazones", "estrellas", "brillos", "hojas", "copos", "burbujas", "confeti", "ninguno"] as const;
export const EfectoSobre = z.enum(EFECTOS_SOBRE);
export type EfectoSobre = z.infer<typeof EfectoSobre>;
/** Cómo se mueve un efecto propio (dibujado con IA). */
export const MOVIMIENTOS = ["aletea", "cae", "flota", "estalla"] as const;
export const Movimiento = z.enum(MOVIMIENTOS);
export type Movimiento = z.infer<typeof Movimiento>;

/** Lo que manda el formulario (la música llega como enlace y el servidor la convierte en `Musica`). */
export const Entrada = z.object({
  tipo: Tipo,
  nombres: texto(80).min(1, "escribe los nombres"),
  titulo: opcional(60),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida"),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora inválida"),
  duracionHoras: z.number().min(1).max(24).default(5),
  zona: z.string().refine(zonaValida, "zona horaria desconocida"),
  lugar: z.object({
    nombre: texto(100).min(1, "escribe el nombre del lugar"),
    direccion: opcional(200),
    mapa: httpsUrl.optional().or(z.literal("").transform(() => undefined)),
  }),
  whatsapp: z.string().transform((v) => v.replace(/[\s()+.-]/g, "")).pipe(z.string().regex(/^\d{8,15}$/, "el WhatsApp debe tener sólo números, con el código de país (8 a 15 dígitos)")),
  plantilla: EstiloId.optional(),
  tema: Tema.optional(),
  mensaje: opcional(600),
  musicaEnlace: opcional(500),
  dressCode: z.object({
    estilo: opcional(40),
    colores: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(4).default([]),
    evitar: opcional(120),
  }).default({ estilo: undefined, colores: [], evitar: undefined }),
  confirmarAntes: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  pases: z.number().int().min(1).max(20).optional(),
  regalos: opcional(300),
  hashtag: opcional(40),
  efectoSobre: EfectoSobre.optional(),
});
export type Entrada = z.input<typeof Entrada>;

export const Invitacion = Entrada.omit({ musicaEnlace: true, plantilla: true }).extend({
  version: z.literal(1),
  slug: z.string().regex(SLUG),
  creada: z.string(),
  actualizada: z.string(),
  plantilla: EstiloId,
  musica: Musica,
  /** Enlace a la canción tal como lo pegó la persona (para volver a mostrarlo en el formulario). */
  musicaEnlace: opcional(500),
  foto: z.literal("foto.webp").optional(),
  /** Fondo realista de toda la página, dibujado con IA (imagenes.ts): reemplaza las siluetas. */
  fondo: z.literal("fondo.webp").optional(),
  urlPublica: httpsUrl.optional(),
  /** QR con dibujo elegido (imagenes.ts) y la dirección que lleva: si la dirección cambia, ya no sirve. */
  qrArte: z.object({ archivo: z.literal("qr-arte.png"), url: z.string() }).optional(),
  /** Efecto propio para el sobre: figuras recortadas (efecto-N.webp) dibujadas con IA desde una descripción. */
  efectoPropio: z.object({
    descripcion: z.string().max(300),
    movimiento: Movimiento,
    figuras: z.array(z.string().regex(/^efecto-\d\.webp$/)).min(1).max(6),
  }).optional(),
  /** Imagen del enlace en WhatsApp: la portada (por defecto) o el QR con dibujo. */
  vistaPrevia: z.enum(["portada", "qr"]).optional(),
  retoques: Retoques.optional(),
  ocultas: z.array(Seccion).optional(),
  /** Pedido de Google Forms del que salió (formularios.ts). */
  formulario: z.string().optional(),
});
export type Invitacion = z.infer<typeof Invitacion>;

/**
 * Corrige direcciones que no son la de la invitación publicada: el panel de Netlify
 * (`app.netlify.com/drop/<sitio>`, `/sites/<sitio>/…`, `/projects/<sitio>/…`) → `https://<sitio>.netlify.app/`.
 */
export function normalizarUrlPublica(url: string): string {
  const u = url.trim();
  const m = /^https?:\/\/app\.netlify\.com\/(?:drop|sites|projects)\/([a-z0-9][a-z0-9-]*)/i.exec(u);
  if (m) return `https://${m[1]!.toLowerCase()}.netlify.app/`;
  return u.replace(/^http:\/\//i, "https://");
}

/** «2026-12-15» ya pasó en esa zona horaria (se compara la fecha del evento con la de hoy allí). */
export function fechaPasada(fecha: string, zona: string, ahora = new Date()): boolean {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
  return fecha < hoy;
}
