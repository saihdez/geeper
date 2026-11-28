/**
 * Toma y render de la demo de producto (ver demo-web.ts). Lo usan `scripts/demo-web.ts` y el trabajo
 * «demo.crear» del worker. Chromium headless + screencast de CDP; el tratamiento es Hyperframes.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import {
  acentoDe,
  componerDemo,
  elegirCta,
  fpsDominante,
  gradienteMarca,
  leerRgb,
  planDemo,
  registroDeGrabacion,
  revisarPagina,
  type Candidato,
  type EstiloDemo,
  type FormatoDemo,
  type Historia,
  type Montaje,
  type RegistroDemo,
} from "./demo-web";
import { gsapParaProyecto } from "./gsap-local";
import { correrHf } from "./hyperframes";
import { ffmpeg, fotograma, probar } from "./media";
import type { Registro } from "./proceso";
import { abrirNavegador, rutaChrome } from "./navegador";

const espera = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, mal) => {
    if (signal?.aborted) return mal(new Error("Cancelado"));
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      mal(new Error("Cancelado"));
    }, { once: true });
  });

/** Códigos de red con los que el link no puede abrir (mal escrito, el sitio no existe o no contesta). */
const SIN_SITIO = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ERR_INVALID_URL"]);

/** Mensaje simple cuando la página no abre; el detalle técnico va aparte (registro del trabajo). */
export const noAbre = (url: string) => `No se pudo abrir ${url}: revisa que el link esté bien escrito y que la página abra en tu navegador.`;

/**
 * Prueba en hasta 10 s que el link abre, antes de hacer la voz (UX-17): un link mal escrito se
 * descubre en segundos y no después de esperar la voz. Sólo corta si el sitio no existe o no contesta;
 * si responde con error (muchos sitios rechazan a los robots) o tarda, avisa en el registro y sigue:
 * la grabación con el navegador puede funcionar igual.
 */
export async function probarLink(
  url: string,
  op: { log?: Registro; signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<void> {
  const log = op.log ?? (() => {});
  const plazo = AbortSignal.timeout(op.timeoutMs ?? 10_000);
  const signal = op.signal ? AbortSignal.any([op.signal, plazo]) : plazo;
  try {
    const r = await (op.fetch ?? fetch)(url, { method: "GET", redirect: "follow", signal, headers: { accept: "text/html,*/*" } });
    await r.body?.cancel().catch(() => {});
    if (!r.ok) log(`Aviso: la página respondió ${r.status}; se intenta grabar igual (algunos sitios rechazan a los robots).`);
  } catch (e) {
    if (op.signal?.aborted) throw new Error("Cancelado");
    const err = e as Error & { cause?: { code?: string; message?: string }; code?: string };
    const codigo = err.cause?.code ?? err.code;
    const detalle = [err.message, err.cause?.message].filter(Boolean).join(": ");
    if (plazo.aborted || err.name === "TimeoutError") {
      log(`Aviso: la página tardó más de ${Math.round((op.timeoutMs ?? 10_000) / 1000)} s en contestar; se intenta grabar igual.`);
      return;
    }
    if (codigo && SIN_SITIO.has(codigo)) {
      log(`Detalle técnico: ${detalle}`);
      throw new Error(noAbre(url));
    }
    // Otro error (certificado, protocolo…): se avisa y el navegador lo intenta igual.
    log(`Aviso: no se pudo probar el link (${detalle}); se intenta grabar igual.`);
  }
}

export interface OpcionesToma {
  formato: FormatoDemo;
  historia?: Historia;
  /** Segundos mínimos de grabación: si el recorrido termina antes, sigue bajando por la página. */
  duracionMin?: number;
  log?: Registro;
  signal?: AbortSignal;
}

/** Toma: abre la página, elige la historia, la recorre con el cursor virtual y deja `<dir>/toma.mp4`. */
export async function tomarDemo(url: string, dir: string, op: OpcionesToma): Promise<RegistroDemo> {
  const log = op.log ?? (() => {});
  const signal = op.signal;
  const dormir = (ms: number) => espera(ms, signal);
  const movil = op.formato === "9:16";
  const vista = movil ? { width: 412, height: 892 } : { width: 1280, height: 800 };
  const escala = movil ? 2.5 : 1.5;
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("Esta instalación no trae el navegador para grabar páginas (playwright-core). En la versión de desarrollo sí funciona.");
  }
  const dirCuadros = path.join(dir, "cuadros");
  await fsp.rm(dirCuadros, { recursive: true, force: true });
  await fsp.mkdir(dirCuadros, { recursive: true });
  // Sin la bandera, el screencast del Chrome headless sale en píxeles CSS (1280 de ancho) y la tarjeta
  // se reescala borrosa; con ella, a la escala pedida (medido: 1280 → 1920).
  const nav = await abrirNavegador(() => pw.chromium.launch({ executablePath: rutaChrome(), args: [`--force-device-scale-factor=${escala}`] }));
  const cerrar = () => void nav.close().catch(() => {});
  signal?.addEventListener("abort", cerrar, { once: true });
  try {
    const ctx = await nav.newContext({ viewport: vista, deviceScaleFactor: escala, isMobile: movil, hasTouch: movil, locale: "es-MX", colorScheme: "light" });
    // tsx (esbuild con keepNames) envuelve las funciones en __name(); en la página no existe.
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    const page = await ctx.newPage();
    let estado: number | null = null;
    try {
      estado = (await page.goto(url, { waitUntil: "load", timeout: 60_000 }))?.status() ?? null;
    } catch (e) {
      // «(page.goto: net::ERR_NAME_NOT_RESOLVED at …)» sólo en el registro, no en el mensaje (UX-17).
      log(`Detalle técnico: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      throw new Error(noAbre(url));
    }
    await dormir(2600);

    // Fuera los avisos de cookies antes de grabar.
    await page
      .evaluate(() => {
        const re = /^(aceptar|aceptar todo|aceptar todas|acepto|de acuerdo|entendido|vale|ok|rechazar|rechazar todo|cerrar|accept|accept all|allow all|agree|i agree|got it|reject all|decline|dismiss|close)$/i;
        for (const el of document.querySelectorAll("button, a, [role=button]")) {
          if (re.test((el.textContent || "").trim())) (el as HTMLElement).click?.();
        }
      })
      .catch(() => {});
    await dormir(400);

    // Una página de error o en blanco no se graba (ver `revisarPagina`).
    const medida = await page
      .evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 8 && r.height > 8 && s.visibility !== "hidden" && s.display !== "none";
        };
        const imagenes = [...document.images].filter(visible);
        const otros = [...document.querySelectorAll("video, canvas, svg")].filter(visible).length;
        return {
          texto: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().length,
          medios: imagenes.filter((i) => i.complete && i.naturalWidth > 0).length + otros,
          rotas: imagenes.filter((i) => i.complete && i.naturalWidth === 0 && !!i.currentSrc).length,
        };
      })
      .catch(() => null);
    if (medida) {
      const salud = revisarPagina({ estado, ...medida });
      salud.avisos.forEach((a) => log(a));
      if (salud.error) {
        log(`Detalle técnico: estado ${estado ?? "-"}, ${medida.texto} caracteres, ${medida.medios} imágenes o videos, ${medida.rotas} rotas.`);
        throw new Error(salud.error);
      }
    }

    // Exploración: titular, candidatos a botón y colores.
    const sc = await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 8 && r.height > 8 && s.visibility !== "hidden" && s.display !== "none" && r.y < innerHeight * 1.1;
      };
      const heroe = [...document.querySelectorAll("h1")].find(vis) ?? [...document.querySelectorAll("h2")].find(vis);
      const caja = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
      const candidatos = [...document.querySelectorAll("a, button")].filter(vis).map((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return {
          texto: (el.textContent || "").trim().slice(0, 60),
          href: el instanceof HTMLAnchorElement ? el.href : null,
          relleno: !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent",
          fondo: bg,
          caja: caja(el.getBoundingClientRect()),
        };
      });
      let fondoPagina: string | null = null;
      for (const el of [document.body, document.documentElement, ...document.querySelectorAll("main, header, section")]) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
          fondoPagina = c;
          break;
        }
      }
      return { titulo: document.title, heroe: heroe ? caja(heroe.getBoundingClientRect()) : null, candidatos, fondoPagina, iw: innerWidth, ih: innerHeight };
    });
    const cta = elegirCta(sc.candidatos as Candidato[], { url: page.url(), altoVentana: sc.ih });
    const historia: Historia = op.historia ?? (cta?.href ? "clic" : "scroll");
    const acento = acentoDe([...(cta ? [cta] : []), ...(sc.candidatos as Candidato[])]);
    log(`Historia: ${historia} · botón: ${cta ? `«${cta.texto}» (${cta.puntaje})` : "ninguno"} · acento ${acento ?? "-"} · fondo ${sc.fondoPagina ?? "-"}`);

    // Grabación: screencast de CDP (cuadro variable, con la hora de cada cuadro).
    const cdp = await ctx.newCDPSession(page);
    const cuadros: { archivo: string; t: number }[] = [];
    const escrituras: Promise<void>[] = [];
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const archivo = path.join(dirCuadros, `c${String(cuadros.length).padStart(5, "0")}.jpg`);
      cuadros.push({ archivo, t: f.metadata.timestamp ?? Date.now() / 1000 });
      escrituras.push(fsp.writeFile(archivo, Buffer.from(f.data, "base64")));
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: Math.round(vista.width * escala),
      maxHeight: Math.round(vista.height * escala),
      everyNthFrame: 1,
    });
    const t0 = Date.now() / 1000;
    const ahora = () => Date.now() / 1000 - t0;
    const eventos: RegistroDemo["eventos"] = [];
    const cursor: RegistroDemo["cursor"] = [];
    const clics: number[] = [];
    const marcar = (nombre: string, extra: { x?: number; y?: number } = {}) => eventos.push({ nombre, t: ahora(), ...extra });
    const fr = (b: { x: number; y: number; width: number; height: number }) => ({ x: (b.x + b.width / 2) / sc.iw, y: (b.y + b.height / 2) / sc.ih });
    const kx = sc.iw / 1280;
    const ky = sc.ih / 800;
    let pos = { x: sc.iw * 0.55, y: sc.ih * 0.45 };
    const mover = async (p: { x: number; y: number }) => {
      pos = { x: Math.min(sc.iw * 0.95, Math.max(sc.iw * 0.05, p.x)), y: Math.min(sc.ih * 0.95, Math.max(sc.ih * 0.05, p.y)) };
      await page.mouse.move(pos.x, pos.y).catch(() => {});
      cursor.push({ t: ahora(), x: pos.x / sc.iw, y: pos.y / sc.ih });
    };
    // Deslizamiento con curva suave (smoothstep), ~60 pasos por segundo.
    const deslizar = async (a: { x: number; y: number }, ms: number) => {
      const de = { ...pos };
      const n = Math.max(8, Math.round(ms / 16));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const e = t * t * (3 - 2 * t);
        await mover({ x: de.x + (a.x - de.x) * e, y: de.y + (a.y - de.y) * e });
        await dormir(ms / n);
      }
    };
    const desplazar = (d: number) => page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), d).catch(() => {});
    const alturaVista = () => page.evaluate(() => window.scrollY).catch(() => 0);

    await mover(pos);
    if (sc.heroe) marcar("heroe", fr(sc.heroe));
    await dormir(1300);
    if (historia === "clic" && cta) {
      const c = { x: cta.caja.x + cta.caja.width / 2, y: cta.caja.y + cta.caja.height / 2 };
      marcar("cta", fr(cta.caja));
      await deslizar({ x: c.x + 16, y: c.y + 24 }, 700);
      await deslizar(c, 380);
      await dormir(420);
      marcar("clic");
      clics.push(ahora());
      await page.mouse.down().catch(() => {});
      await dormir(70);
      await page.mouse.up().catch(() => {});
      await page.waitForLoadState("load", { timeout: 25_000 }).catch(() => {});
      await dormir(1100);
      marcar("listo");
      const h2 = await page.locator("h1, h2").first().boundingBox().catch(() => null);
      if (h2 && h2.y < sc.ih) marcar("pagina2", fr(h2));
      await deslizar({ x: sc.iw * 0.55, y: sc.ih * 0.5 }, 800);
      await dormir(1100);
    } else {
      await deslizar({ x: sc.iw * 0.5, y: sc.ih * 0.45 }, 900);
      await dormir(500);
      marcar("scroll1");
      await desplazar(Math.round(sc.ih * 0.95));
      await deslizar({ x: pos.x + 90 * kx, y: pos.y + 120 * ky }, 900);
      await dormir(2300);
    }
    marcar("scroll2");
    await desplazar(Math.round(sc.ih * 0.85));
    await deslizar({ x: pos.x + 110 * kx, y: pos.y + 130 * ky }, 900);
    await dormir(800);
    // Si hace falta más (la voz es larga), seguir bajando por la página con calma; cada bajada es
    // contenido nuevo. Al llegar al final, quedarse quieto.
    const minimo = op.duracionMin ?? 0;
    let lado = -1;
    while (ahora() < minimo - 2.3) {
      const antes = await alturaVista();
      await desplazar(Math.round(sc.ih * 0.7));
      await deslizar({ x: sc.iw * (0.5 + lado * 0.12), y: sc.ih * 0.5 }, 900);
      lado = -lado;
      await dormir(1600);
      if ((await alturaVista()) <= antes + 2) {
        await dormir(Math.max(0, (minimo - 2.3 - ahora()) * 1000));
        break;
      }
    }
    // Reposo con un leve temblor del cursor.
    const hasta = Date.now() + 2300;
    while (Date.now() < hasta) {
      await mover({ x: pos.x + (Math.random() - 0.5) * 2.4, y: pos.y + (Math.random() - 0.5) * 2.4 });
      await dormir(150);
    }
    marcar("fin");
    const tFin = Date.now() / 1000;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(escrituras);
    if (cuadros.length < 2) throw new Error("La página no se dejó grabar (no dio imágenes). Prueba con otra página o más tarde.");

    // Cuadros → video a 30 fps (cada cuadro dura hasta el siguiente; uno por segundo es keyframe).
    const lista = cuadros.map((c, i) => `file '${c.archivo}'\nduration ${(((cuadros[i + 1]?.t ?? tFin) - c.t) || 0.001).toFixed(4)}`).join("\n");
    await fsp.writeFile(path.join(dir, "cuadros.txt"), `${lista}\nfile '${cuadros[cuadros.length - 1]!.archivo}'\n`);
    log(`Toma: ${cuadros.length} cuadros, ${(tFin - cuadros[0]!.t).toFixed(1)} s, ~${fpsDominante(cuadros.map((c) => c.t)) ?? "?"} fps reales → 30 fps`);
    const video = path.join(dir, "toma.mp4");
    await ffmpeg([
      "-f", "concat", "-safe", "0", "-i", path.join(dir, "cuadros.txt"),
      "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-g", "30", "-movflags", "+faststart", video,
    ]);
    await fsp.rm(dirCuadros, { recursive: true, force: true });
    await fsp.rm(path.join(dir, "cuadros.txt"), { force: true });
    const info = await probar(video);
    // Los eventos van con el reloj de la máquina; el video empieza en el primer cuadro.
    const corr = t0 - cuadros[0]!.t;
    const mueve = <T extends { t: number }>(x: T) => ({ ...x, t: Math.max(0, x.t + corr) });
    const r: RegistroDemo = {
      url,
      titulo: sc.titulo,
      historia,
      formato: op.formato,
      cta: cta?.texto ?? null,
      acento,
      fondoPagina: leerRgb(sc.fondoPagina),
      eventos: eventos.map(mueve),
      cursor: cursor.map(mueve),
      clics: clics.map((t) => Math.max(0, t + corr)),
      duracion: info.duracion,
      ancho: info.ancho ?? Math.round(vista.width * escala),
      alto: info.alto ?? Math.round(vista.height * escala),
      imagenesRotas: medida?.rotas ?? 0,
    };
    await fsp.writeFile(path.join(dir, "toma.json"), JSON.stringify(r, null, 1));
    return r;
  } finally {
    signal?.removeEventListener("abort", cerrar);
    await nav.close().catch(() => {});
  }
}

/**
 * Una grabación de pantalla subida por la persona → `<dir>/toma.mp4` con la misma forma que la toma
 * automática (30 fps, lados pares, hasta 1920 px de ancho o 1920 de alto, sin sonido: la voz es la
 * del texto), y su registro para el montaje (ver `registroDeGrabacion`).
 */
export async function prepararGrabacion(
  src: string,
  dir: string,
  o: { formato: FormatoDemo; objetivo: number; log?: Registro },
): Promise<RegistroDemo> {
  const log = o.log ?? (() => {});
  const antes = await probar(src).catch(() => null);
  if (!antes?.ancho || !antes.alto) throw new Error("No pude leer la grabación: súbela otra vez como video (MP4 o MOV).");
  const video = path.join(dir, "toma.mp4");
  await ffmpeg([
    "-i", src, "-an",
    "-vf", "fps=30,scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", "30", "-movflags", "+faststart", video,
  ], log);
  const info = await probar(video);
  log(`Grabación: ${antes.ancho}×${antes.alto}, ${info.duracion.toFixed(1)} s → toma ${info.ancho}×${info.alto} a 30 fps`);
  const r = registroDeGrabacion({ duracion: info.duracion, ancho: info.ancho ?? antes.ancho, alto: info.alto ?? antes.alto }, { formato: o.formato, objetivo: o.objetivo });
  await fsp.writeFile(path.join(dir, "toma.json"), JSON.stringify(r, null, 1));
  return r;
}

export interface OpcionesRender {
  estilo: EstiloDemo;
  maximo: number;
  fondo?: { desde: string; hasta: string };
  salida: string;
  log?: Registro;
  signal?: AbortSignal;
  /** Deja qa-*.jpg junto a la salida (fotogramas de los momentos clave). */
  fotogramas?: boolean;
}

/** Compone la demo en Hyperframes (en `<dir>/build`) y la renderiza a `op.salida`. */
export async function renderDemo(dir: string, r: RegistroDemo, op: OpcionesRender): Promise<{ montaje: Montaje; fondo: { desde: string; hasta: string } }> {
  const log = op.log ?? (() => {});
  const montaje = planDemo(r, op.estilo, op.maximo);
  const fondo = op.fondo ?? gradienteMarca(r.acento, r.fondoPagina);
  log(`Montaje: ${montaje.total.toFixed(2)} s, cortes ${montaje.cortes.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(" + ")}, fondo ${fondo.desde} → ${fondo.hasta}`);
  const build = path.join(dir, "build");
  await fsp.rm(build, { recursive: true, force: true });
  await fsp.mkdir(path.join(build, "assets"), { recursive: true });
  const toma = path.join(dir, "toma.mp4");
  await fsp.link(toma, path.join(build, "assets", "toma.mp4")).catch(() => fsp.copyFile(toma, path.join(build, "assets", "toma.mp4")));
  // GSAP de node_modules, sin internet (REN-10).
  const gsap = gsapParaProyecto();
  if (gsap.archivo) {
    await fsp.mkdir(path.dirname(path.join(build, gsap.src)), { recursive: true });
    await fsp.copyFile(gsap.archivo, path.join(build, gsap.src));
  }
  await fsp.writeFile(path.join(build, "index.html"), componerDemo({ registro: r, montaje, video: "assets/toma.mp4", fondo, gsap: gsap.src }));
  await fsp.writeFile(
    path.join(build, "hyperframes.json"),
    JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } }, null, 2),
  );
  const env = { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };
  const chk = await correrHf(["check", "--json", "--no-cache", "--no-craft"], { cwd: build, env, permitirFallo: true, signal: op.signal, timeout: 15 * 60_000 });
  await fsp.writeFile(path.join(build, "check.json"), chk.stdout || "{}");
  try {
    const j = JSON.parse(chk.stdout) as { ok?: boolean };
    log(`hyperframes check: ${j.ok ? "ok" : "con problemas (ver build/check.json)"}`);
  } catch {
    log("hyperframes check: salida no JSON (ver build/check.json)");
  }
  await correrHf(["render", "--output", op.salida, "--quality", "high", "--fps", "30", "--quiet", "--no-browser-gpu"], { cwd: build, env, signal: op.signal, timeout: 60 * 60_000 });
  if (op.fotogramas) {
    const momentos = [0.4, ...montaje.tomas.map((t) => (t.inicio + t.fin) / 2), montaje.total - 0.3];
    for (const [i, t] of momentos.entries()) await fotograma(op.salida, Math.max(0, Math.min(t, montaje.total - 0.05)), path.join(path.dirname(op.salida), `qa-${i + 1}.jpg`), 640);
  }
  return { montaje, fondo };
}
