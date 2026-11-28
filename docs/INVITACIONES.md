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

### Tema a medida (hecho el 2026-11-27)

Paso 6 del formulario: la persona escribe una idea («un bosque encantado con luciérnagas») y toca
**Diseñar mi tema**. La IA local (`pedirJson`, con la tarjeta tomada un momento) elige, **sólo de listas
cerradas**, los 8 colores, una letra de títulos y una de texto (Google Fonts OFL), el adorno SVG de los
separadores y las esquinas, la animación del fondo (luciérnagas, estrellas, pétalos, hojas, nieve,
burbujas, destellos, confeti), la textura y los textos de cada sección; además propone el mensaje y el
dress code. La IA no escribe HTML ni CSS. Después `asegurarContraste` corrige tinta y texto claro hasta
4,5:1, y todo texto pasa por el mismo escape que el resto.

Si la IA no puede (tarjeta ocupada, modelo apagado, respuesta rara), `temaPorPalabras` arma uno con
las palabras de la idea (13 temas: bosque, mar, estrellas, princesas, invierno, jardín, otoño, gala,
halloween, rancho, safari, fiesta infantil, romántico) y se avisa. La persona puede ajustar 5 colores y
pedir **Otra versión**. **Ver cómo queda** muestra la invitación sin guardarla (`/api/invitaciones/vista-previa`).
Código: `tema.ts` (esquema, listas, contraste, respaldo), `estilo.ts` (estilo resuelto, adornos,
texturas, partículas). Con «reducir movimiento» las partículas van más lentas; con la pestaña oculta se pausan.

### QR con dibujo y foto del sobre con IA (hecho el 2026-11-27)

En la página de cada invitación (usan la tarjeta: van por la cola, con el aviso de guardar antes):

- **QR con dibujo del tema** (`invitacion.qr`): la receta de `qr-arte` en el ComfyUI de Geeper, sólo con
  nodos de fábrica (QR Code Monster v2 sobre DreamShaper 8, img2img desde el QR con corrección H, fuerza
  1,35 y ruido 0,9; «Que se lea mejor» = 1,5 y 0,85). Salen 6 versiones; cada una se lee con jsQR a
  768, 512, 384 y 256 px y **sólo se guardan las que devuelven la dirección exacta**, primero las que se
  leen en más tamaños. El dibujo sale de `tema.imagen` (la IA lo escribe en inglés) o de una tabla por
  tema y plantilla. Los modelos (2,8 GB) se bajan la primera vez. Si cambia la dirección publicada, el QR
  con dibujo se descarta (lleva la vieja adentro).
- **Foto del sobre** (`invitacion.foto`): Z-Image Turbo por Wan2GP, 4 tomas horizontales (1216×832), con
  la descripción de la persona y el estilo del tema. En el formulario se puede describir en vez de subir
  una foto: la descripción pasa a la página de la invitación y ahí se confirma.
- **El QR siempre es clicable**: en Geeper, tocarlo abre la invitación publicada. `qr.png` (el elegido o
  uno limpio de 1024 px) va en el zip y se puede descargar.
- **Dirección mal pegada**: si se pega la del panel de Netlify (`app.netlify.com/drop/<sitio>`), Geeper la
  cambia por `https://<sitio>.netlify.app/` y lo avisa.

### Corregir a mano (hecho el 2026-11-27)

«✏️ Corregir a mano» abre la invitación terminada en un iframe aislado (`srcDoc`, sólo `allow-scripts`).
Cada texto lleva una clave estable (`data-ed`) y se escribe en su lugar; cada parte (`data-sec`) tiene
«Ocultar esta parte». El iframe avisa con `postMessage` y Geeper guarda todo de una vez.

- Se guarda en `invitacion.json` como `retoques` (`clave → { texto, base }`) y `ocultas`. La página
  publicada no lleva nada del editor: sólo el texto final, escapado.
- `base` es el texto que Geeper había puesto ahí. Si después se cambia ese dato en «Cambiar datos», el
  retoque deja de valer y se avisa; los demás retoques se conservan.
- Fecha, hora y lugar se pueden reescribir (lo que se lee), pero el calendario, la cuenta atrás y los
  mapas siguen saliendo de los datos.

### Diseñarla en Avnac Studio (hecho el 2026-11-28)

Pedido del dueño: «Corregir a mano» que abra la invitación en Avnac Studio con todas las piezas. Avnac sólo
exporta imagen o PDF, así que quedaron las dos cosas: «Corregir textos» (la página interactiva) y «Abrir en
Avnac Studio» (el diseño para imprimir o compartir como imagen).

- `avnac.ts` arma el formato «v2» que acepta el «Import» de Avnac 0.4.1 (`parseV2WorkspaceImport`): una
  página de 1080×1920 por parte (portada, mensaje, fecha con cada día suelto, cuenta atrás, lugar, vestimenta,
  confirmación con el QR, regalos, hashtag, cierre), con textos, foto, QR, botones y adornos sueltos y con
  nombre. Respeta los retoques y las partes ocultas. Los adornos van como SVG con sus colores puestos.
- Avnac no abre archivos al arrancar: Geeper deja `<GEEPER_DATA>/Avnac/<nombre>.workspace.avnac`, abre Avnac
  y muestra el archivo en el explorador; la persona toca «Import» una vez. También se puede descargar.
- **De vuelta** («Traer los cambios de Avnac»): Geeper lee el diseño de la carpeta de Avnac
  (`<UserConfigDir>/avnac-studio/documents/<id>/pages.json`, el más reciente con el nombre del archivo) o un
  archivo exportado de Avnac. Cada pieza lleva el id `<parte>--<pieza>` (textos: `<parte>--ed-<clave>`), que
  Avnac guarda como `avnacLayerId`. Pasan a la página: textos (como retoques), partes borradas (se ocultan),
  colores lisos, letras de la lista cerrada y la foto del sobre; colores y letras convierten el estilo en
  tema. Posiciones y tamaños no pasan (la página se acomoda al teléfono) y se dice en pantalla.
- Los títulos se achican para que la palabra más larga quepa (Cinzel y otras letras anchas se miden más
  anchas). No se pudo correr el importador de Avnac aquí: la prueba revisa las mismas condiciones que su código.

### Modo inmersivo: el tema en toda la página (hecho el 2026-11-28)

Pedido del dueño: «si es bosque encantado, que esté leyendo todo a través del bosque, interactivo en todo
momento, que me lleve por las ramas o raíces». `escenario.ts`, para todas las invitaciones:

- Escenario por adorno: bosque (hojas, hongos, mariposas), jardín (flores, corazones), noche (estrellas,
  lunas), mar (ondas), invierno (copos), fiesta (globos), elegante (coronas, geométrico, clásico).
- Profundidad: dos capas fijas con parallax (acotado al largo de la página), troncos o columnas en los
  lados, ramas en las esquinas que se mecen con el scroll rápido; rayos de luz en bosque y jardín.
- Un camino (raíz, enredadera, constelación, corriente, huellas, filigrana, serpentina) que se dibuja con el
  scroll y cruza de un lado al otro entre las tarjetas; brotan los adornos del tema y cada tarjeta sale del
  lado por donde llega el camino.
- Interacción: el dedo o el ratón es una linterna; tocar suelta adornos del tema.
- Capas: escenario 0, partículas 1, página 2, partículas de adelante 3, ramas 4; todo sin recibir toques y
  sin tapar el texto. SVG generado con semilla fija (el slug). 62 cuadros/s en un teléfono de 390 px.
- Con «reducir movimiento» (en iPhone: Ajustes → Accesibilidad → Movimiento) sólo se quedan quietos el fondo y las ramas; el sobre, las tarjetas, el camino y las chispas se animan igual porque son cortos y los dispara la persona.
- Al abrir el sello, la animación del sobre corre completa (~2,3 s) y luego la página baja sola, suave (1,6 s), hasta la primera sección. Si la persona toca o desliza antes, no se mueve.

### Datos del cliente con Google Forms (hecho el 2026-11-27)

En Invitaciones, «Pedirle los datos al cliente con Google Forms»: Geeper crea el formulario en la cuenta
de Google de la persona (Forms API v1, gratis), ella le manda el enlace al cliente y la respuesta arma la
invitación sola.

- **Permiso**: OAuth con PKCE, igual que YouTube (scopes `forms.body`, `forms.responses.readonly`,
  `openid email`). La vuelta es `/api/cuentas/callback/formularios`, para que la app de escritorio use su
  ventana de inicio de sesión. Usa la app `formularios` de `redes.json` o, si no hay, la de `youtube`
  (hay que activar Google Forms API y agregar ese redirect URI). El token va cifrado en
  `~/.config/geeper/google-formularios.json`.
- **Pedidos** en `<GEEPER_DATA>/invitaciones-formularios/<id>.json`, con el `questionId` de cada
  pregunta: las respuestas se leen por pregunta, no por título.
- **Respuesta → invitación** (`formularios.ts`): fecha y hora de Google se normalizan; lo opcional que
  no sirve (mapa sin https, pases que no son número, canción no reconocida) se deja fuera con aviso; si la
  persona describió su idea, sale un tema por palabras clave (sin GPU; se puede rediseñar con IA en
  «Cambiar datos»). Si falla algo obligatorio, se guardan las respuestas y «Completar con sus respuestas»
  abre el formulario de Geeper ya lleno.
- Mientras la pantalla está abierta se buscan respuestas cada minuto (pedidos de los últimos 60 días). Si
  el cliente cambia su respuesta, se actualiza la misma invitación y se conservan los retoques a mano.

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
