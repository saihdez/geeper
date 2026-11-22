/**
 * Empaqueta Geeper como app de escritorio para el sistema donde corre (Windows → instalador NSIS .exe,
 * macOS → .dmg, Linux → AppImage, sólo para probar). En CI lo corre .github/workflows/escritorio.yml en
 * una máquina de cada sistema. Ver docs/ESCRITORIO.md.
 *
 *   pnpm tsx scripts/escritorio/empaquetar.ts            todo: build + preparación + instalador
 *   pnpm tsx scripts/escritorio/empaquetar.ts --sin-instalador   deja escritorio-app/ lista (para probar con electron)
 *
 * Pasos: next build (standalone) → bundles con esbuild (carcasa, worker, preparar-db) → carpeta
 * escritorio-app/ con node_modules plano (npm) → better-sqlite3 recompilado para Electron → esquema.sql,
 * py/, docs/fuentes.json → ffmpeg, uv y whisper de este sistema verificados (SHA-256 o commit) → electron-builder.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { unzipSync } from "fflate";
import { electronDelRepo, probarApp } from "./probar-app";
import { copiarStandalone, faltantesApp, podarNodeModules, revisarStandalone, tamanoCarpeta } from "./armado";

const REPO = path.resolve(__dirname, "..", "..");
const APP = path.join(REPO, "escritorio-app");
const ELECTRON = JSON.parse(fs.readFileSync(path.join(REPO, "node_modules", "electron", "package.json"), "utf8")).version as string;
const raiz = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
const sinInstalador = process.argv.includes("--sin-instalador");
const plataforma = `${process.platform}-${process.arch}`;

const win = process.platform === "win32";
function correr(cmd: string, args: string[], op: { cwd?: string; env?: Record<string, string> } = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  // En Windows npm/npx/pnpm son .cmd: hace falta la shell para encontrarlos.
  execFileSync(cmd, args, { cwd: op.cwd ?? REPO, env: { ...process.env, ...op.env }, stdio: "inherit", shell: win });
}
const copiar = (de: string, a: string) => fs.cpSync(de, a, { recursive: true, dereference: true });

async function bajarVerificado(url: string, sha256: string): Promise<Buffer> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
      const datos = Buffer.from(await r.arrayBuffer());
      const suma = createHash("sha256").update(datos).digest("hex");
      if (suma !== sha256) throw new Error(`${url}: SHA-256 ${suma}, se esperaba ${sha256}. No se empaqueta.`);
      return datos;
    } catch (e) {
      if (i >= 3 || String(e).includes("SHA-256")) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

interface Archivo { url: string; sha256: string; sacar: Record<string, string> }
interface Compilar { repo: string; tag: string; commit: string; cmake: string[]; objetivo: string; sacar: Record<string, string> }
interface Recurso { version: string; archivos?: Archivo[]; copiarDe?: string[]; compilar?: Compilar }

/** Contenido de un .zip o .tar.gz como {ruta: bytes}. El .tar.gz se abre con el `tar` del sistema (macOS y Windows lo traen). */
function abrir(url: string, datos: Buffer): Record<string, Uint8Array> {
  if (url.endsWith(".zip")) return unzipSync(new Uint8Array(datos));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-recurso-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.tar.gz"), datos);
    fs.mkdirSync(path.join(tmp, "x"));
    execFileSync("tar", ["-xzf", path.join(tmp, "a.tar.gz"), "-C", path.join(tmp, "x")]);
    const salida: Record<string, Uint8Array> = {};
    for (const e of fs.readdirSync(path.join(tmp, "x"), { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      const abs = path.join(e.parentPath, e.name);
      salida[path.relative(path.join(tmp, "x"), abs).split(path.sep).join("/")] = fs.readFileSync(abs);
    }
    return salida;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Compila un programa desde un tag fijado, comprobando que el tag apunte al commit esperado. */
function compilar(c: Compilar, destino: string) {
  const fuente = fs.mkdtempSync(path.join(os.tmpdir(), "geeper-compilar-"));
  try {
    correr("git", ["clone", "--depth", "1", "--branch", c.tag, c.repo, fuente]);
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fuente, encoding: "utf8" }).trim();
    if (commit !== c.commit) throw new Error(`${c.repo} ${c.tag} apunta a ${commit}, se esperaba ${c.commit}. No se empaqueta.`);
    correr("cmake", ["-B", "build", ...c.cmake], { cwd: fuente });
    correr("cmake", ["--build", "build", "--config", "Release", "--target", c.objetivo, "-j"], { cwd: fuente });
    for (const [dentro, nombre] of Object.entries(c.sacar)) fs.copyFileSync(path.join(fuente, dentro), path.join(destino, nombre));
  } finally {
    fs.rmSync(fuente, { recursive: true, force: true });
  }
}

/**
 * Programas de este sistema en escritorio-app/recursos/<programa>/ (escritorio/recursos.json): ffmpeg y
 * ffprobe, uv (crea los Python del estudio sin que haga falta instalar Python) y whisper-cli.
 */
async function recursos() {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(REPO, "escritorio", "recursos.json"), "utf8")) as Record<string, Record<string, Recurso> | string>;
  for (const [programa, porSistema] of Object.entries(manifiesto)) {
    if (typeof porSistema === "string") continue; // $comentario
    const m = porSistema[plataforma];
    if (!m) throw new Error(`No hay ${programa} fijado para ${plataforma} en escritorio/recursos.json`);
    if (!m.archivos && !m.copiarDe && !m.compilar) {
      console.log(`${programa}: ${m.version}`);
      continue;
    }
    const destino = path.join(APP, "recursos", programa);
    fs.mkdirSync(destino, { recursive: true });
    for (const de of m.copiarDe ?? []) {
      const abs = de.replace(/^~/, os.homedir());
      fs.copyFileSync(abs, path.join(destino, path.basename(abs)));
    }
    for (const a of m.archivos ?? []) {
      console.log(`Bajando ${a.url}`);
      const contenido = abrir(a.url, await bajarVerificado(a.url, a.sha256));
      for (const [dentro, nombre] of Object.entries(a.sacar)) {
        const bytes = contenido[dentro];
        if (!bytes) throw new Error(`${a.url} no trae ${dentro}`);
        fs.writeFileSync(path.join(destino, nombre), bytes);
      }
    }
    if (m.compilar) compilar(m.compilar, destino);
    if (!win) for (const f of fs.readdirSync(destino)) fs.chmodSync(path.join(destino, f), 0o755);
    console.log(`${programa} ${m.version}: ${fs.readdirSync(destino).join(", ")}`);
  }
}

/** Bundles de la carcasa (CJS, la carga Electron) y de los procesos hijos (ESM, los corre su Node). */
async function bundles() {
  const comun = { bundle: true, platform: "node" as const, target: "node22", sourcemap: true, logLevel: "warning" as const, alias: { "@": path.join(REPO, "src") } };
  await build({ ...comun, entryPoints: [path.join(REPO, "escritorio", "main.ts")], outfile: path.join(APP, "main.cjs"), format: "cjs", external: ["electron"] });
  // ESM: el cliente de Prisma generado usa import.meta. `require` para las dependencias CJS empaquetadas.
  const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
  for (const [entrada, salida] of [["worker/index.ts", "worker.mjs"], ["escritorio/preparar-db.ts", "preparar-db.mjs"]] as const) {
    await build({ ...comun, entryPoints: [path.join(REPO, entrada)], outfile: path.join(APP, salida), format: "esm", banner, external: ["better-sqlite3"] });
  }
  // Arranca el servidor y el worker y los apaga en orden cuando la carcasa cierra (escritorio/main.ts).
  fs.copyFileSync(path.join(REPO, "escritorio", "vigia.mjs"), path.join(APP, "vigia.mjs"));
}

async function main() {
  console.log(`Geeper ${raiz.version} para ${plataforma} (Electron ${ELECTRON})`);
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });

  // 1. Next standalone.
  correr("pnpm", ["exec", "next", "build"], { env: { GEEPER_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } });
  const standalone = path.join(APP, "standalone");
  const dist = path.join(REPO, ".next-escritorio");
  // Sólo server.js, package.json y .next-escritorio: el standalone arrastra la raíz del repo (ESC-15).
  copiarStandalone(path.join(dist, "standalone"), standalone);
  copiar(path.join(dist, "static"), path.join(standalone, ".next-escritorio", "static"));
  if (fs.existsSync(path.join(REPO, "public"))) copiar(path.join(REPO, "public"), path.join(standalone, "public"));
  revisarStandalone(standalone);

  // 2. Bundles.
  await bundles();

  // 3. node_modules plano (npm, sin los enlaces de pnpm, que no sobreviven al instalador) con las
  //    versiones exactas que usa el servidor, más Hyperframes (se corre como CLI). better-sqlite3 es la
  //    versión del adaptador de Prisma: un solo módulo nativo, recompilado para Electron.
  const real = (paquete: string) => fs.realpathSync(path.join(REPO, "node_modules", paquete));
  const versionDe = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version as string;
  const adaptador = real("@prisma/adapter-better-sqlite3");
  const deps: Record<string, string> = {
    next: versionDe(real("next")),
    react: versionDe(real("react")),
    "react-dom": versionDe(real("react-dom")),
    "@prisma/client": versionDe(real("@prisma/client")),
    "@prisma/adapter-better-sqlite3": versionDe(adaptador),
    "better-sqlite3": versionDe(path.join(adaptador, "..", "..", "better-sqlite3")),
    hyperframes: process.env.GEEPER_HYPERFRAMES_VERSION ?? "0.9.27",
  };
  // Turbopack pide algunos paquetes con un nombre con hash (p. ej. @prisma/client-ad5a…), que en el build
  // son enlaces en .next-escritorio/node_modules. electron-builder descarta todo node_modules que no esté
  // en la raíz de la app, así que se declaran como alias de npm (`npm:@prisma/client@7.10.1`): npm los
  // instala en escritorio-app/node_modules, y el servidor los encuentra subiendo carpetas.
  const aliasDe = (dir: string): string[] =>
    !fs.existsSync(dir) ? [] : fs.readdirSync(dir).flatMap((n) => (n.startsWith("@") ? fs.readdirSync(path.join(dir, n)).map((m) => `${n}/${m}`) : [n]));
  for (const nombreAlias of aliasDe(path.join(dist, "standalone", ".next-escritorio", "node_modules"))) {
    const destino = fs.realpathSync(path.join(dist, "standalone", ".next-escritorio", "node_modules", nombreAlias));
    const pkg = JSON.parse(fs.readFileSync(path.join(destino, "package.json"), "utf8")) as { name: string; version: string };
    deps[nombreAlias] = `npm:${pkg.name}@${pkg.version}`;
    console.log(`alias ${nombreAlias} → ${deps[nombreAlias]}`);
  }
  fs.writeFileSync(path.join(APP, "package.json"), JSON.stringify({
    name: "geeper", productName: "Geeper", version: raiz.version, private: true, main: "main.cjs",
    description: "Estudio de video local de Dimerso", author: "Dimerso", dependencies: deps,
  }, null, 2));
  // --legacy-peer-deps: @prisma/client pide `prisma` (la CLI con sus motores) como par; en la app no hace falta.
  correr("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--legacy-peer-deps"], { cwd: APP });
  correr("pnpm", ["exec", "electron-rebuild", "--version", ELECTRON, "--module-dir", APP, "--only", "better-sqlite3", "--force"]);
  // Lo que no se usa al correr (compilador de Next, sharp, Prisma de otras bases, fuentes de SQLite): ESC-04.
  const nm = path.join(APP, "node_modules");
  const antes = tamanoCarpeta(nm);
  const podado = podarNodeModules(nm);
  console.log(`node_modules: ${((antes - tamanoCarpeta(nm)) / 1048576).toFixed(0)} MB menos (${podado.length} entradas borradas)`);
  if (!fs.existsSync(path.join(nm, "better-sqlite3", "build", "Release", "better_sqlite3.node"))) throw new Error("Falta better_sqlite3.node en la app tras la poda.");

  // El servidor resuelve sus paquetes subiendo hasta escritorio-app/node_modules: su propio node_modules
  // (con enlaces absolutos de pnpm) sobra. Y no puede quedar ningún node_modules fuera de la raíz: el
  // instalador no lo llevaría (así se perdió @prisma/client-… en la primera prueba en Windows).
  fs.rmSync(path.join(standalone, "node_modules"), { recursive: true, force: true });
  const anidados = fs
    .readdirSync(APP, { recursive: true, withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name === "node_modules" && !path.join(e.parentPath, e.name).startsWith(path.join(APP, "node_modules")));
  if (anidados.length) throw new Error(`Hay node_modules fuera de la raíz de la app (el instalador no los lleva): ${anidados.map((e) => e.parentPath).join(", ")}`);
  const quedan = fs.readdirSync(APP, { recursive: true, withFileTypes: true }).filter((e) => e.isSymbolicLink() && !e.parentPath.includes(`${path.sep}node_modules${path.sep}.bin`));
  if (quedan.length) throw new Error(`Quedaron enlaces simbólicos en la app (no viajan en el instalador): ${quedan.slice(0, 5).map((e) => path.join(e.parentPath, e.name)).join(", ")}`);
  // La vista previa copia este archivo en tiempo de ejecución (vista-previa.ts): sin él, no hay vista previa.
  if (!fs.existsSync(path.join(APP, "node_modules", "hyperframes", "dist", "hyperframe.runtime.iife.js"))) throw new Error("Falta hyperframes/dist/hyperframe.runtime.iife.js en la app (la vista previa lo necesita).");

  // 4. Lo que el código lee en tiempo de ejecución (RAIZ_REPO = la carpeta de la app).
  const esquema = execFileSync(win ? "npx.cmd" : "npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], { cwd: REPO, encoding: "utf8", shell: win });
  fs.writeFileSync(path.join(APP, "esquema.sql"), esquema.slice(esquema.indexOf("--")));
  copiar(path.join(REPO, "py"), path.join(APP, "py"));
  fs.rmSync(path.join(APP, "py", "__pycache__"), { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, "docs"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "docs", "fuentes.json"), path.join(APP, "docs", "fuentes.json"));

  // 5. Programas de este sistema (ffmpeg, uv, whisper).
  await recursos();

  // Lo que se lee en tiempo de ejecución tiene que estar: si no, se vería en el equipo de alguien.
  const falta = faltantesApp(APP);
  if (falta.length) throw new Error(`A la app le falta lo que necesita al correr: ${falta.join(", ")}`);
  // Se abre la app armada una vez (con el Node de Electron) antes de hacer el instalador: ESC-12.
  if (process.env.GEEPER_SIN_PRUEBA !== "1") {
    const fallas = await probarApp({ app: APP, ejecutable: electronDelRepo() });
    if (fallas.length) throw new Error(`La app armada no funciona; no se hace el instalador:\n  ${fallas.join("\n  ")}`);
  }

  if (sinInstalador) {
    console.log(`Lista: ${APP}\nProbar: pnpm exec electron ${APP}`);
    return;
  }
  // 6. Instalador.
  correr("pnpm", ["exec", "electron-builder", "--config", path.join(REPO, "escritorio", "electron-builder.yml"), "--projectDir", APP, "--publish", "never",
    // La app no trae electron en su node_modules (lo pone electron-builder): se le dice la versión.
    `-c.electronVersion=${ELECTRON}`,
    // Para probar en una red lenta: usar el Electron ya instalado en vez de bajarlo otra vez.
    ...(process.env.GEEPER_ELECTRON_DIST ? [`-c.electronDist=${process.env.GEEPER_ELECTRON_DIST}`] : [])], {
    env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  console.log(`Instalador en ${path.join(REPO, "dist-escritorio")}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
