/**
 * Modo inmersivo: el tema manda en toda la página, no sólo en los colores. Cada familia de adornos tiene su
 * escenario (bosque, jardín, noche, mar, invierno, elegante, fiesta) con:
 *
 * - **Profundidad**: capas fijas (lejos, medio) que se mueven a distinta velocidad con el scroll, troncos o
 *   columnas que enmarcan los lados y ramas en primer plano en las esquinas.
 * - **Un camino** (raíz, enredadera, constelación, corriente…) que se dibuja con el scroll y lleva de una parte
 *   a la siguiente; en su recorrido brotan los adornos del tema y las tarjetas salen a su paso.
 * - **Interacción**: el dedo (o el ratón) es una linterna que ilumina el escenario; tocar suelta un puñado de
 *   luciérnagas, pétalos o estrellas; el scroll rápido mueve las ramas como viento.
 *
 * Todo es SVG en línea, generado con una semilla fija (igual siempre para la misma invitación), y sólo se
 * animan `transform` y `opacity`. La lectura manda: las tarjetas siguen opacas y nada va encima del texto.
 * Con «reducir movimiento» (lo pide el teléfono con el ahorro de batería o «quitar animaciones»): se apaga
 * lo que se mueve solo y marea (parallax, ramas, chispas que vuelan); siguen el camino que avanza con el
 * scroll, los brotes y las tarjetas con fundido, y la linterna (sigue al dedo).
 */
import type { Estilo } from "./estilo";
import { SIMBOLOS } from "./estilo";

export type Escenario = "bosque" | "jardin" | "noche" | "mar" | "invierno" | "elegante" | "fiesta";

export function escenarioDe(adorno: Estilo["adorno"]): Escenario {
  switch (adorno) {
    case "hojas":
    case "hongos":
    case "mariposas":
      return "bosque";
    case "flores":
    case "corazones":
      return "jardin";
    case "estrellas":
    case "lunas":
      return "noche";
    case "ondas":
      return "mar";
    case "copos":
      return "invierno";
    case "globos":
      return "fiesta";
    default:
      return "elegante";
  }
}

/** Números al azar repetibles (mulberry32): el mismo escenario para la misma invitación. */
export function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function semillaDe(texto: string): number {
  let h = 2166136261;
  for (const ch of texto) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Un árbol: tronco que se afina y copa de varias manchas. (x, base) es el pie; `alto` en unidades del viewBox. */
function arbol(rnd: () => number, x: number, base: number, alto: number, ancho: number): string {
  const t = ancho * (0.14 + rnd() * 0.06);
  const copaY = base - alto * (0.62 + rnd() * 0.12);
  const tronco = `M${r1(x - t)} ${base}C${r1(x - t * 0.7)} ${r1(base - alto * 0.3)} ${r1(x - t * 0.45)} ${r1(copaY + alto * 0.1)} ${r1(x - t * 0.3)} ${r1(copaY)}L${r1(x + t * 0.3)} ${r1(copaY)}C${r1(x + t * 0.45)} ${r1(copaY + alto * 0.1)} ${r1(x + t * 0.7)} ${r1(base - alto * 0.3)} ${r1(x + t)} ${base}Z`;
  const manchas = Array.from({ length: 4 + Math.floor(rnd() * 3) }, () => {
    const cx = x + (rnd() - 0.5) * ancho * 0.9;
    const cy = copaY - alto * (0.05 + rnd() * 0.3);
    const rad = ancho * (0.28 + rnd() * 0.22);
    return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rad)}"/>`;
  }).join("");
  // Una rama que sale del tronco hacia la copa.
  const lado = rnd() < 0.5 ? -1 : 1;
  const ry = base - alto * (0.35 + rnd() * 0.15);
  const rama = `<path d="M${r1(x)} ${r1(ry)}Q${r1(x + lado * ancho * 0.25)} ${r1(ry - alto * 0.08)} ${r1(x + lado * ancho * 0.45)} ${r1(ry - alto * 0.2)}" fill="none" stroke-width="${r1(t * 0.5)}" stroke-linecap="round"/>`;
  return `<path d="${tronco}"/>${rama}${manchas}`;
}

function pino(rnd: () => number, x: number, base: number, alto: number, ancho: number): string {
  const pisos = 3 + Math.floor(rnd() * 2);
  let d = "";
  for (let i = 0; i < pisos; i++) {
    const y = base - alto * 0.15 - (alto * 0.8 * i) / pisos;
    const w = ancho * (1 - i / (pisos + 0.5));
    d += `M${r1(x - w / 2)} ${r1(y)}L${r1(x)} ${r1(y - alto * 0.38)}L${r1(x + w / 2)} ${r1(y)}Z`;
  }
  return `<path d="${d}M${r1(x - ancho * 0.05)} ${base}h${r1(ancho * 0.1)}v${r1(-alto * 0.2)}h${r1(-ancho * 0.1)}Z"/>`;
}

/** Colinas onduladas a lo ancho (para jardín, noche, invierno, mar). */
function colinas(rnd: () => number, base: number, alto: number, ondas: number): string {
  let d = `M0 1000L0 ${base}`;
  const paso = 1000 / ondas;
  for (let i = 0; i < ondas; i++) {
    const x = i * paso;
    d += `Q${r1(x + paso / 2)} ${r1(base - alto * (0.5 + rnd() * 0.5))} ${r1(x + paso)} ${r1(base - rnd() * alto * 0.2)}`;
  }
  return `<path d="${d}L1000 1000Z"/>`;
}

function olas(base: number, alto: number, n: number, fase: number): string {
  let d = `M0 1000L0 ${base}`;
  const paso = 1000 / n;
  for (let i = 0; i < n; i++) d += `q${r1(paso / 4)} ${r1(-alto)} ${r1(paso / 2)} 0t${r1(paso / 2)} 0`;
  return `<path d="${d}L1000 1000Z" transform="translate(${r1(-fase * paso)} 0)"/>`;
}

/** Capa lejana y capa media del escenario (SVG de 1000×1000 que cubre la pantalla desde abajo). */
export function capasEscenario(esc: Escenario, semilla: number): { lejos: string; medio: string } {
  const rnd = azar(semilla);
  const svg = (cuerpo: string) => `<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMax slice">${cuerpo}</svg>`;
  switch (esc) {
    case "bosque": {
      const lejos = Array.from({ length: 14 }, (_, i) => arbol(rnd, i * 74 + rnd() * 50, 960, 380 + rnd() * 260, 140 + rnd() * 80)).join("") + colinas(rnd, 975, 40, 5);
      const helechos = Array.from({ length: 22 }, () => {
        const x = rnd() * 1000;
        const h = 50 + rnd() * 70;
        const l = rnd() < 0.5 ? -1 : 1;
        return `<path d="M${r1(x)} 1000q${r1(l * h * 0.3)} ${r1(-h * 0.6)} ${r1(l * h * 0.7)} ${r1(-h)}" fill="none" stroke-width="${r1(3 + rnd() * 3)}" stroke-linecap="round"/>`;
      }).join("");
      const medio = Array.from({ length: 7 }, (_, i) => arbol(rnd, i * 160 + rnd() * 80, 1000, 520 + rnd() * 240, 200 + rnd() * 100)).join("") + colinas(rnd, 985, 50, 4) + helechos;
      return { lejos: svg(lejos), medio: svg(medio) };
    }
    case "invierno": {
      const lejos = colinas(rnd, 820, 120, 4) + Array.from({ length: 14 }, (_, i) => pino(rnd, i * 75 + rnd() * 40, 830, 260 + rnd() * 160, 120 + rnd() * 50)).join("");
      const medio = colinas(rnd, 930, 90, 3) + Array.from({ length: 6 }, (_, i) => pino(rnd, i * 190 + rnd() * 90, 950, 420 + rnd() * 200, 200 + rnd() * 60)).join("");
      return { lejos: svg(lejos), medio: svg(medio) };
    }
    case "noche": {
      const luna = `<circle cx="${r1(620 + rnd() * 200)}" cy="${r1(180 + rnd() * 80)}" r="70" class="astro"/>`;
      return { lejos: svg(luna + colinas(rnd, 800, 160, 3)), medio: svg(colinas(rnd, 920, 120, 4)) };
    }
    case "mar":
      return { lejos: svg(olas(760, 30, 6, rnd()) + olas(820, 26, 7, rnd())), medio: svg(olas(900, 34, 5, rnd()) + olas(950, 22, 8, rnd())) };
    case "jardin": {
      const tallos = Array.from({ length: 18 }, () => {
        const x = rnd() * 1000;
        const h = 120 + rnd() * 220;
        return `<path d="M${r1(x)} 1000q${r1((rnd() - 0.5) * 60)} ${r1(-h / 2)} 0 ${r1(-h)}" fill="none" stroke-width="5"/><circle cx="${r1(x)}" cy="${r1(1000 - h)}" r="${r1(16 + rnd() * 16)}"/>`;
      }).join("");
      return { lejos: svg(colinas(rnd, 830, 140, 3)), medio: svg(colinas(rnd, 940, 80, 4) + tallos) };
    }
    case "fiesta": {
      const globos = Array.from({ length: 9 }, () => {
        const x = rnd() * 1000;
        const y = 300 + rnd() * 450;
        return `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(34 + rnd() * 14)}" ry="${r1(44 + rnd() * 16)}"/><path d="M${r1(x)} ${r1(y + 50)}q${r1(-20 + rnd() * 40)} 120 0 260" fill="none" stroke-width="3"/>`;
      }).join("");
      return { lejos: svg(globos), medio: svg(colinas(rnd, 960, 60, 5)) };
    }
    default: {
      // Elegante: arcos y columnas, como un salón.
      const arcos = Array.from({ length: 5 }, (_, i) => {
        const x = i * 220 + 30;
        return `<path d="M${x} 1000V560a90 90 0 0 1 180 0V1000h-26V566a64 64 0 0 0-128 0V1000Z"/>`;
      }).join("");
      return { lejos: svg(arcos), medio: svg(`<path d="M0 1000V930h1000v70Z"/>`) };
    }
  }
}

/** Lo que enmarca los lados (troncos, columnas, algas…) y las ramas de primer plano en las esquinas. */
export function marcoEscenario(esc: Escenario, semilla: number, adorno: Estilo["adorno"]): { lado: string; rama: string } {
  const rnd = azar(semilla ^ 0x5bd1e995);
  const s = adorno === "clasico" ? SIMBOLOS.hojas : SIMBOLOS[adorno];
  const hoja = (x: number, y: number, esc2: number, rot: number) => `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(esc2)}) rotate(${r1(rot)} 12 12)">${s}</g>`;
  if (esc === "bosque" || esc === "jardin" || esc === "invierno") {
    // Tronco a lo alto (se ve en el margen) y una rama que entra desde la esquina con hojas.
    const lado = `<svg viewBox="0 0 60 1000" preserveAspectRatio="none"><path d="M0 0H${r1(30 + rnd() * 10)}C${r1(44 + rnd() * 10)} 300 ${r1(26 + rnd() * 10)} 640 ${r1(40 + rnd() * 10)} 1000H0Z"/></svg>`;
    const hojas = Array.from({ length: 9 }, (_, i) => hoja(30 + i * 26 + rnd() * 10, 18 + Math.sin(i) * 14 + rnd() * 16, 1.6 + rnd() * 1.2, -40 + rnd() * 90)).join("");
    const rama = `<svg viewBox="0 0 300 120"><path d="M-10 18C70 10 150 30 280 60" fill="none" stroke-width="7" stroke-linecap="round"/><path d="M90 22C120 50 160 70 200 96" fill="none" stroke-width="4" stroke-linecap="round"/><g class="hojitas">${hojas}</g></svg>`;
    return { lado, rama };
  }
  if (esc === "mar") {
    const lado = `<svg viewBox="0 0 60 1000" preserveAspectRatio="none"><path d="M0 1000V0C40 120 10 240 40 360S10 600 40 720 10 900 30 1000Z"/></svg>`;
    return { lado, rama: `<svg viewBox="0 0 300 120"><g class="hojitas">${hoja(20, 10, 2.4, 0)}${hoja(90, 30, 1.6, 20)}${hoja(150, 6, 1.2, -10)}</g></svg>` };
  }
  if (esc === "elegante") {
    const lado = `<svg viewBox="0 0 60 1000" preserveAspectRatio="none"><path d="M0 0H34V40H26V960H34V1000H0Z"/></svg>`;
    return { lado, rama: `<svg viewBox="0 0 300 120"><path d="M0 20H200C240 20 250 60 290 60" fill="none" stroke-width="3"/><g class="hojitas">${hoja(206, 30, 1.6, 0)}</g></svg>` };
  }
  // Noche y fiesta: sin troncos; estrellas o serpentinas en la esquina.
  return { lado: "", rama: `<svg viewBox="0 0 300 120"><g class="hojitas">${hoja(10, 10, 2, 0)}${hoja(80, 40, 1.4, 25)}${hoja(150, 12, 1.1, -20)}${hoja(210, 50, 0.9, 10)}</g></svg>` };
}

/** Cómo se ve el camino de cada escenario (trazo principal y uno secundario, más fino, que lo acompaña). */
const CAMINO: Record<Escenario, { ancho: number; segundo: number; punteado?: string; nombre: string }> = {
  bosque: { ancho: 7, segundo: 3, nombre: "raíz" },
  jardin: { ancho: 4, segundo: 2, nombre: "enredadera" },
  noche: { ancho: 2, segundo: 0, punteado: "2 14", nombre: "constelación" },
  mar: { ancho: 5, segundo: 2, nombre: "corriente" },
  invierno: { ancho: 4, segundo: 0, punteado: "1 12", nombre: "huellas en la nieve" },
  elegante: { ancho: 2, segundo: 1, nombre: "filigrana" },
  fiesta: { ancho: 2.5, segundo: 0, nombre: "serpentina" },
};

/**
 * Con `fondoB64` (un fondo realista dibujado con IA) la foto reemplaza las siluetas y las ramas: va en la
 * capa lejana (se mueve con el scroll), con bruma en la capa media y un velo para que se lea el texto.
 */
export function htmlEscenario(e: Estilo, semilla: number, fondoB64?: string): { fondo: string; frente: string; camino: string } {
  const esc = escenarioDe(e.adorno);
  const c = CAMINO[esc];
  const camino = `<svg class="camino" aria-hidden="true" data-ancho="${c.ancho}" data-segundo="${c.segundo}"${c.punteado ? ` data-punteado="${c.punteado}"` : ""}><path class="camino-dos"/><path class="camino-uno"/><g class="brotes"></g></svg>`;
  if (fondoB64) {
    const rayosFoto = esc === "bosque" || esc === "jardin" ? `<div class="rayos"><i></i><i></i><i></i><i></i></div>` : "";
    return {
      fondo: `<div class="escena esc-${esc} con-foto" aria-hidden="true"><div class="capa lejos foto"><i style="background-image:url(data:image/webp;base64,${fondoB64})"></i></div>${rayosFoto}<div class="capa medio bruma"><i></i><i></i><i></i></div><div class="velo"></div><div class="linterna"></div></div>`,
      frente: `<div class="primer-plano con-foto" aria-hidden="true"></div>`,
      camino,
    };
  }
  const { lejos, medio } = capasEscenario(esc, semilla);
  const { lado, rama } = marcoEscenario(esc, semilla, e.adorno);
  const rayos = esc === "bosque" || esc === "jardin" ? `<div class="rayos"><i></i><i></i><i></i><i></i></div>` : "";
  const fondo = `<div class="escena esc-${esc}" aria-hidden="true">${rayos}<div class="capa lejos">${lejos}</div><div class="capa medio">${medio}</div>${lado ? `<div class="lado izq">${lado}</div><div class="lado der">${lado}</div>` : ""}<div class="linterna"></div></div>`;
  const frente = `<div class="primer-plano esc-${esc}" aria-hidden="true"><div class="rama izq">${rama}</div><div class="rama der">${rama}</div></div>`;
  return { fondo, frente, camino };
}

export function cssEscenario(e: Estilo): string {
  const esc = escenarioDe(e.adorno);
  const oscuro = (p: number) => `color-mix(in srgb,var(--fondo) ${p}%,#000)`;
  const bruma = (p: number) => `color-mix(in srgb,var(--fondo) ${100 - p}%,var(--claro))`;
  return `
.escena{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.escena .capa{position:absolute;left:-4%;right:-4%;bottom:-12%;height:118%;will-change:transform}
.escena .capa svg{width:100%;height:100%;display:block}
.escena .lejos{fill:${bruma(18)};stroke:${bruma(18)};opacity:.7}
.escena .rayos{position:absolute;inset:-10% -20% 0;transform-origin:50% 0;animation:rayos 14s ease-in-out infinite alternate}
.escena .rayos i{position:absolute;top:-10%;width:16vmax;height:130%;background:linear-gradient(180deg,color-mix(in srgb,var(--claro) 26%,transparent),color-mix(in srgb,var(--acento) 8%,transparent) 55%,transparent);filter:blur(14px);transform:rotate(18deg);transform-origin:50% 0;opacity:.55;mix-blend-mode:screen}
.escena .rayos i:nth-child(1){left:18%}.escena .rayos i:nth-child(2){left:38%;width:9vmax;opacity:.4}.escena .rayos i:nth-child(3){left:56%;width:13vmax}.escena .rayos i:nth-child(4){left:76%;width:7vmax;opacity:.35}
@keyframes rayos{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
.escena .medio{fill:${oscuro(70)};stroke:${oscuro(70)};opacity:.9}
.escena .astro{fill:var(--claro);opacity:.85}
.escena .lado{position:absolute;top:-5%;bottom:-5%;width:clamp(22px,7vw,70px);fill:${oscuro(55)};will-change:transform}
.escena .lado svg{width:100%;height:100%;display:block}.escena .izq{left:0}.escena .der{right:0;transform:scaleX(-1)}
.escena .linterna{position:absolute;left:0;top:0;width:150vmax;height:150vmax;margin:-75vmax 0 0 -75vmax;border-radius:50%;
background:radial-gradient(circle,color-mix(in srgb,var(--acento) 34%,transparent) 0,color-mix(in srgb,var(--acento) 10%,transparent) 9%,transparent 22%);mix-blend-mode:screen;opacity:0;transition:opacity .6s;will-change:transform}
.escena.tocada .linterna{opacity:1}
.primer-plano{position:fixed;inset:0;z-index:4;pointer-events:none}
.primer-plano .rama{position:absolute;top:-6px;width:min(46vw,300px);fill:var(--acento);stroke:${oscuro(40)};transform-origin:0 0;will-change:transform}
.primer-plano .rama svg{width:100%;height:auto;display:block;overflow:visible}
.primer-plano .rama .hojitas{fill:color-mix(in srgb,var(--acento) 70%,${oscuro(30)});stroke:${oscuro(40)};stroke-width:1}
.primer-plano .izq{left:-8px}.primer-plano .der{right:-8px;transform:scaleX(-1);transform-origin:100% 0}
.resto{position:relative}
.camino{position:absolute;left:0;top:0;width:100%;pointer-events:none;overflow:visible;z-index:0}
.camino path{fill:none;stroke-linecap:round;stroke-linejoin:round}
.camino-uno{stroke:color-mix(in srgb,var(--acento) 80%,${oscuro(40)})}
.camino-dos{stroke:color-mix(in srgb,var(--acento) 45%,transparent)}
.camino .brote{fill:color-mix(in srgb,var(--acento) 55%,transparent);stroke:var(--acento);stroke-width:1.2;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.6,.5,1)}
.camino .brote.sale{transform:scale(1)}
.resto>.tarjeta,.resto>.pie{position:relative;z-index:1}
.resto>.tarjeta{margin:64px 0}
.tarjeta.aparece{transform:translateY(30px) scale(.94) rotate(var(--giro,0deg));transform-origin:var(--desde,50%) 0}
.tarjeta.aparece.visible{transform:none}
.chispa{position:fixed;z-index:5;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;fill:var(--acento);stroke:var(--acento);stroke-width:1.2;animation:chispa 1.1s ease-out forwards}
.chispa svg{width:100%;height:100%;overflow:visible}
@keyframes chispa{0%{transform:translate(0,0) scale(.4);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1) rotate(var(--gr));opacity:0}}
/* Fondo realista: la foto respira despacio, la bruma cruza y el velo deja leer los textos de la portada. */
.escena.con-foto .lejos{opacity:1}.escena.con-foto .medio{opacity:1}
.escena .foto i{position:absolute;inset:0;background:center/cover no-repeat;animation:respira 40s ease-in-out infinite alternate;will-change:transform}
@keyframes respira{from{transform:scale(1.03)}to{transform:scale(1.1) translateX(-1.5%)}}
.escena .bruma i{position:absolute;left:-30%;width:160%;height:38%;border-radius:50%;background:radial-gradient(ellipse at center,color-mix(in srgb,var(--claro) 24%,transparent),transparent 66%);filter:blur(16px);animation:bruma 26s ease-in-out infinite alternate}
.escena .bruma i:nth-child(1){top:52%}.escena .bruma i:nth-child(2){top:18%;opacity:.6;animation-duration:36s;animation-direction:alternate-reverse}.escena .bruma i:nth-child(3){top:76%;animation-duration:21s}
@keyframes bruma{from{transform:translateX(-14%)}to{transform:translateX(14%)}}
.escena .velo{position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--fondo) 50%,transparent),color-mix(in srgb,var(--fondo) 12%,transparent) 32%,color-mix(in srgb,var(--fondo) 22%,transparent) 70%,color-mix(in srgb,var(--fondo) 62%,transparent)),radial-gradient(ellipse at 50% 45%,transparent 45%,rgba(0,0,0,.38))}
.con-foto~.pagina .portada .pre,.con-foto~.pagina .portada .nombres,.con-foto~.pagina .pista,.con-foto~.pagina .desliza,.con-foto~.pagina .pie{text-shadow:0 2px 14px rgba(0,0,0,.8),0 0 3px rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){.escena .capa,.escena .lado,.primer-plano .rama{transform:none!important}.escena .foto i{animation:none}.escena .bruma i{animation-duration:60s}}
${esc === "noche" ? ".escena .lejos{opacity:.8}" : ""}`;
}

/**
 * El script del escenario: parallax por capas, el camino que se dibuja con el scroll y une las tarjetas
 * (pasando de un lado al otro entre ellas), brotes, tarjetas que salen del lado del camino, la linterna que
 * sigue al dedo, chispas al tocar y viento en las ramas con el scroll rápido.
 */
export function scriptEscenario(e: Estilo): string {
  const simbolo = e.adorno === "clasico" ? SIMBOLOS.hojas : SIMBOLOS[e.adorno];
  return `(function(){var quieto=matchMedia('(prefers-reduced-motion: reduce)').matches;
var esc=document.querySelector('.escena'),pp=document.querySelector('.primer-plano'),cam=document.querySelector('.camino');if(!esc||!cam)return;
var lejos=esc.querySelector('.lejos'),medio=esc.querySelector('.medio'),lados=esc.querySelectorAll('.lado'),ramas=pp?pp.querySelectorAll('.rama'):[],lint=esc.querySelector('.linterna');
var resto=document.querySelector('.resto'),uno=cam.querySelector('.camino-uno'),dos=cam.querySelector('.camino-dos'),brotes=cam.querySelector('.brotes');
var SIM=${JSON.stringify(`<svg viewBox="0 0 24 24">${simbolo}</svg>`)},largo=0,lista=[],ancho=+cam.dataset.ancho,seg=+cam.dataset.segundo;
uno.setAttribute('stroke-width',ancho);dos.setAttribute('stroke-width',seg||0);if(cam.dataset.punteado)uno.setAttribute('stroke-dasharray',cam.dataset.punteado);
// El camino: baja serpenteando y cruza de un lado al otro entre tarjeta y tarjeta.
function trazar(){if(!resto||resto.offsetParent===null)return;var w=resto.clientWidth,h=resto.scrollHeight,ts=resto.querySelectorAll(':scope>.tarjeta,:scope>.pie');
cam.setAttribute('width',w);cam.setAttribute('height',h);cam.setAttribute('viewBox','0 0 '+w+' '+h);
var m=Math.max(10,Math.min(26,w*.05)),x=w/2,y=0,d='M'+x+' 0',lado=1,i;
for(i=0;i<ts.length;i++){var t=ts[i],top=t.offsetTop,bot=top+t.offsetHeight,xs=lado>0?w-m:m;
 d+='C'+x+' '+(y+(top-y)*.6)+' '+xs+' '+(top-40)+' '+xs+' '+(top+30);d+='S'+(xs+lado*-4)+' '+(bot-30)+' '+xs+' '+(bot-10);
 t.style.setProperty('--desde',lado>0?'100%':'0%');t.style.setProperty('--giro',(lado>0?2.5:-2.5)+'deg');x=xs;y=bot;lado=-lado}
uno.setAttribute('d',d);dos.setAttribute('d',d);dos.setAttribute('transform','translate(3 2)');largo=uno.getTotalLength();
if(!cam.dataset.punteado){uno.style.strokeDasharray=largo;dos.style.strokeDasharray=largo}
brotes.innerHTML='';lista=[];var n=Math.floor(largo/150);for(i=1;i<n;i++){var p=uno.getPointAtLength(i*150),g=document.createElementNS('http://www.w3.org/2000/svg','g'),s=12+((i*7)%9);
 g.setAttribute('class','brote');g.innerHTML='<g transform="translate('+(p.x-s/2)+' '+(p.y-s/2)+') scale('+(s/24)+') rotate('+((i*47)%360)+' 12 12)">'+SIM.replace(/^<svg[^>]*>|<\\/svg>$/g,'')+'</g>';brotes.appendChild(g);lista.push({g:g,en:i*150})}
pintar()}
var ultimoY=scrollY,viento=0,pendiente=false;
function pintar(){pendiente=false;var y=scrollY,vh=innerHeight;
 if(!quieto){var pr=Math.min(1,y/Math.max(1,document.documentElement.scrollHeight-vh));lejos.style.transform='translateY('+(-pr*vh*.04)+'px)';medio.style.transform='translateY('+(-pr*vh*.09)+'px)';
  for(var i=0;i<lados.length;i++)lados[i].style.transform=(i?'scaleX(-1) ':'')+'translateY('+(-(y*.22)%(vh*.5))+'px)';
  viento=viento*.9+(y-ultimoY)*.05;for(var j=0;j<ramas.length;j++)ramas[j].style.transform=(j?'scaleX(-1) ':'')+'rotate('+Math.max(-6,Math.min(6,viento))+'deg)'}
 ultimoY=y;if(!largo||!resto)return;
 var r=resto.getBoundingClientRect(),hecho=Math.max(0,Math.min(largo,(vh*.78-r.top)/Math.max(1,r.height)*largo*1.08));
 if(!cam.dataset.punteado){uno.style.strokeDashoffset=largo-hecho;dos.style.strokeDashoffset=largo-hecho}
 for(var k=0;k<lista.length;k++)lista[k].g.classList.toggle('sale',lista[k].en<=hecho);
 if(Math.abs(viento)>.05&&!quieto)pedir()}
function pedir(){if(!pendiente){pendiente=true;requestAnimationFrame(pintar)}}
addEventListener('scroll',pedir,{passive:true});addEventListener('resize',function(){setTimeout(trazar,120)});
// Al abrir el sobre aparece el resto: se traza cuando ya tiene medidas (y otra vez cuando cargan las letras).
new MutationObserver(function(){setTimeout(trazar,60)}).observe(document.body,{attributes:true,attributeFilter:['class']});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){setTimeout(trazar,60)});trazar();
// Linterna: sigue al dedo o al ratón.
function luzEn(x,y){esc.classList.add('tocada');lint.style.transform='translate('+x+'px,'+y+'px)'}
addEventListener('pointermove',function(ev){luzEn(ev.clientX,ev.clientY)},{passive:true});
// Tocar suelta chispas del tema (no en botones, campos ni enlaces).
addEventListener('pointerdown',function(ev){luzEn(ev.clientX,ev.clientY);if(ev.target.closest('a,button,input,select,textarea,label,iframe'))return;
 for(var i=0;i<7;i++){var s=document.createElement('span'),a=Math.random()*6.3,dist=40+Math.random()*70;s.className='chispa';s.innerHTML=SIM;
  s.style.left=ev.clientX+'px';s.style.top=ev.clientY+'px';s.style.setProperty('--dx',Math.cos(a)*dist+'px');s.style.setProperty('--dy',Math.sin(a)*dist-30+'px');s.style.setProperty('--gr',(Math.random()*240-120)+'deg');
  document.body.appendChild(s);setTimeout(function(n){return function(){n.remove()}}(s),1200)}},{passive:true});
})();`;
}
