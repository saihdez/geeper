/**
 * Defensa contra pedidos de otros sitios (CSRF) y contra el «rebinding» de DNS (SEG-06). La API de
 * Geeper escucha en localhost sin cuentas de usuario: cualquier página abierta en el navegador podría
 * mandarle un POST (generar con la GPU, publicar, borrar, cambiar las credenciales de las redes).
 *
 * - `Host` tiene que ser localhost, 127.0.0.1, [::1] o el de GEEPER_URL, en todos los métodos: una web
 *   que hace apuntar su dominio a 127.0.0.1 llega con su propio nombre en `Host` y se rechaza.
 * - En POST, PUT, PATCH y DELETE, se rechaza si `Sec-Fetch-Site` dice que viene de otro sitio o si
 *   `Origin` no es este mismo Geeper. Los pedidos sin esas cabeceras (scripts, la terminal, el worker)
 *   siguen pasando: no los manda un navegador. Los GET no se miran: el regreso de OAuth
 *   (/api/cuentas/callback) llega desde la web de la red social.
 *
 * Subidas: cuando el proxy corre, Next guarda una copia del cuerpo y la corta en 10 MB (lo medí: un
 * POST de 12 MB llegaba con 10,46 MB). Por eso las rutas que reciben archivos quedan fuera del
 * matcher general y el proxy sólo corre en ellas cuando el pedido ya trae una señal de venir de fuera
 * (y entonces se rechaza entero, así que el corte no importa).
 */
import { NextResponse, type NextRequest } from "next/server";

const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostsPermitidos(): Set<string> {
  const hosts = new Set(LOCALES);
  try {
    if (process.env.GEEPER_URL) hosts.add(new URL(process.env.GEEPER_URL).hostname.toLowerCase());
  } catch {
    // GEEPER_URL mal escrito: valen sólo los locales.
  }
  return hosts;
}

/** Parte «nombre:puerto» de la cabecera Host (también con IPv6 entre corchetes). */
function partirHost(host: string): { nombre: string; puerto: string } {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  return m ? { nombre: m[1]!, puerto: m[2] ?? "" } : { nombre: "", puerto: "" };
}

export interface Pedido {
  metodo: string;
  host: string | null;
  origen: string | null;
  sitio: string | null;
}

/** Por qué se rechaza un pedido (texto para la persona), o null si pasa. */
export function motivoDeRechazo(p: Pedido): string | null {
  const permitidos = hostsPermitidos();
  const host = partirHost(p.host ?? "");
  if (!permitidos.has(host.nombre)) return "Pedido rechazado: Geeper sólo responde cuando lo abres desde esta computadora (localhost).";
  if (SEGUROS.has(p.metodo.toUpperCase())) return null;
  if (p.sitio !== null && p.sitio !== "same-origin" && p.sitio !== "none") return "Pedido rechazado: viene de otra página web, no de Geeper.";
  if (p.origen !== null) {
    let o: URL;
    try {
      o = new URL(p.origen);
    } catch {
      return "Pedido rechazado: viene de otra página web, no de Geeper."; // «null» y otros orígenes opacos
    }
    // Sin puerto escrito vale el de su protocolo; Host no dice el protocolo, así que se toma el del Origin.
    const porDefecto = o.protocol === "https:" ? "443" : "80";
    const puertoOrigen = o.port || porDefecto;
    const puertoHost = host.puerto || porDefecto;
    if (!permitidos.has(o.hostname.toLowerCase()) || puertoOrigen !== puertoHost) return "Pedido rechazado: viene de otra página web, no de Geeper.";
  }
  return null;
}

export function proxy(req: NextRequest) {
  const motivo = motivoDeRechazo({
    metodo: req.method,
    host: req.headers.get("host"),
    origen: req.headers.get("origin"),
    sitio: req.headers.get("sec-fetch-site"),
  });
  return motivo ? NextResponse.json({ error: motivo }, { status: 403 }) : NextResponse.next();
}

/*
 * Rutas que reciben archivos (quedan fuera del matcher general, ver arriba). Si se agrega una ruta de
 * subida nueva, sumarla en los cuatro lugares (Next exige que `config` sea literal) y en tests/proxy.test.ts.
 */
export const config = {
  matcher: [
    // Todo /api menos las subidas.
    "/api/((?!(?:clips/subir|demos/grabacion|avatares|escenas-3d|invitaciones/[^/]+/avnac|paleta|anuncios/[^/]+/imagen|plantillas/[^/]+/logo|plantillas/[^/]+/portada-propia|proyectos/[^/]+/clip|proyectos/[^/]+/avatar|proyectos/[^/]+/filmcraft|workflows/[^/]+)$).*)",
    // Subidas: sólo si el navegador dice que vienen de otro sitio…
    {
      source: "/api/(clips/subir|demos/grabacion|avatares|escenas-3d|invitaciones/[^/]+/avnac|paleta|anuncios/[^/]+/imagen|plantillas/[^/]+/logo|plantillas/[^/]+/portada-propia|proyectos/[^/]+/clip|proyectos/[^/]+/avatar|proyectos/[^/]+/filmcraft|workflows/[^/]+)",
      has: [{ type: "header", key: "sec-fetch-site", value: "(?!same-origin$|none$).*" }],
    },
    // …si traen un Origin que no es local…
    {
      source: "/api/(clips/subir|demos/grabacion|avatares|escenas-3d|invitaciones/[^/]+/avnac|paleta|anuncios/[^/]+/imagen|plantillas/[^/]+/logo|plantillas/[^/]+/portada-propia|proyectos/[^/]+/clip|proyectos/[^/]+/avatar|proyectos/[^/]+/filmcraft|workflows/[^/]+)",
      has: [{ type: "header", key: "origin" }],
      missing: [{ type: "header", key: "origin", value: "https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?" }],
    },
    // …o si llegan con un Host que no es local (rebinding de DNS, o el host de GEEPER_URL). Next arma
    // new RegExp(`^${value}$`) (por eso el grupo: sin él, «localhost.atacante.com» contaría como local) y
    // antes corta el Host en el primer «:», así que de «[::1]:3300» sólo le llega «[».
    {
      source: "/api/(clips/subir|demos/grabacion|avatares|escenas-3d|invitaciones/[^/]+/avnac|paleta|anuncios/[^/]+/imagen|plantillas/[^/]+/logo|plantillas/[^/]+/portada-propia|proyectos/[^/]+/clip|proyectos/[^/]+/avatar|proyectos/[^/]+/filmcraft|workflows/[^/]+)",
      missing: [{ type: "host", value: "(localhost|127\\.0\\.0\\.1|\\[)" }],
    },
  ],
};
