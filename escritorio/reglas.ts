/**
 * Reglas de la carcasa de escritorio (escritorio/main.ts) sin Electron, para poder probarlas.
 */
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { MenuItemConstructorOptions } from "electron";

/** Si el registro pasa de `maxBytes`, se guarda como `<ruta>.1` (pisando el anterior) y se empieza otro. */
export function rotarRegistro(ruta: string, maxBytes = 5 * 1024 * 1024): void {
  try {
    if (fs.statSync(ruta).size > maxBytes) fs.renameSync(ruta, `${ruta}.1`);
  } catch {
    /* no existe todavía, o no se pudo: se sigue escribiendo en el mismo */
  }
}

/**
 * Lleva la salida y los errores del proceso al registro. Las dos tuberías comparten el archivo, así que
 * ninguna lo cierra (`end: false`): se cierra en el `close` del proceso, tras anotar cómo terminó.
 */
export function registrar(p: ChildProcess, salida: fs.WriteStream): void {
  p.stdout?.pipe(salida, { end: false });
  p.stderr?.pipe(salida, { end: false });
  p.on("close", (codigo, senal) => {
    salida.write(`--- terminó (${comoTermino(codigo, senal)}) ---\n`);
    salida.end();
  });
}

/** Cómo terminó un proceso, para el registro: el código de salida o la señal que lo cortó. */
export function comoTermino(codigo: number | null, senal: NodeJS.Signals | null): string {
  return senal ? `señal ${senal}` : `código ${codigo ?? "?"}`;
}

interface AccionesMenu {
  abrirProyectos: () => void;
  abrirRegistros: () => void;
  herramientasDesarrollo: () => void;
}

/**
 * Menú de la app, todo en español: los roles de Electron sin `label` salen en inglés («Edit», «Undo»,
 * «Zoom In»), así que cada uno lleva el suyo.
 */
export function plantillaMenu(esMac: boolean, a: AccionesMenu): MenuItemConstructorOptions[] {
  const app: MenuItemConstructorOptions = {
    label: "Geeper",
    submenu: [
      { role: "about", label: "Acerca de Geeper" },
      { type: "separator" },
      { role: "hide", label: "Ocultar Geeper" },
      { role: "hideOthers", label: "Ocultar los demás" },
      { role: "unhide", label: "Mostrar todo" },
      { type: "separator" },
      { role: "quit", label: "Salir de Geeper" },
    ],
  };
  return [
    ...(esMac ? [app] : [{ label: "Archivo", submenu: [{ role: "quit" as const, label: "Salir" }] }]),
    {
      label: "Editar",
      submenu: [
        { role: "undo", label: "Deshacer" },
        { role: "redo", label: "Rehacer" },
        { type: "separator" },
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "selectAll", label: "Seleccionar todo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        { type: "separator" },
        { role: "resetZoom", label: "Tamaño real" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        { label: "Abrir la carpeta de proyectos", click: a.abrirProyectos },
        { label: "Abrir los registros", click: a.abrirRegistros },
        { label: "Herramientas de desarrollo", accelerator: "CmdOrCtrl+Alt+I", click: a.herramientasDesarrollo },
      ],
    },
  ];
}

/**
 * ¿Se puede volver a lanzar el worker? La misma regla que `pnpm run dev:up` (scripts/dev-up.ts): hasta
 * `max` reinicios en `ventanaMs`. Si se puede, anota este reinicio en `historial`.
 */
export function permitirReinicio(historial: number[], ahora: number, max = 5, ventanaMs = 10 * 60_000): boolean {
  const recientes = historial.filter((t) => ahora - t < ventanaMs);
  historial.splice(0, historial.length, ...recientes);
  if (historial.length >= max) return false;
  historial.push(ahora);
  return true;
}

/**
 * Un relanzamiento programado del worker (ESC-13). Programar otro cancela el anterior y `cancelar()` lo
 * quita: si la app se reinicia (o se cierra) mientras espera, no queda un worker viejo por lanzarse además
 * del nuevo.
 */
export class Relanzamiento {
  private tope: ReturnType<typeof setTimeout> | null = null;
  programar(fn: () => void, ms: number): void {
    this.cancelar();
    this.tope = setTimeout(() => {
      this.tope = null;
      fn();
    }, ms);
  }
  cancelar(): void {
    if (this.tope) clearTimeout(this.tope);
    this.tope = null;
  }
  get pendiente(): boolean {
    return this.tope !== null;
  }
}

/** Error de arranque con un texto pensado para la persona: se muestra tal cual en el cuadro (ESC-13). */
export class AvisoArranque extends Error {}

/** Lo que dice el cuadro «Geeper no pudo abrir»: el texto del aviso si es uno de los esperados; si no, uno general. */
export function textoErrorArranque(e: unknown): string {
  if (e instanceof AvisoArranque) return e.message;
  return "Algo falló al abrir Geeper.";
}

/** Origen (esquema, servidor y puerto) de una dirección, o null si no es una dirección válida. */
function origen(u: string): string | null {
  try {
    const o = new URL(u).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/**
 * ¿`destino` es una página de Geeper (`base` = http://127.0.0.1:<puerto>)? Sin base todavía, nada lo es.
 * Se compara el origen ya interpretado (SEG-07): `http://127.0.0.1:3300@otro.sitio/` es de otro.sitio.
 */
export function esDeGeeper(base: string, destino: string): boolean {
  if (base === "") return false;
  const o = origen(base);
  return o !== null && origen(destino) === o;
}

/** ¿Se puede pasar `destino` al navegador del sistema? Sólo páginas web: nada de file:, smb:, ms-… (SEG-07). */
export function abrirFuera(destino: string): boolean {
  try {
    const { protocol } = new URL(destino);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Permisos del navegador que Geeper concede, sólo a sus propias páginas (SEG-07). Son los que usan Geeper
 * y las apps Craft (comprobado en sus archivos): copiar y pegar, abrir y guardar archivos o carpetas
 * (File System Access), ver las fuentes instaladas (WordCraft, FigCraft) y pantalla completa. Todo lo
 * demás (cámara, micrófono, ubicación, avisos, MIDI, USB…) se niega.
 */
export const PERMISOS_GEEPER: ReadonlySet<string> = new Set(["clipboard-read", "clipboard-sanitized-write", "fileSystem", "local-fonts", "fullscreen"]);

/** ¿Se concede `permiso` a la página `desde`? Sólo los de PERMISOS_GEEPER y sólo a páginas de Geeper. */
export function concederPermiso(base: string, permiso: string, desde: string): boolean {
  return PERMISOS_GEEPER.has(permiso) && esDeGeeper(base, desde);
}

/** Lo que se ve mientras arrancan la base, el servidor y el worker (sale al instante tras el doble clic). */
export function paginaAbriendo(): string {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Geeper</title>
<style>html,body{height:100%;margin:0}body{background:#0b0d12;color:#e6e8ee;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
.c{text-align:center}.p{width:28px;height:28px;margin:0 auto 16px;border:3px solid #2a2f3a;border-top-color:#e6e8ee;border-radius:50%;animation:g 1s linear infinite}
@keyframes g{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.p{animation:none}}</style></head>
<body><div class="c"><div class="p"></div><div>Abriendo Geeper…</div></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Plazos del apagado, de dentro hacia fuera (WRK-07, ESC-11): el worker espera hasta 12 s a que sus
 * trabajos cortados queden «interrumpidos» (TOPE_APAGAR_MS en worker/sistema.ts); vigia.mjs le da 13 s
 * antes de salir solo, y la carcasa (y `pnpm run dev:up`) recién a los 14 s remata al que siga vivo.
 */
export const PLAZO_VIGIA_MS = 13_000;
export const PLAZO_APAGAR_MS = 14_000;

/**
 * Cómo rematar un proceso que no salió solo a tiempo (ESC-11). En Windows, `taskkill /T /F` corta también
 * a sus hijos (ffmpeg, Python, el Chrome de Hyperframes); en el resto, SIGKILL. `null` si ya no hay pid.
 */
export function comoRematar(plataforma: NodeJS.Platform, pid: number | undefined): { comando: string; args: string[] } | { senal: "SIGKILL" } | null {
  if (!pid) return null;
  if (plataforma === "win32") return { comando: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
  return { senal: "SIGKILL" };
}

export interface RutasHijos {
  /** Carpeta de la app (resources/app): standalone/, node_modules/, py/, recursos/. */
  raiz: string;
  documentos: string;
  appData: string;
  /** LOCALAPPDATA en Windows, si existe: las herramientas pesadas no van en Roaming. */
  localAppData?: string;
  plataforma: NodeJS.Platform;
  puerto: number;
}

/**
 * Entorno de los procesos hijos (servidor, worker, preparar-db): dónde viven las cosas en este sistema
 * (src/lib/plataforma.ts y src/lib/rutas.ts lo leen). Lo usan la carcasa y la prueba del empaquetado
 * (scripts/escritorio/probar-app.ts), para que la prueba arranque la app igual que la carcasa.
 */
export function entornoHijos(r: RutasHijos, base: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const p = r.plataforma === "win32" ? path.win32 : path.posix;
  return {
    ...base,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    GEEPER_ESCRITORIO: "1",
    GEEPER_DOCUMENTOS: r.documentos,
    GEEPER_APPDATA: r.appData,
    GEEPER_HERRAMIENTAS: r.plataforma === "win32" && r.localAppData ? p.join(r.localAppData, "Geeper", "herramientas") : p.join(r.appData, "herramientas"),
    GEEPER_RECURSOS: p.join(r.raiz, "recursos"),
    GEEPER_REPO: r.raiz,
    GEEPER_HYPERFRAMES_CLI: p.join(r.raiz, "node_modules", "hyperframes", "bin", "hyperframes.mjs"),
    PORT: String(r.puerto),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
