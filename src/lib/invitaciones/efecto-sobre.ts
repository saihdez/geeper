/**
 * El efecto al abrir el sobre: mariposas, pétalos, luciérnagas… salen volando del sobre mientras sale la
 * carta. Se dibuja en un canvas por encima de todo y se borra solo a los ~5 s.
 */
import type { EfectoSobre, Invitacion, Movimiento } from "./esquema";
import { SIMBOLOS, type Estilo } from "./estilo";

type Efecto = Exclude<EfectoSobre, "auto" | "propio">;

export const NOMBRES_MOVIMIENTO: Record<Movimiento, string> = {
  aletea: "Vuela aleteando (mariposas, aves, hadas)",
  cae: "Cae girando (pétalos, hojas, plumas)",
  flota: "Flota hacia arriba (burbujas, farolitos, globos)",
  estalla: "Estalla y cae (confeti, estrellas, brillos)",
};

/** El movimiento que va con lo que se describió (si la persona no elige otro). */
export function movimientoDe(descripcion: string): Movimiento {
  const d = descripcion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/mariposa|butterfl|polilla|moth|libelula|dragonfl|ave\b|aves\b|pajar|bird|colibri|hummingbird|hada|fair|murcielago|\bbat|paloma|dove|abeja|bee/.test(d)) return "aletea";
  if (/petalo|petal|hoja|leaf|leaves|pluma|feather|nieve|snow|copo|flor|flower|rosa\b|cerezo|sakura/.test(d)) return "cae";
  if (/burbuja|bubble|globo|balloon|farol|lantern|linterna|vela|candle|medusa|jellyfish|luz|luces|light|chispa/.test(d)) return "flota";
  return "estalla";
}

export const NOMBRES_EFECTO: Record<EfectoSobre, string> = {
  auto: "Automático (el que va con el tema)",
  propio: "✨ Mi efecto creado con IA",
  mariposas: "Mariposas",
  luciernagas: "Luciérnagas",
  petalos: "Pétalos",
  corazones: "Corazones",
  estrellas: "Estrellas",
  brillos: "Destellos dorados",
  hojas: "Hojas",
  copos: "Copos de nieve",
  burbujas: "Burbujas",
  confeti: "Confeti",
  ninguno: "Ninguno",
};

const POR_ADORNO: Record<Estilo["adorno"], Efecto> = {
  hojas: "luciernagas",
  flores: "petalos",
  estrellas: "estrellas",
  corazones: "corazones",
  copos: "copos",
  mariposas: "mariposas",
  hongos: "luciernagas",
  lunas: "estrellas",
  ondas: "burbujas",
  coronas: "brillos",
  globos: "confeti",
  geometrico: "brillos",
  clasico: "brillos",
};

export function efectoDe(inv: Pick<Invitacion, "efectoSobre">, e: Pick<Estilo, "adorno">): Efecto {
  const pedido = inv.efectoSobre ?? "auto";
  return pedido === "auto" || pedido === "propio" ? POR_ADORNO[e.adorno] : pedido;
}

/** Cuántas figuras y de qué tamaño, según el movimiento de un efecto propio. */
function recetaPropia(m: Movimiento) {
  switch (m) {
    case "aletea": return { n: 14, tam: [52, 88] as [number, number], sube: true, aletea: true };
    case "cae": return { n: 30, tam: [26, 46] as [number, number], sube: false };
    case "flota": return { n: 20, tam: [30, 58] as [number, number], sube: true, flota: true };
    case "estalla": return { n: 36, tam: [22, 42] as [number, number], sube: false };
  }
}

const dDe = (svg: string) => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]!);
const PETALO = "M12 2.5C6.5 8 6.5 16 12 21.5 17.5 16 17.5 8 12 2.5z";
const DESTELLO = "M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z";

/**
 * Cómo se mueve cada efecto: `formas` son trazos en una caja de 24×24; `sube` hace que floten hacia arriba
 * (si no, caen después del estallido); `aletea` encoge el ancho como alas.
 */
function receta(ef: Efecto): { n: number; tam: [number, number]; formas: string[]; relleno: boolean; sube: boolean; aletea?: boolean; luz?: boolean; papel?: boolean; aro?: boolean } {
  switch (ef) {
    case "mariposas": return { n: 22, tam: [44, 72], formas: dDe(SIMBOLOS.mariposas), relleno: true, sube: true, aletea: true };
    case "luciernagas": return { n: 40, tam: [5, 10], formas: [], relleno: true, sube: true, luz: true };
    case "petalos": return { n: 46, tam: [12, 22], formas: [PETALO], relleno: true, sube: false };
    case "corazones": return { n: 30, tam: [18, 32], formas: dDe(SIMBOLOS.corazones), relleno: true, sube: true };
    case "estrellas": return { n: 34, tam: [12, 24], formas: dDe(SIMBOLOS.estrellas), relleno: true, sube: false };
    case "brillos": return { n: 40, tam: [10, 22], formas: [DESTELLO], relleno: true, sube: false, luz: true };
    case "hojas": return { n: 32, tam: [16, 26], formas: dDe(SIMBOLOS.hojas), relleno: true, sube: false };
    case "copos": return { n: 40, tam: [12, 22], formas: dDe(SIMBOLOS.copos), relleno: false, sube: false };
    case "burbujas": return { n: 30, tam: [10, 26], formas: [], relleno: false, sube: true, aro: true };
    case "confeti": return { n: 130, tam: [6, 11], formas: [], relleno: true, sube: false, papel: true };
    case "ninguno": return { n: 0, tam: [0, 0], formas: [], relleno: false, sube: false };
  }
}

/** Datos del efecto para el JSON de la página (`null`: sin efecto). */
export function datosEfecto(inv: Pick<Invitacion, "efectoSobre" | "efectoPropio">, e: Pick<Estilo, "adorno" | "colores">, figurasB64: string[] = []) {
  if (inv.efectoSobre === "propio" && inv.efectoPropio && figurasB64.length) {
    return { tipo: "propio", ...recetaPropia(inv.efectoPropio.movimiento), formas: [], relleno: false, imgs: figurasB64.map((b) => `data:image/webp;base64,${b}`) };
  }
  const ef = efectoDe(inv, e);
  if (ef === "ninguno") return null;
  // Colores que se ven sobre el fondo y sobre la carta clara; el borde oscuro los despega de los dos.
  const c = e.colores;
  return { tipo: ef, ...receta(ef), colores: [c.acento, c.sello, c.claro, c.acento], borde: `color-mix(in srgb, ${c.tinta} 70%, #000)` };
}

/**
 * Script: `window.efectoSobre()` lo lanza desde el sobre. Con «reducir movimiento» salen menos y más
 * despacio (sigue viéndose: es corto y lo dispara la persona).
 */
export function scriptEfectoSobre(): string {
  return `(function(){var D=JSON.parse(document.getElementById('datos').textContent),R=D.efecto;if(!R)return;
var quieto=matchMedia('(prefers-reduced-motion: reduce)').matches,formas=R.formas.map(function(d){return new Path2D(d)});
var imgs=(R.imgs||[]).map(function(u){var im=new Image();im.src=u;return im});
var cs=R.colores,borde=R.borde||'#000';try{var t=document.createElement('canvas').getContext('2d');t.fillStyle='#000';t.fillStyle=borde;borde=t.fillStyle}catch(e){}
window.efectoSobre=function(){var sobre=document.querySelector('.sobre');if(!sobre)return;var c=document.createElement('canvas');c.className='confeti';c.setAttribute('aria-hidden','true');document.body.appendChild(c);
 var x=c.getContext('2d'),dpr=Math.min(2,devicePixelRatio||1),w=innerWidth,h=innerHeight;c.width=w*dpr;c.height=h*dpr;x.setTransform(dpr,0,0,dpr,0,0);
 var r=sobre.getBoundingClientRect(),ox=r.left+r.width/2,oy=r.top+r.height*.35,ps=[],n=Math.round(R.n*(quieto?.5:1)),vel=quieto?.6:1;
 for(var i=0;i<n;i++){var a=-Math.PI/2+(Math.random()-.5)*Math.PI*(R.sube?1.3:1.4),v=(R.sube?3.2:4.5)+Math.random()*(R.sube?3.4:4.5);
  if(R.aletea)v*=.55;
  ps.push({x:ox+(Math.random()-.5)*r.width*.6,y:oy+(Math.random()-.5)*20,vx:Math.cos(a)*v,vy:Math.sin(a)*v,s:R.tam[0]+Math.random()*(R.tam[1]-R.tam[0]),
   g:Math.random()*6.28,rot:Math.random()*6.28,vr:(Math.random()-.5)*.08,c:cs?cs[i%cs.length]:'#fff',f:formas.length?formas[i%formas.length]:null,im:imgs.length?imgs[i%imgs.length]:null,vida:(R.aletea?5200:3200)+Math.random()*2200,t:i*(R.aletea?45:18)})}
 var t0=performance.now(),ant=t0;
 (function paso(t){var k=Math.min(3,(t-ant)/16.7)*vel,vivos=0;ant=t;x.clearRect(0,0,w,h);
  for(var i=0;i<ps.length;i++){var p=ps[i],edad=t-t0-p.t;if(edad<0){vivos++;continue}if(edad>p.vida)continue;vivos++;
   p.g+=.12*k;if(R.sube){var vaga=R.aletea?.16:.06;p.vx=p.vx*.985+Math.sin(p.g*.7)*vaga*k;p.vy=p.vy*.985-(R.aletea?.008:.015)*k+(R.aletea?Math.cos(p.g*.5)*.05*k:0)}else{p.vx*=.99;p.vy=Math.min(p.vy+.09*k,2.4);p.x+=Math.sin(p.g)*.6*k}
   p.x+=p.vx*k;p.y+=p.vy*k;p.rot+=p.vr*k;
   var al=Math.min(1,edad/250)*Math.min(1,(p.vida-edad)/900);x.save();x.globalAlpha=al;x.translate(p.x,p.y);
   if(p.im){if(R.aletea){x.rotate(Math.atan2(p.vy,p.vx)+Math.PI/2);x.scale(.3+.7*Math.abs(Math.cos(p.g*2.2)),1)}else if(R.flota)x.rotate(Math.sin(p.g*.6)*.25);else x.rotate(p.rot);
    if(p.im.complete&&p.im.naturalWidth){var ih=p.s*p.im.naturalHeight/p.im.naturalWidth;x.drawImage(p.im,-p.s/2,-ih/2,p.s,ih)}}
   else if(R.luz&&!p.f){var gr=x.createRadialGradient(0,0,0,0,0,p.s*2.2);gr.addColorStop(0,D.claro);gr.addColorStop(.25,D.acento);gr.addColorStop(1,'rgba(0,0,0,0)');x.globalAlpha=al*(.55+.45*Math.sin(p.g*2));x.fillStyle=gr;x.beginPath();x.arc(0,0,p.s*2.2,0,6.29);x.fill()}
   else if(R.papel){x.rotate(p.rot);x.scale(1,Math.cos(p.g));x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/3,p.s,p.s*.66)}
   else if(R.aro){x.strokeStyle=D.claro;x.lineWidth=1.4;x.beginPath();x.arc(0,0,p.s/2,0,6.29);x.stroke();x.globalAlpha=al*.5;x.beginPath();x.arc(-p.s*.15,-p.s*.15,p.s*.12,0,6.29);x.fillStyle=D.claro;x.fill()}
   else{if(R.aletea){x.rotate(Math.atan2(p.vy,p.vx)+Math.PI/2);x.scale(.25+.75*Math.abs(Math.cos(p.g*2.2)),1)}else x.rotate(p.rot);
    var e=p.s/24;x.scale(e,e);x.translate(-12,-12);x.lineWidth=1.6/e;x.lineJoin='round';x.lineCap='round';
    if(R.luz){x.shadowColor=D.acento;x.shadowBlur=10}
    if(R.relleno){x.fillStyle=p.c;x.strokeStyle=borde;x.fill(p.f);x.stroke(p.f)}else{x.strokeStyle=p.c;x.lineWidth=2.2/e;x.stroke(p.f)}}
   x.restore()}
  if(vivos&&t-t0<9000)requestAnimationFrame(paso);else c.remove()})(t0)}})();`;
}
