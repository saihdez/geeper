# Invitaciones interactivas con un botón

Instrucciones para construir en Geeper un botón «Crear invitación» que deje lista una invitación
digital interactiva (página para el teléfono), su QR y un video corto para estados. Salen del
análisis de un tutorial de TikTok que hace lo mismo a mano en Canva (2026-11-27).

**Estado (2026-11-27):** v1 hecha. Menú **Invitaciones** y tarjeta en **Nuevo** → `/invitaciones/nueva`.
Código en `src/lib/invitaciones/`, `src/app/invitaciones/`, `src/app/api/invitaciones/`,
`src/components/{invitaciones,form-invitacion}.tsx`; pruebas en `tests/invitaciones.test.ts`. Falta §5
(video para estados) y la v2 de §6 (publicar con un clic). Diferencias con lo planeado: el `.ics`
usa `DTSTART` en UTC con `Z` (no `TZID`), el QR es SVG (`uqr`, MIT) y los datos viven sólo en disco
(`<GEEPER_DATA>/invitaciones/<slug>/`), sin tablas nuevas en la base.

---

## 1. Qué hace el video (y qué copiamos)

Tutorial de 74 s, 9:16. Arma en Canva una invitación de boda («Adeline & Marcos», vino y crema,
letra manuscrita) en 7 pasos, cada uno con una herramienta distinta:

| # | En el video | Cómo lo hace en Canva | Problema de hacerlo así |
|---|---|---|---|
| 1 | Sobre con sello de cera: «Haz clic en el sello para abrir» | Enlace del sello a la página 2 (sobre ya abierto, con foto) | Es un salto de página, no una animación |
| 2 | Canción (Spotify) | App «Embed» → pegar el enlace de Spotify, modo «Inserción» | No suena sola: hay que tocar el reproductor |
| 3 | Calendario del mes con el día marcado con un corazón | Elemento dibujado a mano | No se puede «agregar a mi calendario» |
| 4 | Cuenta atrás con confeti al final | Widget de indify.co pegado con Embed | Depende de un servicio externo |
| 5 | Ubicación: «Click para saber cómo llegar» | Enlace de Google Maps puesto en un texto | Bien; falta Waze |
| 6 | Dress code: 4 círculos de color + «Evitar el blanco y el rojo intenso» | Formas y texto | Bien |
| 7 | «Confirma tu asistencia» (nombre, ¿vienes acompañado?, sí/no) | Elemento Formulario de Canva | Las respuestas quedan dentro de Canva |

Remata con el resultado navegando en el teléfono y vende un taller («comenta INVITACIÓN»).

**La idea que vale:** una sola página vertical que se abre como un sobre y va bajando por bloques
(música → fecha → cuenta atrás → lugar → vestimenta → confirmar). **Lo que mejoramos:** todo en un
archivo propio, sin Canva ni widgets de terceros; el sobre se anima de verdad; el toque del sello es
el gesto que deja sonar la música; la fecha se agrega al calendario; la confirmación llega por
WhatsApp, sin servidor. No copiamos el diseño de esa creadora: el sobre, el sello y el calendario son
recursos genéricos, y las plantillas de Geeper se diseñan aparte.

---

## 2. El botón: qué pide y qué entrega

### Lo que se pregunta (una pantalla, lo mínimo)

Obligatorio (5 campos):
1. **Tipo de evento:** boda · XV años · cumpleaños · bautizo · baby shower · graduación · otro.
2. **Nombres** (los novios, la quinceañera, etc.).
3. **Fecha y hora** + zona horaria (por defecto la de la PC; guardar la IANA, p. ej. `America/Caracas`).
4. **Lugar:** nombre + dirección *o* enlace de Google Maps pegado.
5. **WhatsApp para confirmar** (con código de país).

Opcional, plegado en «Más detalles» y todo con valor por defecto:
- Estilo (3 plantillas, ver §4; por defecto según el tipo de evento).
- Canción: enlace de Spotify o YouTube, *o* un audio propio.
- Foto(s) de portada.
- Mensaje («Con amor, ilusión y la certeza…»). Botón **«Escríbelo por mí»** que lo redacta con el
  modelo local según el tipo de evento y los nombres (3 opciones para elegir; regla de
  la UI para novatos: elegir, no escribir).
- Dress code: hasta 4 colores (por defecto, la paleta de la plantilla) y colores a evitar.
- Fecha límite para confirmar, número de pases, regalos (enlace o datos), hashtag.

Un solo botón grande: **«Crear invitación»**. Nada más que decidir.

### Lo que sale (en segundos, sin GPU)

En `<GEEPER_DATA>/invitaciones/<slug>/`:

| Archivo | Para qué |
|---|---|
| `invitacion.json` | Fuente de verdad editable (como `geeper.json`): se reabre y se cambia un dato sin rehacer nada |
| `index.html` | La invitación: **un solo archivo** con CSS, JS, letras e imágenes dentro |
| `invitacion.ics` | «Agregar a mi calendario». Archivo aparte junto al HTML y enlazado en relativo: Safari de iOS no abre bien los `.ics` en `data:` (en la vista previa local se usa un `blob:`) |
| `qr.png` | QR a la página publicada (con `~/dev/video-tools/bin/qr-arte`, verificado con zxing) |
| `portada-og.jpg` | 1200×630 para la vista previa al mandarla por WhatsApp. La hace el servidor con el Chrome headless que ya usa `marca-web.ts`, no el navegador del invitado |
| `invitacion.zip` | Lo que se sube a internet: `index.html`, `invitacion.ics`, `portada-og.jpg`. **Sin `invitacion.json`** (tiene datos que no hacen falta en público) |

Tras crearla, la pantalla muestra la invitación dentro de un marco de teléfono (iframe, 390×844) y
tres acciones: **Descargar**, **Hacer video para estados** (§5) y **Publicar** (§6).

---

## 3. La página: bloques en orden

Una columna de 390 px de ancho de diseño, que escala hasta 480 px y se centra en pantallas grandes.
Cada bloque aparece al hacer scroll (IntersectionObserver, una sola vez, 400–600 ms, `ease-out`).

1. **Portada / sobre.** Sobre cerrado, nombres arriba, sello de cera al centro, «Toca el sello para
   abrir». Al tocar: la solapa gira (`rotateX`, 700 ms), sale la tarjeta con la foto y empieza la
   música. Ese toque es el gesto que el navegador exige para reproducir audio: aprovecharlo.
2. **Música.** Botón flotante de pausa/sonido siempre visible. Con audio propio: `<audio>` dentro del
   archivo. Con Spotify/YouTube: su reproductor embebido (`open.spotify.com/embed/track/<id>`,
   `youtube-nocookie.com/embed/<id>`); ese no arranca solo y se dice «Toca ▶ para escuchar nuestra
   canción».
3. **Mensaje** con los nombres.
4. **Fecha:** calendario del mes generado por código (semana empieza en domingo o lunes según el
   idioma) con el día marcado; debajo la fecha en letras y la hora. Botones **«Agregar a Google
   Calendar»** (`calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=<inicio>Z/<fin>Z&location=…`,
   fechas en UTC con `Z`; si no se dio hora de fin, inicio + 5 h)
   y **«Agregar al calendario»** (el `.ics`, que abre Apple/Outlook).
5. **Cuenta atrás:** días · horas · minutos · segundos. El servidor convierte fecha + zona IANA a un
   instante UTC y lo escribe en el HTML como número (ms); el navegador sólo resta `Date.now()`. Para
   mostrar la hora se usa `Intl.DateTimeFormat` con `timeZone` del evento, así un invitado en otro
   país ve la hora del lugar (y se aclara «hora de Caracas» si su zona es distinta). Al llegar a cero: confeti (canvas, 3 s, una vez) y texto «¡Hoy es el día!».
   Pasada la fecha: «Gracias por acompañarnos».
6. **Ubicación:** nombre del lugar, dirección, botones **Google Maps**
   (`google.com/maps/search/?api=1&query=<dirección codificada>` o el enlace pegado) y **Waze**
   (`waze.com/ul?q=…&navigate=yes`). Sin mapa embebido: pesa y pide cookies.
7. **Dress code:** círculos con los colores, nombre del estilo («Formal», «Cóctel»…) y los colores a
   evitar.
8. **Confirmar asistencia:** nombre, ¿cuántos van? (hasta los pases), ¿asistirás? sí/no, mensaje
   opcional. Al enviar abre `https://wa.me/<número>?text=<mensaje armado>` («Hola, soy Ana. Confirmo
   que SÍ asistiré, somos 2. ¡Felicidades!»). Sin servidor, sin costo, llega directo al anfitrión.
   Mostrar la fecha límite si la hay.
9. **Opcionales** (sólo si se llenaron): regalos, hashtag, galería de fotos.
10. **Pie:** nombres y fecha otra vez.

### Reglas técnicas de la página

- **Autocontenida:** cero peticiones externas salvo los reproductores de Spotify/YouTube y los
  enlaces. Letras de Google Fonts (licencia OFL) descargadas y metidas como `woff2` en base64, sólo
  con los caracteres latinos. Imágenes reescaladas a 1080 px de ancho como máximo y en WebP.
- **Peso:** < 1,5 MB sin audio propio; < 5 MB con audio. El servidor recorta el audio con el ffmpeg
  de Geeper (`FFMPEG` de `rutas.ts`): 60–90 s, mp3 96 kbps, fundido de entrada y salida.
- **Música y derechos:** por defecto el reproductor de Spotify/YouTube (la canción la sirve quien
  tiene los derechos). El audio propio dentro de una página pública es copiar la canción: la app pide
  marcar «tengo permiso para usar este audio» (música propia, libre o con licencia) antes de aceptarlo.
- **Todo texto del usuario se escapa** (nombres, mensaje, lugar): se inserta con una función de
  escape HTML o como `textContent`, nunca como HTML. Los enlaces sólo `https:`; el número de WhatsApp
  sólo dígitos. Los IDs de Spotify/YouTube se validan con regex antes de armar la URL del iframe.
- **Accesible:** el sello es un `<button>` con texto; contraste AA (≥ 4,5:1) del texto sobre el fondo;
  la letra manuscrita sólo en títulos, nunca en datos (fecha, dirección); objetivos táctiles de
  44 px; `prefers-reduced-motion` quita el giro del sobre y el confeti; el formulario con `<label>`.
- **Privada por defecto:** `<meta name="robots" content="noindex,nofollow">`. Avisar en la app que
  quien tenga el enlace ve el lugar y el WhatsApp del anfitrión.
- **Vista previa al compartir:** `og:title` («Boda de Adeline & Marcos»), `og:description` (fecha y
  ciudad) y `og:image` (`portada-og.jpg`, URL absoluta: se completa al publicar).
- **Sin rastreadores ni analítica.**

---

## 4. Plantillas

Tres para empezar; cada una es un juego de variables CSS + ilustraciones SVG propias (sobre, sello,
marcos, adornos), no imágenes de terceros:

| Plantilla | Para | Paleta | Letras (OFL) |
|---|---|---|---|
| **Vino y oro** | Boda, XV | vino `#4a0d1a`, crema `#f3e9dc`, oro `#c9a24a` | Pinyon Script + Cormorant Garamond |
| **Jardín** | Bautizo, baby shower, boda de día | salvia, blanco hueso, rosa empolvado | Great Vibes + Lora |
| **Minimal** | Cumpleaños, graduación, corporativo | negro, blanco, un acento | Playfair Display + Inter |

La paleta se puede cambiar con la herramienta de paleta que ya existe (`src/lib/paleta.ts`,
`colores-marca.ts`) o tomando los colores de una foto (`paleta-imagen.tsx`). Revisar el contraste
después de cambiarla y, si no llega a AA, oscurecer el fondo de las tarjetas, no el texto.

Textos por tipo de evento en un catálogo (`catalogo.ts`): título («Nuestra boda», «Mis XV años»),
mensaje por defecto, etiqueta de pases. Español primero; el catálogo deja lugar para inglés.

---

## 5. Video para estados (opcional, el fuerte de Geeper)

Botón **«Hacer video para estados»**: 12–15 s, 1080×1920, con Hyperframes y la misma plantilla:
sobre que se abre → nombres → fecha → «Toca el enlace / escanea el QR» con el QR al final. Música:
la canción propia si la hay; si sólo hay Spotify, una pista libre de la biblioteca (no se puede
bajar la de Spotify). Va por la cola de trabajos como cualquier render y pasa el QC normal (zonas
seguras, legibilidad). No usa generación con IA: es animación de la plantilla.

---

## 6. Publicar (paso aparte, nunca automático)

La invitación necesita una URL pública y Geeper es local. Por fases:

- **v1:** «Descargar» deja el `.zip` y una guía de 3 pasos para subirlo gratis (Netlify Drop:
  arrastrar la carpeta; o Cloudflare Pages). Después se pega la URL en Geeper, que pone el `og:image`
  con la URL absoluta y hace el QR; hay que **volver a subir** el `index.html` actualizado (la app lo
  dice con un paso «Sube otra vez este archivo»). Recién entonces se comparte el enlace: si se manda
  antes, WhatsApp guarda la vista previa sin imagen.
- **v2 (decide el dueño):** publicar con un clic a una cuenta suya (Cloudflare Pages por
  `wrangler pages deploy`, o un subdominio de dimerso). Nunca sin confirmar: publicar es hacer
  pública la dirección y el teléfono.

---

## 7. Cómo se arma en el código

```
src/lib/invitaciones/
  esquema.ts      zod: Invitacion (tipo, nombres, fechaISO, zona, lugar, whatsapp, plantilla, …)
  catalogo.ts     tipos de evento y plantillas (textos por defecto, paletas, letras)
  enlaces.ts      puros: urlGoogleCalendar, ics, urlMaps, urlWaze, urlWhatsApp, idSpotify, idYoutube
  calendario.ts   puro: semanas del mes, cuenta atrás con zona horaria
  compilar.ts     invitacion.json → index.html (plantilla con escape; incrusta letras e imágenes)
  plantillas/     vino-oro/, jardin/, minimal/  (html base + css + svg)
  mensaje.ts      «Escríbelo por mí» con llm-local.ts (JSON, 3 opciones; si no hay modelo, del catálogo)
src/app/invitaciones/page.tsx          lista + «Crear invitación»
src/components/form-invitacion.tsx     formulario de §2 + vista en marco de teléfono
src/app/api/invitaciones/route.ts      POST crea, GET lista
src/app/api/invitaciones/[id]/route.ts GET, PATCH (cambiar un dato y recompilar), zip
```

- Entrada en el menú y en **Nuevo** como tercera tarjeta: «Invitación interactiva — Para bodas, XV,
  cumpleaños: se abre como un sobre, con música, cuenta atrás y confirmación por WhatsApp».
- Botón **«Borrar invitación»** que elimina su carpeta (fotos, teléfono, todo); lo publicado se
  borra aparte en el sitio donde se subió, y la app lo recuerda.
- `compilar` es una función pura (datos + plantilla → string): rápida y probable sin navegador.
- Sólo el «Escríbelo por mí» y el video tocan la GPU/la cola; crear la invitación no.

### Pruebas (vitest, sin GPU)

- Esquema: rechaza fecha pasada, WhatsApp con letras, enlace `javascript:`.
- El `.zip` no trae `invitacion.json`.
- `enlaces`: Google Calendar con fechas en UTC correctas para `America/Caracas` y `America/Mexico_City`;
  `.ics` válido (CRLF, `DTSTART` en UTC, `UID`, líneas ≤ 75 octetos); `wa.me` con acentos y emojis
  codificados; IDs de Spotify (`/track/<22 chars>`, con `?si=`) y YouTube (`youtu.be`, `watch?v=`,
  `shorts/`).
- `calendario`: mes que empieza en domingo/lunes, febrero bisiesto, cuenta atrás que cruza un cambio
  de horario.
- `compilar`: nombres con `<script>` salen escapados; el HTML no tiene URLs externas salvo las
  permitidas; peso bajo el límite; las 3 plantillas × 6 tipos compilan.
- Una prueba de navegador (Playwright, ya está en el repo) que abre el HTML a 390 px: toca el sello,
  el sobre se abre, la cuenta atrás cambia, el botón de confirmar arma el enlace correcto, axe sin
  errores serios.

---

## 8. Encargo listo para pegar

```
Lee docs/INVITACIONES.md completo, docs/PRODUCTO.md §2 y la memoria «UI para quien no sabe de
video». Construye la v1 del botón «Crear invitación» en Geeper tal como dice el documento:
§2 (formulario mínimo y salida), §3 (bloques y reglas técnicas), §4 (las 3 plantillas con SVG
propios; nada del diseño del video), §7 (estructura y pruebas). Deja fuera §5 (video) y la v2 de §6.

Reglas: otra sesión puede estar editando el repo (test -e antes de crear archivos, commitea sólo lo
tuyo). Nada de GPU para probar: el «Escríbelo por mí» se prueba con el modelo simulado y la caída
al catálogo. Verifica con pnpm typecheck, lint y vitest, y con la prueba de Playwright a 390 px.
Antes de dar por terminado, pide a Nemotron (razonar) que revise compilar.ts y enlaces.ts buscando
XSS y errores de zona horaria; verifica tú cada hallazgo. Commit local como saihdez, sin push.
Al final dime qué probar en la app (pasos cortos) y qué no pudiste comprobar.
```
