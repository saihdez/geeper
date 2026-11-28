/**
 * Apps Craft que no tienen versión web (hoy, AniCraft): en Windows y Linux se instala su programa de
 * escritorio oficial (zip portable o tarball, verificado con SHA256SUMS.txt, con el mismo instalador que
 * PhotoCraft) en <herramientas>/<app>-escritorio y Geeper lo abre en su propia ventana. En macOS sólo
 * publican un .dmg (hay que arrastrarlo a Aplicaciones): ahí queda el enlace de descarga.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { APPS_CRAFT, type AppCraft } from "./craft-web";
import { crearInstalador, type EstadoInstalacion } from "./instalar-craft";
import { cliCraft, exe, SISTEMA } from "./plataforma";
import { correr } from "./proceso";
import { dirDatos, ESTUDIO } from "./rutas";

/** Este sistema puede instalar y abrir los programas de escritorio de Craft. */
export const ESCRITORIO_CRAFT = SISTEMA === "windows" || (SISTEMA === "linux" && process.arch === "x64");

export const appEscritorio = (app: string): AppCraft | null => APPS_CRAFT.find((a) => a.app === app && a.soloEscritorio) ?? null;

const dirApp = (app: string) => path.join(ESTUDIO, `${app}-escritorio`);
const cli = (app: string) => cliCraft(dirApp(app), `${app}-cli`);
/** El programa con ventana: al lado del CLI (Windows: raíz del zip; Linux: bin/). */
export const programa = (app: string) => path.join(path.dirname(cli(app)), exe(app));

/** Versión instalada («anicraft-cli 0.2.1») o null. */
export async function versionEscritorio(app: string): Promise<string | null> {
  if (!ESCRITORIO_CRAFT || !existsSync(cli(app))) return null;
  const r = await correr(cli(app), ["--version"], { permitirFallo: true, timeout: 20_000 }).catch(() => null);
  return r?.codigo === 0 ? r.stdout.trim().split("\n")[0]! : null;
}

const g = globalThis as unknown as { __craftEscritorio?: Map<string, ReturnType<typeof crearInstalador>> };
function instalador(a: AppCraft) {
  const m = (g.__craftEscritorio ??= new Map());
  let i = m.get(a.app);
  if (!i) {
    i = crearInstalador({ app: a.app, version: a.version, carpeta: `${a.app}-escritorio`, verificar: () => versionEscritorio(a.app) });
    m.set(a.app, i);
  }
  return i;
}

export const instalacionEscritorio = (a: AppCraft): EstadoInstalacion | null => (ESCRITORIO_CRAFT ? instalador(a).estado() : null);

export function instalarEscritorio(a: AppCraft): EstadoInstalacion {
  if (!ESCRITORIO_CRAFT) throw new Error(`${a.nombre} sólo publica un instalador para este sistema: descárgalo desde su página.`);
  return instalador(a).iniciar();
}

/**
 * Apps cuyo zip portable de Windows guarda la configuración y lo que descarga (Ghidra, Java…) junto al
 * programa, es decir, dentro de la carpeta de la versión: al instalar otra versión se perdería todo y lo
 * volvería a bajar. Geeper les da una carpeta fija con la variable que cada una lee.
 */
const DATOS_FIJOS: Record<string, { variable: string; portable: string }> = {
  "craft-anything": { variable: "CRAFT_ANYTHING_CONFIG_DIR", portable: "CraftAnythingData" },
};

/**
 * La carpeta fija de datos de la app (`<herramientas>/<app>-escritorio/datos`) y su variable de entorno.
 * La primera vez pasa ahí los datos que la app ya guardó junto al programa: los de la versión actual o,
 * si se actualizó antes de abrirla con este Geeper, los más recientes de otra versión instalada. Fuera
 * de Windows (o en una app sin datos portables) no hace nada.
 */
export function prepararDatos(
  app: string,
  o: { dirApp?: string; dirPrograma?: string; sistema?: typeof SISTEMA } = {},
): Record<string, string> {
  const d = DATOS_FIJOS[app];
  if (!d || (o.sistema ?? SISTEMA) !== "windows") return {};
  const base = o.dirApp ?? dirApp(app);
  const fija = path.join(base, "datos");
  const portable = existsSync(fija) ? null : datosPortables(base, path.join(o.dirPrograma ?? path.dirname(programa(app)), d.portable), d.portable);
  if (portable) {
    try {
      renameSync(portable, fija);
    } catch {
      // Otro disco o un archivo abierto: se copia y la carpeta vieja se deja de usar.
      cpSync(portable, fija, { recursive: true });
      try {
        rmSync(portable, { recursive: true, force: true });
      } catch {
        /* queda una copia vieja que ya nadie lee */
      }
    }
  }
  mkdirSync(fija, { recursive: true });
  return { [d.variable]: fija };
}

/** Los datos portables a pasar: los de la versión actual o los más recientes de otra (`<base>/<versión>/<carpeta>/`). */
function datosPortables(base: string, actual: string, nombre: string): string | null {
  if (existsSync(actual)) return actual;
  if (!existsSync(base)) return null;
  const otros: { ruta: string; t: number }[] = [];
  for (const v of readdirSync(base, { withFileTypes: true })) {
    if (!v.isDirectory() || v.name === "datos" || v.name.startsWith(".")) continue;
    for (const c of readdirSync(path.join(base, v.name), { withFileTypes: true })) {
      const ruta = path.join(base, v.name, c.name, nombre);
      if (c.isDirectory() && existsSync(ruta)) otros.push({ ruta, t: statSync(ruta).mtimeMs });
    }
  }
  return otros.sort((a, b) => b.t - a.t)[0]?.ruta ?? null;
}

/** Abre el programa en su propia ventana, sin atarlo a Geeper (sigue abierto si Geeper se cierra). */
export function abrirEscritorio(a: AppCraft): void {
  const p = programa(a.app);
  if (!existsSync(p)) throw new Error(`${a.nombre} no está instalada.`);
  const env = { ...process.env, ...prepararDatos(a.app) };
  const hijo = spawn(p, [], { cwd: dirDatos(), env, detached: true, stdio: "ignore", windowsHide: false });
  hijo.on("error", () => {});
  hijo.unref();
}
