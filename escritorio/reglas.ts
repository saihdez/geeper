/**
 * Reglas de la carcasa de escritorio (escritorio/main.ts) sin Electron, para poder probarlas.
 */
import type { MenuItemConstructorOptions } from "electron";

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

/** ¿`destino` es una página de Geeper (`base` = http://127.0.0.1:<puerto>)? Sin base todavía, nada lo es. */
export function esDeGeeper(base: string, destino: string): boolean {
  return base !== "" && (destino === base || destino.startsWith(`${base}/`) || destino.startsWith(`${base}?`));
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
