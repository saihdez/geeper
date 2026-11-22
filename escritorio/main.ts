/**
 * Carcasa de escritorio de Geeper (Electron). No tiene lógica propia: arranca los mismos dos procesos
 * que `pnpm run dev:up` (el servidor de Next en modo standalone y el worker) con el Node de Electron
 * (ELECTRON_RUN_AS_NODE), les dice dónde viven los datos y las herramientas de este sistema, y abre una
 * ventana con la web en 127.0.0.1. Ver docs/ESCRITORIO.md.
 *
 * Estructura dentro de la app instalada (resources/app, sin asar: los hijos leen archivos reales):
 *   main.cjs, preparar-db.mjs, worker.mjs, vigia.mjs, esquema.sql
 *   standalone/            servidor de Next (server.js, .next, public)
 *   node_modules/          dependencias de los hijos (better-sqlite3 para Electron, hyperframes…)
 *   py/, docs/fuentes.json lo que lee el código en tiempo de ejecución
 *   recursos/ffmpeg/       ffmpeg y ffprobe de este sistema (verificados en el empaquetado)
 *   recursos/uv/           uv: crea los Python del estudio («Preparar el estudio», src/lib/estudio.ts)
 *   recursos/whisper/      whisper-cli (Windows: binario oficial; macOS: compilado en el empaquetado)
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { esVueltaOAuth } from "./oauth";
import { comoRematar, entornoHijos, esDeGeeper, paginaAbriendo, permitirReinicio, plantillaMenu, registrar, rotarRegistro } from "./reglas";

const RAIZ = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..", "escritorio-app");
const hijos: { nombre: string; p: ChildProcess }[] = [];
let ventana: BrowserWindow | null = null;
let saliendo = false;
/** Los hijos ya se detuvieron: `before-quit` deja cerrar la app. */
let cerrado = false;
let cerrando = false;
let url = "";
/** El servidor ya respondió: la ventana puede cargar Geeper. */
let listo = false;

const dirLogs = () => path.join(app.getPath("userData"), "logs");
/** Registro de un proceso, con cabecera de fecha y versión. Pasado de ~5 MB se guarda como .1 y empieza otro. */
function log(nombre: string): fs.WriteStream {
  fs.mkdirSync(dirLogs(), { recursive: true });
  const ruta = path.join(dirLogs(), `${nombre}.log`);
  rotarRegistro(ruta);
  const salida = fs.createWriteStream(ruta, { flags: "a" });
  // Un registro que no se puede escribir (disco lleno, permisos) no debe tumbar la app.
  salida.on("error", (e) => console.error(`registro ${nombre}: ${e.message}`));
  salida.write(`\n--- ${new Date().toISOString()} ${app.getVersion()} ---\n`);
  return salida;
}


/** Entorno de los hijos: dónde viven las cosas en este sistema (escritorio/reglas.ts, entornoHijos). */
function entorno(puerto: number): NodeJS.ProcessEnv {
  return entornoHijos(
    { raiz: RAIZ, documentos: app.getPath("documents"), appData: app.getPath("userData"), localAppData: process.env.LOCALAPPDATA, plataforma: process.platform, puerto },
    process.env,
  );
}

function lanzar(nombre: string, script: string, env: NodeJS.ProcessEnv, cwd = RAIZ): ChildProcess {
  // Por vigia.mjs, con la entrada estándar abierta: al cerrarla (salir de Geeper, o si la carcasa se cae)
  // el proceso se apaga en orden, también en Windows (ESC-11).
  const p = spawn(process.execPath, [path.join(RAIZ, "vigia.mjs"), script], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  p.stdin?.on("error", () => {
    /* el proceso ya terminó */
  });
  registrar(p, log(nombre));
  p.on("exit", () => {
    if (saliendo) return;
    if (nombre === "worker") {
      // Como dev-up: si el worker muere solo, se vuelve a lanzar (al arrancar marca lo interrumpido),
      // hasta 5 veces en 10 min. Si sigue cayendo, se avisa en vez de relanzarlo sin fin.
      if (!permitirReinicio(reiniciosWorker, Date.now())) {
        avisarWorkerCaido();
        return;
      }
      setTimeout(() => {
        if (saliendo) return;
        const nuevo = lanzar(nombre, script, env, cwd);
        const i = hijos.findIndex((h) => h.nombre === nombre);
        if (i >= 0) hijos[i] = { nombre, p: nuevo };
        else hijos.push({ nombre, p: nuevo });
      }, 3000);
    } else if (listo) {
      // El servidor se cerró con la app abierta. Si cae al arrancar, lo atiende el cuadro de arrancar().
      void preguntarTrasError("Geeper se detuvo", "Geeper dejó de funcionar de repente.", "Volver a abrir").then((que) => {
        if (que === "reintentar") app.relaunch();
        app.quit();
      });
    }
  });
  return p;
}

const reiniciosWorker: number[] = [];

/** El worker cayó 5 veces en 10 min: la web sigue abierta, pero los trabajos no avanzan. */
function avisarWorkerCaido(): void {
  const opciones = {
    type: "warning" as const,
    title: "Geeper no puede procesar trabajos",
    message: "Geeper no puede procesar trabajos.",
    detail: "Ciérralo y vuelve a abrirlo. Si vuelve a pasar, abre la carpeta de registros y mándasela a quien te ayuda.",
    buttons: ["Abrir la carpeta de registros", "Entendido"],
    defaultId: 1,
    cancelId: 1,
  };
  const r = ventana ? dialog.showMessageBox(ventana, opciones) : dialog.showMessageBox(opciones);
  void r.then(({ response }) => {
    if (response === 0) void shell.openPath(dirLogs());
  });
}

/**
 * Puerto en 127.0.0.1 (nunca expuesto a la red). Se prefiere 3300: es el que tienen registrado las apps
 * de OAuth de las redes (http://localhost:3300/api/cuentas/callback/<red>). Si está ocupado, uno libre.
 */
function puertoLibre(preferido = 3300): Promise<number> {
  const probar = (p: number) =>
    new Promise<number>((ok, mal) => {
      const s = net.createServer();
      s.unref();
      s.on("error", mal);
      s.listen(p, "127.0.0.1", () => {
        const a = s.address();
        s.close(() => (typeof a === "object" && a ? ok(a.port) : mal(new Error("sin puerto"))));
      });
    });
  return probar(preferido).catch(() => probar(0));
}

async function esperarServidor(u: string, ms = 60_000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const web = hijos.find((h) => h.nombre === "web")?.p;
    if (web && web.exitCode !== null) throw new Error("Geeper se cerró mientras arrancaba.");
    try {
      // Con tope: un pedido colgado no debe comerse el minuto de espera.
      const r = await fetch(`${u}/api/media`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Geeper tardó demasiado en arrancar.");
}

function correrHasta(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, [script], { cwd: RAIZ, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    registrar(p, log("preparar-db"));
    p.on("exit", (c) => (c === 0 ? ok() : mal(new Error("No se pudo preparar la base de datos de Geeper."))));
  });
}

async function arrancar(): Promise<void> {
  const puerto = await puertoLibre();
  url = `http://127.0.0.1:${puerto}`;
  // Otro programa (o un Geeper viejo) tiene el 3300: se usa otro, y queda anotado para quien ayude.
  if (puerto !== 3300) {
    fs.mkdirSync(dirLogs(), { recursive: true });
    fs.appendFileSync(path.join(dirLogs(), "web.log"), `\n--- ${new Date().toISOString()} el puerto 3300 estaba ocupado; se usa el ${puerto} ---\n`);
  }
  const env = entorno(puerto);
  // Crea o pone al día las tablas antes de que los dos procesos abran la base.
  await correrHasta(path.join(RAIZ, "preparar-db.mjs"), env);
  hijos.push({ nombre: "web", p: lanzar("web", path.join(RAIZ, "standalone", "server.js"), env, path.join(RAIZ, "standalone")) });
  hijos.push({ nombre: "worker", p: lanzar("worker", path.join(RAIZ, "worker.mjs"), env) });
  await esperarServidor(url);
}

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    title: "Geeper",
    backgroundColor: "#0b0d12",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  ventana.once("ready-to-show", () => ventana?.show());
  // Lo que sale de Geeper (GitHub, redes, «en otra pestaña») se abre en el navegador.
  ventana.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (esDeGeeper(url, destino) && !destino.includes("/craft/")) return { action: "allow" };
    if (/^https?:\/\//.test(destino)) void shell.openExternal(destino);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (e, destino) => {
    // «Conectar» una cuenta: el inicio de sesión de la red va en su propia ventana (ver abrirLogin).
    if (esDeGeeper(url, destino) && destino.startsWith(`${url}/api/cuentas/conectar/`)) {
      e.preventDefault();
      abrirLogin(destino);
      return;
    }
    if (!esDeGeeper(url, destino)) {
      e.preventDefault();
      if (/^https?:\/\//.test(destino)) void shell.openExternal(destino);
    }
  });
  // Mientras arranca el servidor, «Abriendo Geeper…»; al responder se carga la dirección (mostrarGeeper).
  void ventana.loadURL(url && listo ? url : paginaAbriendo());
  ventana.on("closed", () => (ventana = null));
}

/** El servidor ya responde: la ventana pasa de «Abriendo Geeper…» a Geeper. */
function mostrarGeeper(): void {
  listo = true;
  if (!ventana) crearVentana();
  else void ventana.loadURL(url);
}

/**
 * Inicio de sesión con una red (YouTube, TikTok, Meta) en una ventana de Geeper, con la misma sesión de
 * cookies que la principal: ahí vive la cookie firmada con el state y el verifier de PKCE que se validan
 * al volver. Si se abriera en el navegador del sistema, la vuelta llegaría sin esa cookie y fallaría.
 *
 * La red vuelve al redirect URI registrado (http://localhost:3300/…), pero la app corre en 127.0.0.1 y
 * quizá en otro puerto: esa vuelta se lleva a la dirección real de Geeper, con la misma ruta y parámetros.
 * Cuando Geeper termina y manda a /cuentas, la ventana se cierra y la principal muestra el resultado.
 */
function abrirLogin(inicio: string): void {
  const login = new BrowserWindow({
    parent: ventana ?? undefined,
    width: 560,
    height: 760,
    title: "Conectar cuenta",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const guiar = (e: { preventDefault: () => void }, destino: string) => {
    if (esVueltaOAuth(destino) && !esDeGeeper(url, destino)) {
      e.preventDefault();
      const u = new URL(destino);
      void login.loadURL(`${url}${u.pathname}${u.search}`);
      return;
    }
    if (esDeGeeper(url, destino)) {
      // Geeper ya procesó la vuelta (o devolvió un error): se muestra en la ventana principal.
      if (!new URL(destino).pathname.startsWith("/api/cuentas/")) {
        e.preventDefault();
        void ventana?.loadURL(destino);
        login.close();
      }
      return;
    }
    // Las páginas de inicio de sesión de las redes van siempre por https.
    if (!destino.startsWith("https://")) e.preventDefault();
  };
  login.webContents.on("will-navigate", guiar);
  login.webContents.on("will-redirect", guiar);
  login.webContents.setWindowOpenHandler(({ url: destino }) => {
    // Enlaces de ayuda o privacidad de la red: al navegador.
    if (destino.startsWith("https://")) void shell.openExternal(destino);
    return { action: "deny" };
  });
  void login.loadURL(inicio);
}

function menu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      plantillaMenu(process.platform === "darwin", {
        abrirProyectos: () => void shell.openPath(path.join(app.getPath("documents"), "Geeper")),
        abrirRegistros: () => void shell.openPath(dirLogs()),
        herramientasDesarrollo: () => ventana?.webContents.toggleDevTools(),
      }),
    ),
  );
}

/**
 * Cuadro de error con botones, en vez de una ruta que hay que buscar a mano. «Abrir la carpeta de
 * registros» no cierra el cuadro: lo vuelve a mostrar para que la persona elija qué hacer después.
 */
async function preguntarTrasError(titulo: string, detalle: string, reintentar: string): Promise<"reintentar" | "cerrar"> {
  for (;;) {
    const opciones = {
      type: "error" as const,
      title: titulo,
      message: titulo,
      detail: `${detalle}\n\nSi vuelve a pasar, abre la carpeta de registros y mándasela a quien te ayuda.`,
      buttons: [reintentar, "Abrir la carpeta de registros", "Cerrar"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    };
    const { response } = ventana && !ventana.isDestroyed() ? await dialog.showMessageBox(ventana, opciones) : await dialog.showMessageBox(opciones);
    if (response === 0) return "reintentar";
    if (response === 2) return "cerrar";
    await shell.openPath(dirLogs());
  }
}

/**
 * Detiene el servidor y el worker y espera a que salgan (hasta 6 s). Se les cierra la entrada estándar
 * (vigia.mjs lo toma como Ctrl+C: el worker marca lo que corría como interrumpido y suelta la GPU); al que
 * no salió a tiempo se lo remata, con sus hijos en Windows.
 */
async function detenerHijos(): Promise<void> {
  const vivos = hijos.splice(0).filter((h) => h.p.exitCode === null && h.p.signalCode === null);
  await Promise.all(
    vivos.map(
      (h) =>
        new Promise<void>((ok) => {
          const tope = setTimeout(() => {
            const r = comoRematar(process.platform, h.p.pid);
            if (r && "comando" in r) spawn(r.comando, r.args, { stdio: "ignore", windowsHide: true }).on("error", () => h.p.kill());
            else if (r) h.p.kill(r.senal);
            ok();
          }, 6000);
          h.p.once("exit", () => {
            clearTimeout(tope);
            ok();
          });
          h.p.stdin?.end();
        }),
    ),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });
  app.whenReady().then(async () => {
    menu();
    // La ventana sale ya, con «Abriendo Geeper…»: el arranque puede tardar varios segundos.
    crearVentana();
    for (;;) {
      try {
        await arrancar();
        mostrarGeeper();
        return;
      } catch (e) {
        console.error(e);
        saliendo = true; // que los procesos que se detienen ahora no avisen ni se relancen
        await detenerHijos();
        saliendo = false;
        reiniciosWorker.length = 0;
        const que = await preguntarTrasError("Geeper no pudo abrir", e instanceof Error ? e.message : String(e), "Volver a intentar");
        if (que === "cerrar") {
          app.quit();
          return;
        }
      }
    }
  });
  app.on("activate", () => {
    if (!ventana && listo) crearVentana();
  });
  app.on("window-all-closed", () => app.quit());
  // Antes de cerrar se espera a que el servidor y el worker terminen (ESC-11): cerrar sin esperar dejaba
  // el worker cortado en seco en Windows y los trabajos «corriendo» hasta 90 s al volver a abrir.
  app.on("before-quit", (e) => {
    if (cerrado) return;
    e.preventDefault();
    if (cerrando) return;
    cerrando = true;
    saliendo = true;
    void detenerHijos().finally(() => {
      cerrado = true;
      app.exit(0);
    });
  });
}
