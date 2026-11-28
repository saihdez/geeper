/**
 * El estilo con que se dibuja una invitación: el de una de las 3 plantillas o el tema a medida
 * (tema.ts). Aquí están también los adornos SVG, las texturas de fondo y la animación de partículas.
 */
import { PLANTILLAS_INFO, TIPOS_INFO } from "./catalogo";
import type { Invitacion } from "./esquema";
import { genericaDe, type Colores, type Tema, type TextosTema } from "./tema";

export interface Estilo {
  colores: Colores;
  letras: { titulos: string; texto: string };
  adorno: Tema["adorno"];
  particulas: Tema["particulas"];
  fondo: Tema["fondo"];
  textos: Required<{ [K in keyof TextosTema]: string }>;
}

const TEXTOS_BASE = { pista: "Toca el sello para abrir", saludo: "¡Hola!", cancion: "Nuestra canción", faltan: "Faltan", ubicacion: "Ubicación", dress: "Dress code", rsvp: "Confirma tu asistencia", regalos: "Regalos" };

export function estiloDe(inv: Pick<Invitacion, "plantilla" | "tema" | "tipo">): Estilo {
  const t = inv.plantilla === "tema" ? inv.tema : undefined;
  const textosTipo = inv.tipo === "cumpleanos" || inv.tipo === "graduacion" || inv.tipo === "otro" ? { cancion: "La canción" } : {};
  if (t) {
    const textos = { ...TEXTOS_BASE, ...textosTipo, ...Object.fromEntries(Object.entries(t.textos).filter(([, v]) => v)) } as Estilo["textos"];
    return { colores: t.colores, letras: t.letras, adorno: t.adorno, particulas: t.particulas, fondo: t.fondo, textos };
  }
  const id = inv.plantilla === "tema" ? TIPOS_INFO[inv.tipo].plantilla : inv.plantilla;
  const p = PLANTILLAS_INFO[id];
  return { colores: p.colores, letras: p.letras, adorno: p.adorno, particulas: p.particulas, fondo: p.fondo, textos: { ...TEXTOS_BASE, ...textosTipo } };
}

export const pilaLetra = (letra: string) => `'${letra}',${genericaDe(letra) === "cursive" ? "'Snell Roundhand','Apple Chancery',cursive" : genericaDe(letra) === "serif" ? "Georgia,'Times New Roman',serif" : "system-ui,sans-serif"}`;

// ── Adornos ──────────────────────────────────────────────────────────────────────────────────────

/** Dibujo de cada adorno en una caja de 24×24 (trazo; el relleno lo pone el CSS). */
export const SIMBOLOS: Record<Exclude<Tema["adorno"], "clasico">, string> = {
  hojas: '<path d="M12 22V9"/><path d="M12 14C8 14 5 11 5 5c4 0 7 3 7 9zM12 11c4 0 7-3 7-8-4 0-7 3-7 8z"/>',
  flores: '<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="6" r="3"/><circle cx="17.7" cy="10.1" r="3"/><circle cx="15.5" cy="16.8" r="3"/><circle cx="8.5" cy="16.8" r="3"/><circle cx="6.3" cy="10.1" r="3"/>',
  estrellas: '<path d="M12 2.5l2.8 6.1 6.7.8-5 4.6 1.4 6.6L12 17.3l-5.9 3.3 1.4-6.6-5-4.6 6.7-.8z"/>',
  corazones: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  copos: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.8L12 6.3l2.5-2.5M9.5 20.2l2.5-2.5 2.5 2.5"/>',
  mariposas: '<path d="M12 7v12"/><path d="M12 11C9.5 5 3.5 4.5 4 9c.4 3 4 4 8 2.5zM12 11c2.5-6 8.5-6.5 8-2-.4 3-4 4-8 2.5zM12 13c-3 0-6.5 1.6-5.5 4.6.8 2 4 1.2 5.5-2.6zM12 13c3 0 6.5 1.6 5.5 4.6-.8 2-4 1.2-5.5-2.6z"/>',
  hongos: '<path d="M3.5 12.5a8.5 7.5 0 0 1 17 0z"/><path d="M9.5 12.5v6a2.5 2.5 0 0 0 5 0v-6"/><circle cx="9" cy="9" r="1.1"/><circle cx="14.8" cy="8" r="1.3"/>',
  lunas: '<path d="M15 3.5a8 8 0 1 0 5.5 13 7 7 0 0 1-5.5-13z"/><path d="M7 3.5l.8 1.7 1.7.8-1.7.8L7 8.5l-.8-1.7-1.7-.8 1.7-.8z"/>',
  ondas: '<path d="M2 9.5c3-3 5-3 8 0s5 3 8 0 4-2 4-2M2 15c3-3 5-3 8 0s5 3 8 0 4-2 4-2"/>',
  coronas: '<path d="M3 18L4.8 8l4.6 4L12 5l2.6 7 4.6-4L21 18z"/><path d="M3 21h18"/>',
  globos: '<ellipse cx="12" cy="9" rx="6" ry="7"/><path d="M11 16.2h2l-1 1.6zM12 17.8c0 2-2 2.2-1 4.2"/>',
  geometrico: '<path d="M12 2l10 10-10 10L2 12z"/><path d="M12 7l5 5-5 5-5-5z"/>',
};

const DIVISOR_CLASICO = '<svg class="adorno" viewBox="0 0 200 20" aria-hidden="true"><path d="M2 10h70M128 10h70"/><path class="relleno" d="M100 3c-6 0-10 7-18 7 8 0 12 7 18 7s10-7 18-7c-8 0-12-7-18-7z"/><circle cx="76" cy="10" r="2"/><circle cx="124" cy="10" r="2"/></svg>';

/** Separador de las tarjetas: línea · adorno · línea. */
export function divisor(adorno: Tema["adorno"]): string {
  if (adorno === "clasico") return DIVISOR_CLASICO;
  return `<svg class="adorno" viewBox="0 0 200 24" aria-hidden="true"><path d="M2 12h76M122 12h76"/><g class="relleno" transform="translate(88 0)">${SIMBOLOS[adorno]}</g></svg>`;
}

/** Racimos de adornos en dos esquinas de la portada (ninguno con el clásico). */
export function esquinas(adorno: Tema["adorno"]): string {
  if (adorno === "clasico") return "";
  const s = SIMBOLOS[adorno];
  const racimo = `<svg viewBox="0 0 120 120" aria-hidden="true"><g transform="translate(6 10) scale(2.2) rotate(-12 12 12)">${s}</g><g transform="translate(62 4) scale(1.3) rotate(18 12 12)">${s}</g><g transform="translate(18 66) scale(1.1) rotate(30 12 12)">${s}</g></svg>`;
  return `<div class="esquina e1">${racimo}</div><div class="esquina e2">${racimo}</div>`;
}

/** Capa de textura sobre el degradado del fondo. */
export function texturaFondo(fondo: Tema["fondo"]): string {
  switch (fondo) {
    case "puntos": return "radial-gradient(color-mix(in srgb,var(--acento) 30%,transparent) 1.2px,transparent 1.8px) 0 0/22px 22px,";
    case "rayas": return "repeating-linear-gradient(135deg,color-mix(in srgb,var(--acento) 12%,transparent) 0 1px,transparent 1px 16px),";
    case "bruma": return "radial-gradient(60% 40% at 15% 30%,color-mix(in srgb,var(--acento) 16%,transparent),transparent 70%),radial-gradient(50% 35% at 85% 70%,color-mix(in srgb,var(--acento) 12%,transparent),transparent 70%),";
    default: return "";
  }
}

// ── Partículas ───────────────────────────────────────────────────────────────────────────────────

/** Parámetros de cada animación: cuántas, tamaño, velocidad (px por cuadro, + baja) y cómo se dibujan. */
const PARTICULAS_CFG: Record<Exclude<Tema["particulas"], "ninguna">, { n: number; r: [number, number]; vy: [number, number]; forma: string }> = {
  luciernagas: { n: 26, r: [1.4, 2.8], vy: [-0.25, 0.25], forma: "luz" },
  estrellas: { n: 44, r: [0.6, 1.8], vy: [0, 0], forma: "titila" },
  petalos: { n: 16, r: [4, 7], vy: [0.5, 1.1], forma: "petalo" },
  hojas: { n: 14, r: [5, 8], vy: [0.5, 1], forma: "petalo" },
  copos: { n: 42, r: [1.2, 3.2], vy: [0.35, 1], forma: "punto" },
  burbujas: { n: 18, r: [3, 9], vy: [-0.9, -0.35], forma: "burbuja" },
  brillos: { n: 22, r: [2, 4.5], vy: [-0.1, 0.1], forma: "brillo" },
  confeti: { n: 28, r: [3, 6], vy: [0.6, 1.3], forma: "papel" },
};

/** Script que anima el fondo (canvas detrás del contenido). Nada si no hay partículas. */
export function scriptParticulas(e: Estilo): string {
  if (e.particulas === "ninguna") return "";
  const cfg = PARTICULAS_CFG[e.particulas];
  const colores = e.particulas === "copos" || e.particulas === "estrellas" ? [e.colores.claro, e.colores.acento] : [e.colores.acento, e.colores.sello, e.colores.claro];
  // Dos capas: detrás del contenido y, más tenue, delante (en el teléfono las tarjetas tapan casi todo el
  // fondo y las de atrás casi no se ven). La luz de las luciérnagas va pre-dibujada (shadowBlur es caro en
  // el teléfono). La velocidad va por tiempo (igual a 60 o 120 Hz). Con «reducir movimiento», titilan en su lugar (sin desplazarse).
  return `(function(){var quieto=matchMedia('(prefers-reduced-motion: reduce)').matches;
var C=${JSON.stringify({ ...cfg, colores })};
function lienzo(clase){var c=document.createElement('canvas');c.className=clase;c.setAttribute('aria-hidden','true');document.body.prepend(c);return c}
var atras=lienzo('particulas'),frente=lienzo('particulas delante'),xa=atras.getContext('2d'),xf=frente.getContext('2d');
var w,h,d=Math.min(2,window.devicePixelRatio||1),ps=[],vivo=true,antes=0,esc=1;
function tam(){w=innerWidth;h=innerHeight;esc=w<700?1.35:1;[atras,frente].forEach(function(c){c.width=w*d;c.height=h*d;c.getContext('2d').setTransform(d,0,0,d,0,0)});if(quieto)dibujar(0)}
function al(a){return a[0]+Math.random()*(a[1]-a[0])}
var luces={};function luz(col){if(luces[col])return luces[col];var s=document.createElement('canvas'),t=64;s.width=s.height=t;var g=s.getContext('2d'),r=g.createRadialGradient(t/2,t/2,0,t/2,t/2,t/2);
r.addColorStop(0,col);r.addColorStop(.18,col);r.addColorStop(.45,col+'55');r.addColorStop(1,col+'00');g.fillStyle=r;g.fillRect(0,0,t,t);return luces[col]=s}
w=innerWidth;h=innerHeight;var adelante=w<700?.4:.2;
for(var i=0;i<C.n;i++)ps.push({x:Math.random()*w,y:Math.random()*h,r:al(C.r),vy:al(C.vy),vx:(Math.random()-.5)*.4,f:Math.random()*6.3,g:.01+Math.random()*.03,c:C.colores[i%C.colores.length],fr:Math.random()<adelante});
function dibujar(k){xa.clearRect(0,0,w,h);xf.clearRect(0,0,w,h);for(var i=0;i<ps.length;i++){var p=ps[i],x=p.fr?xf:xa,r=p.r*esc;
if(k){p.f+=p.g*k;if(!quieto){p.y+=p.vy*k;p.x+=(p.vx+Math.sin(p.f)*.3)*k}}
if(p.y>h+12)p.y=-12;if(p.y<-12)p.y=h+12;if(p.x>w+12)p.x=-12;if(p.x<-12)p.x=w+12;
var a=C.forma==='luz'||C.forma==='titila'||C.forma==='brillo'?.3+.7*Math.abs(Math.sin(p.f*1.7)):.85;x.globalAlpha=a*(p.fr?.55:1);x.fillStyle=p.c;x.strokeStyle=p.c;
if(C.forma==='luz'){var s=r*8;x.drawImage(luz(p.c),p.x-s/2,p.y-s/2,s,s)}
else if(C.forma==='petalo'){x.save();x.translate(p.x,p.y);x.rotate(p.f);x.beginPath();x.ellipse(0,0,r,r*.5,0,0,6.3);x.fill();x.restore()}
else if(C.forma==='burbuja'){x.lineWidth=1.3;x.beginPath();x.arc(p.x,p.y,r,0,6.3);x.stroke()}
else if(C.forma==='brillo'){x.lineWidth=1.4;x.beginPath();x.moveTo(p.x-r,p.y);x.lineTo(p.x+r,p.y);x.moveTo(p.x,p.y-r);x.lineTo(p.x,p.y+r);x.stroke()}
else if(C.forma==='papel'){x.save();x.translate(p.x,p.y);x.rotate(p.f);x.fillRect(-r/2,-r/4,r,r/2);x.restore()}
else{x.beginPath();x.arc(p.x,p.y,r,0,6.3);x.fill()}}
xa.globalAlpha=1;xf.globalAlpha=1}
tam();addEventListener('resize',tam);
document.addEventListener('visibilitychange',function(){vivo=!document.hidden;if(vivo){antes=0;requestAnimationFrame(paso)}});
function paso(t){if(!vivo)return;var k=antes?Math.min(3,(t-antes)/16.7):1;antes=t;dibujar(k);requestAnimationFrame(paso)}requestAnimationFrame(paso)})();`;
}
