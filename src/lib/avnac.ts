/**
 * Avnac Studio (github.com/striker561/Avnac-Studio, GPL-3.0) en Media: editor de diseño para portadas,
 * pósters y piezas para redes. No tiene versión para el navegador, así que Geeper instala su programa
 * oficial de la versión fijada, verificado con la suma SHA-256 fijada aquí, y lo abre en su propia
 * ventana. Es un programa aparte: Geeper no incluye ni modifica su código (ver docs/HEREDADO.md).
 *
 * - Linux (y WSL): un ejecutable suelto en <herramientas>/avnac-studio/<versión>. Necesita WebKitGTK 4.1
 *   del sistema; si falta, se avisa con el comando exacto (hace falta sudo, lo corre la persona).
 * - Windows: su instalador oficial, en silencio y en <herramientas>\avnac-studio (Windows pide permiso
 *   de administrador una vez). Instala también WebView2 si falta.
 * - macOS: sólo publica un .dmg; queda el enlace de descarga.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256Archivo } from "./archivos";
import { apuntar, bajar, estadoDescarga, type EstadoInstalacion } from "./instalar-craft";
import { SISTEMA } from "./plataforma";
import { correr } from "./proceso";
import { dirDatos, ESTUDIO } from "./rutas";

export const AVNAC = {
  id: "avnac",
  nombre: "Avnac Studio",
  version: "0.4.1",
  repo: "striker561/Avnac-Studio",
  /** Sumas de la release v0.4.1 (las mismas de su SHA256SUMS.txt y de GitHub). */
  archivos: {
    linux: { nombre: "avnac-studio-linux-amd64", sha256: "976b2ac994609b9cb0d349e7e8e22a292a0ff8520f6f6a89780b9abdedaecfce", mb: 16 },
    windows: { nombre: "avnac-studio-windows-amd64-installer.exe", sha256: "a8549412a644bf19f94db0aa8143fc9d6f99d620c8e65c145ce7aac1b251b0a3", mb: 9 },
    macArm: { nombre: "avnac-studio-macos-arm64.dmg", sha256: "410d6b7a1b4f2ce03c881f21ce2527ba15d91db678f4f2288d9ea187a036fcdd", mb: 7 },
    macIntel: { nombre: "avnac-studio-macos-amd64.dmg", sha256: "11053e4ce3b55901c839224d1799a9df40f8323e7bf59fc15ec9f6df3c2ac39a", mb: 7 },
  },
} as const;

export const paginaAvnac = `https://github.com/${AVNAC.repo}/releases/tag/v${AVNAC.version}`;
const base = `https://github.com/${AVNAC.repo}/releases/download/v${AVNAC.version}`;

/** Geeper lo instala y lo abre solo (Windows y Linux x64); en macOS queda la descarga. */
export const AVNAC_INSTALABLE = SISTEMA === "windows" || (SISTEMA === "linux" && process.arch === "x64");

/** Lo que se baja en este sistema (función pura). */
export function archivoAvnac(sistema: string = SISTEMA, arch: string = process.arch) {
  if (sistema === "windows") return AVNAC.archivos.windows;
  if (sistema === "mac") return arch === "arm64" ? AVNAC.archivos.macArm : AVNAC.archivos.macIntel;
  return AVNAC.archivos.linux;
}

/** Enlace directo de descarga para este sistema. */
export const descargaAvnac = () => `${base}/${archivoAvnac().nombre}`;

const dir = () => path.join(ESTUDIO, "avnac-studio");
/** El programa: en Linux, el ejecutable de la versión actual; en Windows, el que deja su instalador. */
export const programaAvnac = () => (SISTEMA === "windows" ? path.join(dir(), "Avnac.exe") : path.join(dir(), "actual", "avnac-studio"));
/** Versión instalada, escrita por Geeper al terminar (el programa no tiene `--version`). */
const marca = () => path.join(dir(), "version.txt");

/** Librerías del sistema que faltan según `ldd` (función pura). */
export function libreriasQueFaltan(salidaLdd: string): string[] {
  return [...salidaLdd.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map((m) => m[1]!);
}

/** Comando para instalar lo que falta en Debian/Ubuntu (función pura). */
export function comandoLibrerias(faltan: string[]): string | null {
  if (!faltan.length) return null;
  const paquetes = new Set<string>();
  for (const l of faltan) {
    if (/webkit2gtk-4\.1|javascriptcoregtk-4\.1/.test(l)) paquetes.add("libwebkit2gtk-4.1-0");
    else if (/gtk-3/.test(l)) paquetes.add("libgtk-3-0");
  }
  return paquetes.size ? `sudo apt install -y ${[...paquetes].join(" ")}` : null;
}

export interface EstadoAvnac {
  /** «Avnac Studio 0.4.1» o null. */
  instalada: string | null;
  /** En Linux: el comando que tiene que correr la persona para que abra (falta una librería del sistema). */
  falta: string | null;
}

export async function estadoAvnac(): Promise<EstadoAvnac> {
  if (!AVNAC_INSTALABLE || !existsSync(programaAvnac())) return { instalada: null, falta: null };
  const v = (await fs.readFile(marca(), "utf8").catch(() => "")).trim();
  if (!v) return { instalada: null, falta: null };
  let falta: string | null = null;
  if (SISTEMA === "linux") {
    const r = await correr("ldd", [programaAvnac()], { permitirFallo: true, timeout: 20_000 }).catch(() => null);
    falta = r ? comandoLibrerias(libreriasQueFaltan(r.stdout)) : null;
  }
  return { instalada: `${AVNAC.nombre} ${v}`, falta };
}

const g = globalThis as unknown as { __avnac?: { estado: EstadoInstalacion; enCurso: Promise<void> | null } };
const est = () => (g.__avnac ??= { estado: { fase: "inactiva", progreso: 0, detalle: "" }, enCurso: null });

export const instalacionAvnac = (): EstadoInstalacion | null => (AVNAC_INSTALABLE ? est().estado : null);

async function instalar(): Promise<void> {
  const s = est();
  const a = archivoAvnac();
  await fs.mkdir(dir(), { recursive: true });
  const tmp = await fs.mkdtemp(path.join(dir(), ".instalando-"));
  try {
    s.estado = { fase: "descargando", progreso: 0, detalle: "Empezando…" };
    const r = await bajar(`${base}/${a.nombre}`, 3, 2000, (bajado, total) => {
      s.estado = estadoDescarga(bajado, total);
    });
    if (!r.ok) throw new Error(`GitHub respondió ${r.status} al bajar ${AVNAC.nombre}`);
    const archivo = path.join(tmp, a.nombre);
    await fs.writeFile(archivo, new Uint8Array(await r.arrayBuffer()));
    s.estado = { fase: "verificando", progreso: 1, detalle: "Verificando que el archivo sea el oficial…" };
    if ((await sha256Archivo(archivo)) !== a.sha256) throw new Error("El archivo bajado no es el oficial (la suma no coincide). No se instaló.");

    s.estado = { fase: "descomprimiendo", progreso: 1, detalle: SISTEMA === "windows" ? "Instalando… Windows te va a pedir permiso: dale «Sí»." : "Instalando…" };
    if (SISTEMA === "windows") {
      // Su instalador pide administrador: Start-Process -Verb RunAs muestra el permiso de Windows. /S sin
      // ventanas y /D (siempre al final, sin comillas) elige la carpeta, así Geeper sabe dónde quedó.
      const ps = `$p = Start-Process -FilePath '${archivo.replace(/'/g, "''")}' -ArgumentList '/S','/D=${dir().replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
      const r2 = await correr("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { permitirFallo: true, timeout: 600_000 });
      if (r2.codigo !== 0 || !existsSync(programaAvnac())) throw new Error("No se terminó de instalar. Si Windows pidió permiso, hay que darle «Sí»; vuelve a intentar.");
    } else {
      const destino = path.join(dir(), AVNAC.version);
      await fs.rm(destino, { recursive: true, force: true });
      await fs.mkdir(destino, { recursive: true });
      await fs.rename(archivo, path.join(destino, "avnac-studio"));
      await fs.chmod(path.join(destino, "avnac-studio"), 0o755);
      await apuntar(dir(), path.join(dir(), "actual"), destino);
    }
    await fs.writeFile(marca(), AVNAC.version);
    const e = await estadoAvnac();
    s.estado = { fase: "lista", progreso: 1, detalle: e.falta ? "Instalada; falta un paso para que abra." : `Instalada: ${e.instalada}` };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Empieza a instalar (vuelve enseguida; el avance sale en `instalacionAvnac`). Una a la vez. */
export function instalarAvnac(): EstadoInstalacion {
  if (!AVNAC_INSTALABLE) throw new Error(`${AVNAC.nombre} se instala desde su página en este sistema.`);
  const s = est();
  if (!s.enCurso) {
    s.estado = { fase: "descargando", progreso: 0, detalle: "Empezando…" };
    s.enCurso = instalar()
      .catch((e) => {
        s.estado = { fase: "error", progreso: 0, detalle: e instanceof Error ? e.message : String(e) };
      })
      .finally(() => {
        s.enCurso = null;
      });
  }
  return s.estado;
}

/** Abre Avnac Studio en su propia ventana, sin atarlo a Geeper (sigue abierto si Geeper se cierra). */
export async function abrirAvnac(): Promise<void> {
  const e = await estadoAvnac();
  if (!e.instalada) throw new Error(`${AVNAC.nombre} no está instalada.`);
  if (e.falta) throw new Error(`Para abrirla falta un paso en esta computadora. Corre esto en una terminal y vuelve a intentar: ${e.falta}`);
  const hijo = spawn(programaAvnac(), [], { cwd: dirDatos(), detached: true, stdio: "ignore", windowsHide: false });
  hijo.on("error", () => {});
  hijo.unref();
}
