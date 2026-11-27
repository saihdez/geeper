/**
 * Las secciones de Geeper, en un solo sitio: la barra de arriba y el «Ir a» del buscador Ctrl+K
 * salen de esta lista, así no se separan (antes el buscador no conocía Clips, Avatares ni Workflows).
 */
export interface Destino {
  titulo: string;
  ruta: string;
  /** Otras palabras con las que alguien podría buscarla en Ctrl+K. */
  palabras: string;
}

export const DESTINOS: Destino[] = [
  { titulo: "Mis videos", ruta: "/", palabras: "proyectos inicio lista portada" },
  { titulo: "Nuevo video", ruta: "/nuevo", palabras: "crear generar tema lote proyecto pagina web" },
  { titulo: "Clips", ruta: "/clips", palabras: "recortes momentos directo vod stream largo cortar" },
  { titulo: "Avatares", ruta: "/avatares", palabras: "presentador personaje cara voz propia" },
  { titulo: "Workflows", ruta: "/workflows", palabras: "recetas comfyui imagen ia quitar fondo" },
  { titulo: "Escenas 3D", ruta: "/escenas-3d", palabras: "blender 3d logo producto titulo animacion personaje graficos" },
  { titulo: "Trabajos", ruta: "/trabajos", palabras: "cola avance log progreso en marcha" },
  { titulo: "Anuncios", ruta: "/anuncios", palabras: "campañas ads publicidad" },
  { titulo: "Invitaciones", ruta: "/invitaciones", palabras: "boda cumpleaños evento fiesta invitacion whatsapp confirmar" },
  { titulo: "Estilos del canal", ruta: "/plantillas", palabras: "plantillas estilo diseño canal" },
  { titulo: "Media", ruta: "/media", palabras: "apps craft photocraft filmcraft vectorcraft effectcraft lightcraft designcraft pdfcraft soundcraft photoshop premiere illustrator after effects editar foto" },
  { titulo: "Cuentas", ruta: "/cuentas", palabras: "redes youtube tiktok instagram facebook conectar vpn publicar" },
  { titulo: "Sistema", ruta: "/sistema", palabras: "diagnostico doctor problemas estado revisar" },
];

/** El destino en el que está la página `ruta` (el más largo que coincida; «/» sólo en la portada). */
export function destinoActual(ruta: string): Destino | null {
  let mejor: Destino | null = null;
  for (const d of DESTINOS) {
    const coincide = d.ruta === "/" ? ruta === "/" || ruta.startsWith("/proyectos/") : ruta === d.ruta || ruta.startsWith(`${d.ruta}/`);
    if (coincide && (!mejor || d.ruta.length > mejor.ruta.length)) mejor = d;
  }
  return mejor;
}
