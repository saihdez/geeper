/**
 * `invitacion.json` → `index.html` de un solo archivo (CSS, JS, letras, foto y audio dentro) y su `.ics`.
 * Función pura: no lee disco ni red; `construir.ts` le pasa los recursos ya leídos.
 *
 * Todo texto de la persona pasa por `esc` (o va en el JSON de datos con `<` escapado) y los enlaces se
 * arman aquí con valores ya validados por el esquema: nada del usuario entra como HTML.
 */
import { ciudadDeZona, TIPOS_INFO } from "./catalogo";
import { instanteUTC, partesCuentaAtras, semanasDelMes, textosFecha } from "./calendario";
import { ics, mensajeConfirmacion, urlGoogleCalendar, urlMaps, urlReproductor, urlWaze, type Evento } from "./enlaces";
import type { Invitacion, Retoques } from "./esquema";
import { divisor, esquinas, estiloDe, pilaLetra, scriptParticulas, texturaFondo, type Estilo } from "./estilo";
import { cssEscenario, htmlEscenario, scriptEscenario, semillaDe } from "./escenario";

export interface Recursos {
  /** `@font-face` con las letras en base64 ("" si no hubo internet: quedan las del sistema). */
  fuentesCss: string;
  fotoB64?: string;
  musicaB64?: string;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Título del evento («Nuestra boda») y nombre largo para el calendario («Boda de Ana & Luis»). */
export function titulos(inv: Invitacion): { corto: string; largo: string } {
  const t = TIPOS_INFO[inv.tipo];
  const corto = inv.titulo ?? t.titulo;
  const largo = inv.tipo === "otro" ? `${corto} · ${inv.nombres}` : `${t.nombre} de ${inv.nombres}`;
  return { corto, largo };
}

export function armarEvento(inv: Invitacion): Evento {
  const inicio = instanteUTC(inv.fecha, inv.hora, inv.zona);
  const { largo } = titulos(inv);
  return {
    titulo: largo,
    descripcion: [inv.mensaje ?? TIPOS_INFO[inv.tipo].mensajes[0], inv.urlPublica].filter(Boolean).join("\n\n"),
    lugar: [inv.lugar.nombre, inv.lugar.direccion].filter(Boolean).join(", "),
    inicio,
    fin: inicio + (inv.duracionHoras ?? 5) * 3_600_000,
    uid: `${inv.slug}@invitaciones.geeper`,
  };
}

/** «Adeline & Marcos» → «A&M»; «Sofía» → «S». */
export function iniciales(nombres: string): string {
  const partes = nombres.split(/\s*(?:&|\by\b|\be\b|,|\+)\s*/i).map((p) => p.trim()).filter(Boolean);
  const letras = partes.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letras.join("&") || "♥";
}

/** URL donde quedará la portada para la vista previa de WhatsApp (sólo con la invitación publicada). */
export function urlOg(inv: Invitacion): string | null {
  if (!inv.urlPublica) return null;
  const base = inv.urlPublica.replace(/[?#].*$/, "").replace(/\/index\.html?$/i, "").replace(/\/?$/, "/");
  // ?v= cambia con cada guardado: WhatsApp vuelve a bajar la imagen en vez de usar la vieja.
  return `${base}portada-og.jpg?v=${Date.parse(inv.actualizada) || 0}`;
}

/** La imagen del enlace es el QR con dibujo (cuadrada) sólo si se pidió y ese QR lleva esta dirección. */
export function vistaPreviaQr(inv: Invitacion): boolean {
  return inv.vistaPrevia === "qr" && !!inv.urlPublica && inv.qrArte?.url === inv.urlPublica;
}

const ICONO = {
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  mapa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z"/></svg>',
  nota: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  corazon: '<svg viewBox="0 0 24 24" aria-hidden="true" class="corazon"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};

function css(e: Estilo): string {
  const c = e.colores;
  return `
:root{--fondo:${c.fondo};--fondo2:${c.fondo2};--tarjeta:${c.tarjeta};--tinta:${c.tinta};--claro:${c.claro};--acento:${c.acento};--sobre:${c.sobre};--sello:${c.sello};
--f-titulos:${pilaLetra(e.letras.titulos)};--f-texto:${pilaLetra(e.letras.texto)}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;background:var(--fondo)}
body{margin:0;min-height:100vh;background:${texturaFondo(e.fondo)}radial-gradient(120% 900px at 50% 0%,var(--fondo2),var(--fondo)) no-repeat var(--fondo);color:var(--claro);font-family:var(--f-texto);font-size:18px;line-height:1.55}
.pagina{position:relative;z-index:2;max-width:480px;margin:0 auto;padding:0 18px 96px;overflow-x:hidden}
canvas.particulas{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}canvas.particulas.delante{z-index:3}
.portada{position:relative}.esquina{position:absolute;width:118px;height:118px;pointer-events:none;opacity:.55}.esquina svg{width:100%;height:100%;fill:color-mix(in srgb,var(--acento) 30%,transparent);stroke:var(--acento);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.e1{top:14px;left:-10px}.e2{bottom:14px;right:-10px;transform:rotate(180deg)}
.portada{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:40px 0}
.pre{letter-spacing:.32em;text-transform:uppercase;font-size:.78rem;margin:0}
.script{font-family:var(--f-titulos);font-weight:400;line-height:1.1;margin:0}
.nombres{font-size:clamp(2.3rem,11vw,3.7rem);max-width:100%}
.sobre{position:relative;width:min(84vw,340px);aspect-ratio:3/2;margin:46px 0 10px;perspective:1000px;transition:margin-top .6s ease .3s}
.sobre-fondo{position:absolute;inset:0;background:color-mix(in srgb,var(--sobre) 80%,#000);border-radius:8px;box-shadow:0 22px 44px rgba(0,0,0,.38)}
.carta{position:absolute;left:6%;right:6%;top:6%;bottom:6%;z-index:1;background:var(--tarjeta);color:var(--tinta);border-radius:6px;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;transform-origin:50% 100%}
.carta img{width:100%;height:100%;object-fit:cover}
.carta .script{font-size:2.1rem}
.frente{position:absolute;inset:0;z-index:2;background:var(--sobre);clip-path:polygon(0 0,50% 55%,100% 0,100% 100%,0 100%);border-radius:8px}
.solapa{position:absolute;left:0;right:0;top:0;height:62%;z-index:3;background:color-mix(in srgb,var(--sobre) 88%,#fff);clip-path:polygon(0 0,100% 0,50% 100%);transform-origin:top center;transition:transform .7s ease,z-index 0s .35s}
.sello{position:absolute;left:50%;top:62%;z-index:4;width:76px;height:76px;margin:-38px 0 0 -38px;border:0;border-radius:50%;cursor:pointer;font-family:var(--f-titulos);font-size:1.5rem;color:color-mix(in srgb,var(--sello) 35%,#000);
background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--sello) 55%,#fff),var(--sello) 55%,color-mix(in srgb,var(--sello) 70%,#000));box-shadow:0 4px 10px rgba(0,0,0,.35),inset 0 0 0 5px color-mix(in srgb,var(--sello) 85%,#000);transition:opacity .3s,transform .3s}
.sello:focus-visible{outline:3px solid var(--claro);outline-offset:4px}
.pista{font-size:.85rem;letter-spacing:.08em;opacity:.85;margin:0}
.abierto .solapa{transform:rotateX(180deg);z-index:0}
.abierto .sello{opacity:0;transform:scale(.5);pointer-events:none}
.abierto .carta{z-index:5;transform:translateY(-34%) scale(1.08);box-shadow:0 18px 40px rgba(0,0,0,.45);animation:sale-carta 1.7s cubic-bezier(.22,.8,.24,1) .55s both}
@keyframes sale-carta{0%{z-index:1;transform:translateY(0) scale(1);box-shadow:none}52%{z-index:1;transform:translateY(-86%) scale(1);box-shadow:0 8px 18px rgba(0,0,0,.25)}53%{z-index:5}100%{z-index:5;transform:translateY(-34%) scale(1.08);box-shadow:0 18px 40px rgba(0,0,0,.45)}}
.desliza{font-size:.85rem;letter-spacing:.08em;margin:6px 0 0;opacity:0;transition:opacity .6s ease 2.4s}
.abierto .desliza{opacity:.85}.abierto .desliza span{display:inline-block;animation:baja 1.6s ease-in-out 3s infinite}
@keyframes baja{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
.abierto .pista{visibility:hidden}
.abierto .sobre{margin-top:min(40vw,170px)}
.cerrado .resto{display:none}
.tarjeta{background:var(--tarjeta);color:var(--tinta);border-radius:22px;padding:30px 22px;margin:26px 0;text-align:center;box-shadow:0 14px 34px rgba(0,0,0,.22)}
.arco{border-radius:min(190px,46vw) min(190px,46vw) 22px 22px;padding-top:clamp(58px,17vw,78px)}
.arco>h2{padding:0 6%}
.tarjeta h2{font-family:var(--f-titulos);font-weight:400;font-size:clamp(1.9rem,9.5vw,2.5rem);line-height:1.1;margin:0 0 10px}
h1,h2,.script,.mayus,caption,.pre{text-wrap:balance}
.tarjeta p{overflow-wrap:break-word}
.adorno{width:150px;height:16px;fill:none;stroke:var(--acento);stroke-width:1.5;display:block;margin:6px auto 14px}
.adorno .relleno{fill:color-mix(in srgb,var(--acento) 35%,transparent);stroke-linecap:round;stroke-linejoin:round}
.mayus{letter-spacing:.24em;text-transform:uppercase;font-size:.8rem}
.grande{font-size:1.25rem;font-weight:600}
.botones{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:16px}
.boton{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 20px;border-radius:999px;border:1.5px solid var(--tinta);color:var(--tinta);background:transparent;text-decoration:none;font:inherit;font-size:.95rem;cursor:pointer}
.boton.lleno{background:var(--tinta);color:var(--tarjeta)}
.boton svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.boton:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--acento);outline-offset:2px}
table.mes{margin:10px auto 0;border-collapse:collapse;font-size:.95rem}
.mes caption{font-family:var(--f-titulos);font-size:clamp(1.8rem,9vw,2.3rem);margin-bottom:6px}
.mes th{font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;padding:4px 6px}
.mes td{width:40px;height:38px;text-align:center;position:relative}
.mes .dia-evento{font-weight:700}
.mes .corazon{position:absolute;inset:2px 3px;width:auto;height:auto;fill:none;stroke:var(--acento);stroke-width:1.6}
.cuenta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
.cuenta div{border:1px solid color-mix(in srgb,var(--tinta) 25%,transparent);border-radius:14px;padding:10px 2px}
.cuenta b{display:block;font-size:1.9rem;line-height:1.1;font-variant-numeric:tabular-nums}
.cuenta span{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
.colores{display:flex;justify-content:center;gap:12px;margin:14px 0}
.colores span{width:46px;height:46px;border-radius:50%;border:2px solid color-mix(in srgb,var(--tinta) 30%,transparent)}
form{text-align:left;margin-top:14px}
label{display:block;font-size:.9rem;margin:12px 0 4px}
input[type=text],select,textarea{width:100%;min-height:46px;padding:10px 12px;border-radius:12px;border:1.5px solid color-mix(in srgb,var(--tinta) 35%,transparent);background:#fff;color:#111;font:inherit;font-size:16px}
fieldset{border:0;padding:0;margin:12px 0 0}legend{font-size:.9rem;margin-bottom:6px}
.opciones{display:flex;gap:10px}.opciones label{flex:1;margin:0;display:flex;align-items:center;gap:8px;min-height:46px;padding:0 12px;border-radius:12px;border:1.5px solid color-mix(in srgb,var(--tinta) 35%,transparent);cursor:pointer}
form .boton{width:100%;margin-top:18px}
.reproductor{width:100%;border:0;border-radius:12px;margin-top:12px}
.nota{font-size:.85rem;opacity:.85}
.pie{text-align:center;padding:30px 0 10px}.pie .script{font-size:2.6rem}
.musica{position:fixed;right:16px;bottom:16px;z-index:10;width:52px;height:52px;border-radius:50%;border:0;background:var(--acento);color:var(--fondo);box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;justify-content:center}
.musica[hidden]{display:none}
.musica svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.musica[aria-pressed=false]{opacity:.7}.musica[aria-pressed=false]::after{content:"";position:absolute;width:30px;height:2px;background:currentColor;transform:rotate(-45deg)}
.aparece{opacity:0;transform:translateY(26px);transition:opacity .6s ease-out,transform .6s ease-out}.aparece.visible{opacity:1;transform:none}
canvas.confeti{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:20}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.abierto .desliza span{animation:none}}
`;
}

function calendarioHtml(t: number, zona: string): string {
  const { mes, anio, dia } = textosFecha(t, zona);
  const mesNum = +new Intl.DateTimeFormat("en-US", { timeZone: zona, month: "numeric" }).format(t);
  const filas = semanasDelMes(anio, mesNum)
    .map((s) => `<tr>${s.map((d) => (d === null ? "<td></td>" : d === dia ? `<td class="dia-evento" aria-current="date">${ICONO.corazon}<span>${d}</span></td>` : `<td>${d}</td>`)).join("")}</tr>`)
    .join("");
  const dias = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => `<th scope="col">${d}</th>`).join("");
  return `<table class="mes"><caption>${esc(mes)}</caption><thead><tr>${dias}</tr></thead><tbody>${filas}</tbody></table>`;
}

/** Script de la página. Recibe los datos por JSON (no por interpolación de texto). */
function script(): string {
  return `(function(){
var D=JSON.parse(document.getElementById('datos').textContent);
var cuenta=${partesCuentaAtras.toString()};
var mensaje=${mensajeConfirmacion.toString()};
var reducido=matchMedia('(prefers-reduced-motion: reduce)').matches;
var b=document.body,audio=document.getElementById('audio'),btnM=document.getElementById('musica');
// Títulos que siempre caben: si una palabra no entra con la letra final, se achica ese título (hasta 55 %).
function ajustar(){document.querySelectorAll('.tarjeta h2,.nombres,.pie .script,.carta .script,.mes caption,.pre').forEach(function(e){if(!e.clientWidth)return;e.style.fontSize='';
 var t=0,base=parseFloat(getComputedStyle(e).fontSize);while(e.scrollWidth>e.clientWidth+1&&t++<14){e.style.fontSize=(base*Math.pow(.95,t))+'px'}})}
ajustar();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(ajustar);var rt;addEventListener('resize',function(){clearTimeout(rt);rt=setTimeout(ajustar,150)});
// Al abrir: la animación del sobre completa (2,3 s) y luego baja sola, suave, hasta la primera sección.
// Si la persona toca o desliza antes, se respeta lo que hizo.
function bajarA(el){var mano=false,fin=function(){mano=true};['touchstart','wheel','keydown'].forEach(function(n){addEventListener(n,fin,{once:true,passive:true})});
 setTimeout(function(){if(mano||!el)return;var y0=scrollY,y1=el.getBoundingClientRect().top+scrollY-Math.max(16,innerHeight*.08),dur=1600,t0=null;if(y1<=y0+4)return;
 (function paso(t){if(mano)return;if(t0===null)t0=t;var k=Math.min(1,(t-t0)/dur),e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;scrollTo(0,y0+(y1-y0)*e);if(k<1)requestAnimationFrame(paso)})(performance.now())},2500)}
function abrir(){if(b.classList.contains('abierto'))return;b.classList.add('abierto');b.classList.remove('cerrado');ajustar();
 if(!b.classList.contains('editor'))bajarA(document.querySelector('.resto>.tarjeta,.resto>section,.resto>footer'));
 if(audio){audio.play().then(function(){btnM.hidden=false;btnM.setAttribute('aria-pressed','true')}).catch(function(){btnM.hidden=false;btnM.setAttribute('aria-pressed','false')});}
 }
document.getElementById('sello').addEventListener('click',abrir);
if(btnM&&audio)btnM.addEventListener('click',function(){if(audio.paused){audio.play();btnM.setAttribute('aria-pressed','true')}else{audio.pause();btnM.setAttribute('aria-pressed','false')}});
var els=document.querySelectorAll('.aparece');
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}})},{threshold:.15});els.forEach(function(e){io.observe(e)})}else els.forEach(function(e){e.classList.add('visible')});
try{var zl=Intl.DateTimeFormat().resolvedOptions().timeZone;if(zl&&zl!==D.zona){document.querySelectorAll('.nota-zona').forEach(function(e){e.hidden=false})}}catch(e){}
var nums={dias:document.getElementById('c-dias'),horas:document.getElementById('c-horas'),minutos:document.getElementById('c-min'),segundos:document.getElementById('c-seg')};
var estado=document.getElementById('c-estado'),antes=null;
function tic(){var ahora=Date.now(),p=cuenta(D.inicio,ahora);nums.dias.textContent=p.dias;nums.horas.textContent=p.horas;nums.minutos.textContent=p.minutos;nums.segundos.textContent=p.segundos;
 if(p.listo){estado.textContent=ahora<D.fin?'¡Hoy es el día!':'Gracias por acompañarnos';if(antes===false||(antes===null&&ahora<D.fin))confeti();}
 antes=p.listo;}
if(nums.dias){tic();setInterval(tic,1000);}
function confeti(){if(reducido)return;var c=document.createElement('canvas');c.className='confeti';c.setAttribute('aria-hidden','true');document.body.appendChild(c);
 var x=c.getContext('2d'),w=c.width=innerWidth,h=c.height=innerHeight,cs=[D.acento,D.claro,D.tarjeta],ps=[];
 for(var i=0;i<140;i++)ps.push({x:Math.random()*w,y:-20-Math.random()*h*.5,v:2+Math.random()*3,g:Math.random()*6,r:4+Math.random()*5,c:cs[i%3]});
 var t0=performance.now();(function f(t){x.clearRect(0,0,w,h);ps.forEach(function(p){p.y+=p.v;p.g+=.1;x.fillStyle=p.c;x.fillRect(p.x+Math.sin(p.g)*12,p.y,p.r,p.r*.6)});
 if(t-t0<3500)requestAnimationFrame(f);else c.remove()})(t0);}
var f=document.getElementById('rsvp');
if(f)f.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(f);
 var txt=mensaje({evento:D.evento,nombre:String(fd.get('nombre')||''),asiste:fd.get('asiste')==='si',personas:Number(fd.get('personas')||1),nota:String(fd.get('nota')||'')});
 var url='https://wa.me/'+D.whatsapp+'?text='+encodeURIComponent(txt);var w=window.open(url,'_blank');if(w){try{w.opener=null}catch(e){}}else location.href=url;});
})();`;
}

/**
 * Los textos de la página que se pueden corregir a mano, con lo que Geeper pone en cada uno.
 * Las claves son estables: un retoque guardado se aplica mientras su `base` siga siendo esa.
 */
export function basesDe(inv: Invitacion): Record<string, string> {
  const tx = estiloDe(inv).textos;
  const ev = armarEvento(inv);
  const f = textosFecha(ev.inicio, inv.zona);
  const { corto } = titulos(inv);
  const b: Record<string, string> = {
    pre: corto, nombres: inv.nombres, pista: tx.pista,
    saludo: tx.saludo, mensaje: inv.mensaje ?? TIPOS_INFO[inv.tipo].mensajes[0], firma: inv.nombres,
    fecha: f.fecha, hora: f.hora, "btn-gcal": "Google Calendar", "btn-ics": "Agregar al calendario",
    faltan: tx.faltan,
    ubicacion: tx.ubicacion, lugar: inv.lugar.nombre, "btn-mapa": "Cómo llegar",
    rsvp: tx.rsvp, "btn-wa": "Enviar por WhatsApp",
    "pie-nombres": inv.nombres, "pie-fecha": f.fecha,
  };
  // Sólo los textos que están en la página (sin foto en el sobre, con canción, con código de vestimenta…).
  if (!inv.foto) b.carta = corto;
  if (urlReproductor(inv.musica)) Object.assign(b, { cancion: tx.cancion, "cancion-nota": "Toca ▶ para escucharla" });
  if (inv.dressCode.colores.length || inv.dressCode.estilo || inv.dressCode.evitar) b.dress = tx.dress;
  if (inv.regalos) b.regalos = tx.regalos;
  if (inv.hashtag) b.comparte = "Comparte";
  if (inv.lugar.direccion) b.direccion = inv.lugar.direccion;
  if (inv.dressCode.estilo) b["dress-estilo"] = inv.dressCode.estilo;
  if (inv.dressCode.evitar) b["dress-evitar"] = inv.dressCode.evitar;
  if (inv.confirmarAntes) b["rsvp-limite"] = `Por favor, antes del ${textosFecha(instanteUTC(inv.confirmarAntes, "12:00", inv.zona), inv.zona).fecha}`;
  if (inv.pases) b["rsvp-pases"] = `Pases para ${inv.pases} ${inv.pases === 1 ? "persona" : "personas"}`;
  if (inv.regalos) b["regalos-texto"] = inv.regalos;
  return b;
}

/** Los retoques que siguen valiendo (su texto base no cambió) y los que ya no. */
export function retoquesVigentes(inv: Invitacion): { vigentes: Retoques; viejos: string[] } {
  const bases = basesDe(inv);
  const vigentes: Retoques = {};
  const viejos: string[] = [];
  for (const [k, r] of Object.entries(inv.retoques ?? {})) {
    if (bases[k] === r.base) vigentes[k] = r;
    else viejos.push(k);
  }
  return { vigentes, viejos };
}

/** Script del modo «Corregir a mano»: textos editables, botones para ocultar y avisos al editor de Geeper. */
function scriptEditor(): string {
  return `(function(){var b=document.body;b.classList.add('abierto','editor');b.classList.remove('cerrado');
document.querySelectorAll('.aparece').forEach(function(e){e.classList.add('visible')});
function enviar(m){m.geeper='retoque';parent.postMessage(m,'*')}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a,form button,#sello');if(a)e.preventDefault()},true);
document.addEventListener('submit',function(e){e.preventDefault()},true);
document.querySelectorAll('[data-ed]').forEach(function(el){el.contentEditable='plaintext-only';if(el.contentEditable!=='plaintext-only')el.contentEditable='true';
 el.spellcheck=true;el.setAttribute('role','textbox');el.setAttribute('aria-label','Texto: '+el.textContent.slice(0,40));
 el.addEventListener('keydown',function(e){if(e.key==='Enter'&&!el.hasAttribute('data-varias')){e.preventDefault();el.blur()}});
 el.addEventListener('paste',function(e){if(el.contentEditable==='true'){e.preventDefault();document.execCommand('insertText',false,(e.clipboardData||window.clipboardData).getData('text/plain'))}});
 el.addEventListener('input',function(){enviar({clave:el.dataset.ed,texto:el.innerText.replace(/\u00a0/g,' ').trim()})});});
document.querySelectorAll('[data-sec]').forEach(function(s){var bt=document.createElement('button');bt.type='button';bt.className='ed-ocultar';
 function pintar(){var o=s.classList.contains('ed-oculta');bt.textContent=o?'Mostrar esta parte':'Ocultar esta parte';bt.setAttribute('aria-pressed',o?'true':'false')}
 bt.addEventListener('click',function(){s.classList.toggle('ed-oculta');pintar();enviar({seccion:s.dataset.sec,oculta:s.classList.contains('ed-oculta')})});pintar();s.prepend(bt)});
})();`;
}

const CSS_EDITOR = `.editor [data-ed]{outline:1.5px dashed color-mix(in srgb,currentColor 45%,transparent);outline-offset:3px;border-radius:4px;cursor:text;min-width:1ch;display:inline-block}
.editor [data-ed]:hover{outline-color:currentColor}.editor [data-ed]:focus{outline:2px solid #06b6d4;background:color-mix(in srgb,#06b6d4 10%,transparent)}
.editor section[data-sec]{position:relative}.ed-oculta{opacity:.35}.ed-oculta>*:not(.ed-ocultar){filter:grayscale(1)}
.ed-ocultar{position:absolute;top:8px;right:8px;z-index:5;font:600 12px/1 system-ui,sans-serif;padding:7px 10px;border-radius:999px;border:0;background:#0f172a;color:#fff;cursor:pointer;opacity:.85}
.ed-oculta .ed-ocultar{background:#06b6d4;color:#00222a;opacity:1}`;

export interface OpcionesCompilar {
  /** Página para «Corregir a mano»: textos editables y las partes ocultas se ven atenuadas. */
  editor?: boolean;
}

export function compilar(inv: Invitacion, r: Recursos, ahora = Date.now(), op: OpcionesCompilar = {}): { html: string; ics: string } {
  const e = estiloDe(inv);
  const ed = !!op.editor;
  const escena = htmlEscenario(e, semillaDe(inv.slug));
  const bases = basesDe(inv);
  const { vigentes } = retoquesVigentes(inv);
  /** Texto con su clave: el retoque si sigue valiendo; en el editor, envuelto para poder escribirlo. */
  const t = (clave: string, varias = false) => {
    const texto = esc(vigentes[clave]?.texto ?? bases[clave] ?? "").replace(/\n/g, "<br>");
    return ed ? `<span data-ed="${clave}"${varias ? " data-varias" : ""}>${texto}</span>` : texto;
  };
  const ocultas = new Set<string>(inv.ocultas ?? []);
  const secciones: string[] = [];
  /** Una parte de la página: fuera si está oculta; en el editor, atenuada y con su botón. */
  const sec = (clave: string, html: string) => {
    const oculta = ocultas.has(clave);
    if (oculta && !ed) return;
    secciones.push(html.replace(/^<section ([^>]*?)class="/, `<section data-sec="${clave}" $1class="${oculta ? "ed-oculta " : ""}`));
  };
  const ADORNO = divisor(e.adorno);
  const ev = armarEvento(inv);
  const { largo } = titulos(inv);
  const f = textosFecha(ev.inicio, inv.zona);
  const ciudad = ciudadDeZona(inv.zona);
  const og = urlOg(inv);
  const reproductor = urlReproductor(inv.musica);
  const colores = inv.dressCode.colores.length ? inv.dressCode.colores : [];
  const datos = { inicio: ev.inicio, fin: ev.fin, zona: inv.zona, whatsapp: inv.whatsapp, evento: largo, acento: e.colores.acento, claro: e.colores.claro, tarjeta: e.colores.tarjeta };
  const maxPersonas = inv.pases ?? 6;
  const descripcionOg = `${f.fecha} · ${inv.lugar.nombre}`;

  sec("mensaje", `<section id="mensaje" class="tarjeta arco aparece"><h2>${t("saludo")}</h2>${ADORNO}<p>${t("mensaje", true)}</p><p class="script" style="font-size:2rem;margin-top:14px">${t("firma")}</p></section>`);
  if (reproductor) {
    const alto = inv.musica.tipo === "spotify" ? 152 : 200;
    sec("cancion", `<section class="tarjeta aparece"><h2>${t("cancion")}</h2>${ADORNO}<p class="nota">${t("cancion-nota")}</p><iframe class="reproductor" title="Canción de la invitación" src="${esc(reproductor)}" height="${alto}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></section>`);
  }
  sec("fecha", `<section class="tarjeta aparece" aria-labelledby="t-fecha"><h2 id="t-fecha" class="sr">Fecha</h2>${calendarioHtml(ev.inicio, inv.zona)}
<p class="grande" style="margin-top:14px">${t("fecha")}</p><p>${t("hora")} <span class="nota nota-zona" hidden>(hora de ${esc(ciudad)})</span></p>
<div class="botones"><a class="boton lleno" href="${esc(urlGoogleCalendar(ev))}" target="_blank" rel="noopener">${ICONO.cal}${t("btn-gcal")}</a><a class="boton" href="invitacion.ics" download="invitacion.ics">${ICONO.cal}${t("btn-ics")}</a></div></section>`);
  sec("cuenta", `<section class="tarjeta aparece" aria-labelledby="t-cuenta"><h2 id="t-cuenta">${t("faltan")}</h2>
<div class="cuenta" role="timer" aria-live="off"><div><b id="c-dias">0</b><span>días</span></div><div><b id="c-horas">0</b><span>horas</span></div><div><b id="c-min">0</b><span>min</span></div><div><b id="c-seg">0</b><span>seg</span></div></div><p id="c-estado" class="grande" style="margin:14px 0 0" aria-live="polite"></p></section>`);
  sec("lugar", `<section class="tarjeta aparece" aria-labelledby="t-lugar"><h2 id="t-lugar">${t("ubicacion")}</h2>${ADORNO}<p class="mayus">${t("lugar")}</p>${inv.lugar.direccion ? `<p>${t("direccion")}</p>` : ""}
<div class="botones"><a class="boton lleno" href="${esc(urlMaps(inv.lugar))}" target="_blank" rel="noopener">${ICONO.mapa}${t("btn-mapa")}</a><a class="boton" href="${esc(urlWaze(inv.lugar))}" target="_blank" rel="noopener">${ICONO.mapa}Waze</a></div></section>`);
  if (colores.length || inv.dressCode.estilo || inv.dressCode.evitar) {
    sec("dress", `<section class="tarjeta aparece" aria-labelledby="t-dress"><h2 id="t-dress">${t("dress")}</h2>${ADORNO}${inv.dressCode.estilo ? `<p class="mayus">${t("dress-estilo")}</p>` : ""}
${colores.length ? `<div class="colores" role="list" aria-label="Colores sugeridos">${colores.map((c) => `<span role="listitem" style="background:${c}" aria-label="color ${c}"></span>`).join("")}</div>` : ""}${inv.dressCode.evitar ? `<p class="nota">${t("dress-evitar")}</p>` : ""}</section>`);
  }
  const opcionesPersonas = Array.from({ length: maxPersonas }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  sec("rsvp", `<section class="tarjeta arco aparece" aria-labelledby="t-rsvp"><h2 id="t-rsvp">${t("rsvp")}</h2>${ADORNO}
${inv.confirmarAntes ? `<p class="nota">${t("rsvp-limite")}</p>` : ""}${inv.pases ? `<p class="nota">${t("rsvp-pases")}</p>` : ""}
<form id="rsvp"><label for="r-nombre">Tu nombre</label><input id="r-nombre" name="nombre" type="text" autocomplete="name" required maxlength="80">
<fieldset><legend>¿Asistirás?</legend><div class="opciones"><label><input type="radio" name="asiste" value="si" checked> Sí, ahí estaré</label><label><input type="radio" name="asiste" value="no"> No podré</label></div></fieldset>
<label for="r-personas">¿Cuántas personas?</label><select id="r-personas" name="personas">${opcionesPersonas}</select>
<label for="r-nota">Mensaje (opcional)</label><textarea id="r-nota" name="nota" rows="2" maxlength="300"></textarea>
<button class="boton lleno" type="submit">${ICONO.wa}${t("btn-wa")}</button></form></section>`);
  if (inv.regalos) sec("regalos", `<section class="tarjeta aparece"><h2>${t("regalos")}</h2>${ADORNO}<p>${t("regalos-texto", true)}</p></section>`);
  if (inv.hashtag) sec("comparte", `<section class="tarjeta aparece"><h2>${t("comparte")}</h2><p class="grande">#${esc(inv.hashtag.replace(/^#/, ""))}</p></section>`);

  const carta = r.fotoB64
    ? `<img src="data:image/webp;base64,${r.fotoB64}" alt="">`
    : `<p class="mayus" style="margin:0">${t("carta")}</p><p class="script">${esc(iniciales(inv.nombres))}</p>`;
  const audio = r.musicaB64 && inv.musica.tipo === "archivo"
    ? `<audio id="audio" src="data:audio/mpeg;base64,${r.musicaB64}" loop preload="auto"></audio><button id="musica" class="musica" type="button" aria-label="Música" aria-pressed="false" hidden>${ICONO.nota}</button>`
    : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(largo)}</title><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="${e.colores.fondo}">
<meta name="description" content="${esc(descripcionOg)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(largo)}"><meta property="og:description" content="${esc(descripcionOg)}">
${og ? `<meta property="og:image" content="${esc(og)}"><meta property="og:image:width" content="${vistaPreviaQr(inv) ? 800 : 1200}"><meta property="og:image:height" content="${vistaPreviaQr(inv) ? 800 : 630}"><meta property="og:url" content="${esc(inv.urlPublica!)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<style>${r.fuentesCss}${css(e)}${cssEscenario(e)}${ed ? CSS_EDITOR : ""}</style><noscript><style>.cerrado .resto{display:block}.aparece{opacity:1;transform:none}.sello,.pista{display:none}</style></noscript></head>
<body class="cerrado">${escena.fondo}<main class="pagina">
<section class="portada">${esquinas(e.adorno)}<p class="pre">${t("pre")}</p><h1 class="script nombres">${t("nombres")}</h1>
<div class="sobre"><div class="sobre-fondo"></div><div class="carta">${carta}</div><div class="frente"></div><div class="solapa"></div>
<button id="sello" class="sello" type="button" aria-label="Abrir la invitación">${esc(iniciales(inv.nombres))}</button></div>
<p class="pista">${t("pista")}</p><p class="desliza" aria-hidden="true">Desliza para ver más <span>↓</span></p></section>
<div class="resto">${escena.camino}${secciones.join("\n")}
<footer class="pie aparece"><p class="script">${t("pie-nombres")}</p><p class="mayus">${t("pie-fecha")}</p></footer></div>
</main>${escena.frente}${audio}
<script type="application/json" id="datos">${JSON.stringify(datos).replace(/</g, "\\u003c")}</script>
<script>${script()}${scriptParticulas(e)}${scriptEscenario(e)}${ed ? scriptEditor() : ""}</script></body></html>`;

  return { html, ics: ics(ev, ahora) };
}
