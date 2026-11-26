/**
 * Instalador con un clic de una app Craft de storytold (el mismo procedimiento que
 * `instalar-photocraft.ts`, con la app como parámetro): baja el tarball oficial de Linux de la versión
 * fijada, verifica su SHA256 contra SHA256SUMS.txt de la misma release, lo descomprime en
 * ~/dev/video-tools/<app>/<versión> y apunta `actual` ahí. Una instalación a la vez por app.
 * Con `archivo`, `carpeta` y `extraer: "zip"` instala otro archivo de la release (p. ej. la versión
 * web, ver craft-web.ts) en ~/dev/video-tools/<carpeta>/<versión>.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { correr } from "./proceso";
import { archivoCraft, SISTEMA } from "./plataforma";
import { ESTUDIO } from "./rutas";

export interface EstadoInstalacion {
  fase: "inactiva" | "descargando" | "verificando" | "descomprimiendo" | "lista" | "error";
  progreso: number;
  detalle: string;
}

/** Suma esperada de `archivo`, leída de SHA256SUMS.txt (función pura). */
export function sumaEsperada(sumas: string, archivo: string): string | null {
  for (const linea of sumas.split("\n")) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(linea.trim());
    if (m && m[2]!.trim() === archivo) return m[1]!.toLowerCase();
  }
  return null;
}

export interface AppCraft {
  /** Nombre del repo y de la carpeta (p. ej. «vectorcraft»). */
  app: string;
  version: string;
  /** Devuelve la versión instalada o null (para comprobar que arranca). */
  verificar: () => Promise<string | null>;
  /** Archivo de la release (por defecto, el tarball de Linux x86_64). */
  archivo?: string;
  /** Carpeta dentro de ~/dev/video-tools (por defecto, `app`). */
  carpeta?: string;
  /**
   * Formato del archivo (por defecto, tar.gz). «tar-auto»: tar decide (.tar.xz; en Windows su tar también
   * abre .zip sin cargarlo entero en memoria). «dmg»: imagen de macOS (se monta y se copia lo de adentro).
   */
  extraer?: "tar" | "zip" | "tar-auto" | "dmg";
  /** Dónde está la release (por defecto, la de GitHub de storytold para esa versión). */
  base?: string;
  /** Archivo con las sumas SHA-256 dentro de `base` (por defecto, SHA256SUMS.txt). */
  sumas?: string;
  /** Carpeta de primer nivel dentro del archivo a la que apunta `actual` (por defecto, el nombre del tarball sin extensión). */
  raiz?: string;
  /** Ajustes después de descomprimir, sobre la carpeta a la que apuntará `actual`. */
  preparar?: (dir: string) => Promise<void>;
}

/**
 * Descarga con reintentos: GitHub a veces tarda en conectar con su servidor de archivos (Node corta con
 * «fetch failed») o corta a mitad («terminated»). Tres intentos con pausa creciente y, si no, curl, que
 * espera más. Un error de HTTP no se reintenta.
 */
export async function bajar(url: string, intentos = 3, espera = 2000): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      // Se baja entero aquí para que un corte a mitad de la descarga también se reintente.
      const r = await fetch(url);
      if (!r.ok) return r;
      const datos = Buffer.from(await r.arrayBuffer());
      return new Response(datos, { status: r.status, headers: { "content-length": String(datos.length) } });
    } catch (e) {
      if (i < intentos) {
        await new Promise((r) => setTimeout(r, espera * i));
        continue;
      }
      // El fetch de Node corta a los 10 s de intentar conectar; curl espera más. El archivo se sigue
      // verificando con su SHA256 después, igual que por fetch.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "geeper-bajar-"));
      try {
        const destino = path.join(tmp, "archivo");
        const r = await correr("curl", ["-fsSL", "--retry", "3", "--connect-timeout", "90", "--max-time", "1800", "-o", destino, url], { permitirFallo: true, timeout: 1_900_000 });
        if (r.codigo !== 0) throw new Error(`No se pudo conectar con GitHub (${e instanceof Error ? e.message : String(e)}). Revisa la conexión y vuelve a intentar.`);
        const datos = await fs.readFile(destino);
        return new Response(datos, { headers: { "content-length": String(datos.length) } });
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    }
  }
}

/**
 * Descomprime un zip sin depender de programas del sistema (no hay unzip ni python en todo Windows).
 * Rechaza rutas absolutas o con «..» (zip slip) y conserva el permiso de ejecución que trae el zip.
 */
export async function extraerZip(archivo: string, destino: string): Promise<void> {
  const { unzipSync } = await import("fflate");
  const datos = await fs.readFile(archivo);
  const raiz = path.resolve(destino);
  for (const [nombre, contenido] of Object.entries(unzipSync(new Uint8Array(datos)))) {
    const destinoArchivo = path.resolve(raiz, nombre);
    if (path.isAbsolute(nombre) || (destinoArchivo !== raiz && !destinoArchivo.startsWith(raiz + path.sep))) throw new Error(`El zip trae una ruta peligrosa: ${nombre}`);
    if (nombre.endsWith("/")) {
      await fs.mkdir(destinoArchivo, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(destinoArchivo), { recursive: true });
    await fs.writeFile(destinoArchivo, contenido);
  }
  if (SISTEMA !== "windows") await marcarEjecutables(raiz);
}

/** fflate no guarda los permisos: lo que parece un binario (sin extensión, en bin/ o *-cli) queda ejecutable. */
async function marcarEjecutables(dir: string): Promise<void> {
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    if (!path.extname(e.name) || /-cli$/.test(e.name) || path.basename(e.parentPath) === "bin") await fs.chmod(abs, 0o755);
  }
}

/** Cambia el enlace `actual` de forma atómica (un enlace temporal y rename). */
export async function apuntar(dir: string, actual: string, destino: string): Promise<void> {
  if (SISTEMA === "windows") {
    // Un enlace simbólico de carpeta pide permisos de administrador en Windows; un «junction», no. Y
    // rename no reemplaza un enlace existente ahí: se borra primero (sólo el enlace, no su destino).
    await fs.rm(actual, { force: true }).catch(() => fs.unlink(actual).catch(() => {}));
    await fs.symlink(destino, actual, "junction");
    return;
  }
  const enlaceTmp = path.join(dir, `.actual-${process.pid}`);
  await fs.rm(enlaceTmp, { force: true });
  await fs.symlink(destino, enlaceTmp);
  await fs.rename(enlaceTmp, actual);
}

/**
 * Carpeta del archivo que queda como `actual`. Cada app empaqueta distinto (el zip de Windows de
 * PhotoCraft trae los archivos sueltos; el de VectorCraft, dentro de una carpeta): si la esperada no
 * está, se usa la única carpeta de primer nivel, o la raíz si los archivos vienen sueltos.
 */
/** Copia lo que trae una imagen .dmg de macOS (montada sólo para leer) y la desmonta. */
async function copiarDeDmg(dmg: string, destino: string, montaje: string): Promise<void> {
  await fs.mkdir(montaje, { recursive: true });
  await correr("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", montaje, dmg], { timeout: 300_000 });
  try {
    for (const n of await fs.readdir(montaje)) {
      if (n.endsWith(".app")) await correr("cp", ["-R", path.join(montaje, n), destino], { timeout: 600_000 });
    }
  } finally {
    await correr("hdiutil", ["detach", montaje, "-force"], { permitirFallo: true, timeout: 120_000 });
  }
}

export async function carpetaRaiz(extraido: string, esperada: string): Promise<string> {
  if (esperada && (await fs.stat(path.join(extraido, esperada)).then((s) => s.isDirectory(), () => false))) return esperada;
  const entradas = await fs.readdir(extraido, { withFileTypes: true });
  return entradas.length === 1 && entradas[0]!.isDirectory() ? entradas[0]!.name : "";
}

export function crearInstalador(c: AppCraft) {
  const base = c.base ?? `https://github.com/storytold/${c.app}/releases/download/v${c.version}`;
  const sumas = c.sumas ?? "SHA256SUMS.txt";
  // Por defecto, el CLI de este sistema (plataforma.ts): tarball de Linux, zip portable de Windows o zip del CLI de macOS.
  const propio = archivoCraft(c.app, c.version);
  const tarball = c.archivo ?? propio.archivo;
  const raiz = c.raiz ?? propio.raiz;
  const extraer = c.extraer ?? (c.archivo ? "tar" : propio.extraer);
  const dir = path.resolve(ESTUDIO, c.carpeta ?? c.app);
  let estado: EstadoInstalacion = { fase: "inactiva", progreso: 0, detalle: "" };
  let enCurso: Promise<void> | null = null;

  async function instalar(): Promise<void> {
    // Windows (x64, o arm64 emulando) y macOS (universal) tienen su archivo; en Linux sólo hay x86_64.
    if (SISTEMA === "linux" && process.arch !== "x64") throw new Error("En Linux la instalación automática es sólo para x86_64.");
    const destino = path.join(dir, c.version);
    await fs.mkdir(dir, { recursive: true });
    const tmp = await fs.mkdtemp(path.join(dir, ".instalando-"));
    try {
      estado = { fase: "descargando", progreso: 0, detalle: "Buscando la versión verificada…" };
      const rs = await bajar(`${base}/${sumas}`);
      if (!rs.ok) throw new Error(`El servidor respondió ${rs.status} al pedir las sumas de verificación`);
      const esperada = sumaEsperada(await rs.text(), tarball);
      if (!esperada) throw new Error("La release no publica la suma de ese archivo");

      const r = await bajar(`${base}/${tarball}`);
      if (!r.ok || !r.body) throw new Error(`El servidor respondió ${r.status} al descargar`);
      const total = Number(r.headers.get("content-length")) || 0;
      const hash = createHash("sha256");
      let bajado = 0;
      const archivo = path.join(tmp, tarball);
      const cuerpo = Readable.fromWeb(r.body as import("node:stream/web").ReadableStream<Uint8Array>);
      cuerpo.on("data", (d: Buffer) => {
        hash.update(d);
        bajado += d.length;
        const mb = (n: number) => Math.round(n / 1e6);
        estado = { fase: "descargando", progreso: total ? bajado / total : 0, detalle: `Descargando ${mb(bajado)}${total ? ` de ${mb(total)}` : ""} MB…` };
      });
      await pipeline(cuerpo, createWriteStream(archivo));

      estado = { fase: "verificando", progreso: 1, detalle: "Verificando que el archivo sea el oficial…" };
      if (hash.digest("hex") !== esperada) throw new Error("El archivo descargado no coincide con la suma oficial: no se instaló (puede ser la red; prueba de nuevo)");

      estado = { fase: "descomprimiendo", progreso: 1, detalle: "Descomprimiendo…" };
      const extraido = path.join(tmp, "x");
      await fs.mkdir(extraido);
      // zipfile de Python descarta rutas absolutas y «..» al extraer.
      if (extraer === "zip") await extraerZip(archivo, extraido);
      else if (extraer === "tar-auto") await correr("tar", ["-xf", archivo, "-C", extraido], { timeout: 900_000 });
      else if (extraer === "dmg") await copiarDeDmg(archivo, extraido, path.join(tmp, "montaje"));
      // tar viene con Windows 10+ y macOS; en Linux siempre está.
      else await correr("tar", ["-xzf", archivo, "-C", extraido], { timeout: 300_000 });
      const raizReal = await carpetaRaiz(extraido, raiz);
      await c.preparar?.(path.join(extraido, raizReal));
      await fs.rm(destino, { recursive: true, force: true });
      await fs.rename(extraido, destino);
      const actual = path.join(dir, "actual");
      const nueva = path.join(destino, raizReal);
      // En Windows el «junction» se lee con barra final o con el prefijo \\?\: se compara normalizado.
      const leida = await fs.readlink(actual).catch(() => null);
      const anterior = leida && path.resolve(leida.replace(/^\\\\\?\\/, "")) !== path.resolve(nueva) ? leida : null;
      await apuntar(dir, actual, nueva);

      const v = await c.verificar().catch(() => null);
      if (!v?.includes(c.version)) {
        // La versión nueva no arranca: se vuelve a la que había (si había otra) y se avisa.
        if (anterior) await apuntar(dir, actual, anterior);
        throw new Error(anterior ? "La versión nueva no pasó la verificación: se dejó la anterior." : "Se instaló pero no arranca (no responde a --version).");
      }
      estado = { fase: "lista", progreso: 1, detalle: `Instalada: ${v}` };
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  return {
    estado: () => estado,
    /** Arranca la instalación (si no hay otra en curso) y vuelve enseguida. */
    iniciar(): EstadoInstalacion {
      if (!enCurso) {
        estado = { fase: "descargando", progreso: 0, detalle: "Empezando…" };
        enCurso = instalar()
          .catch((e: unknown) => {
            estado = { fase: "error", progreso: 0, detalle: e instanceof Error ? e.message : String(e) };
          })
          .finally(() => {
            enCurso = null;
          });
      }
      return estado;
    },
  };
}
