# Decisiones del MVP

Lo que cambió respecto de `PRODUCTO.md` o del encargo, y por qué. Cada entrada dice la alternativa
elegida; nada de esto cambia el alcance en silencio.

## 1. La música la mezcla Geeper, no MPT

**Choque:** MPT elige la música al azar (`bgm_type: random`) y no registra cuál usó, así que no se puede
volver a mezclar después de quitar una escena o cambiar la voz, ni anotar su licencia.

**Decisión:** Geeper pide a MPT el video **sin música** (`bgm_type: ""`) y arma su propia mezcla con
ffmpeg: voz por escenas con fundidos de 15 ms, música en bucle con *ducking* (`sidechaincompress`) y
salida suave. La pista sale de la carpeta que diga la plantilla, se elige de forma estable por proyecto
y queda en `geeper.json` con su licencia. Los shorts que MPT ya había generado con música se importan
con su voz limpia (`audio.mp3`) y la música de la plantilla, no la original.

## 2. Licencia de la música de MPT: desconocida

El README de MPT dice que `resource/songs` viene de videos de YouTube («si infringe, bórrala»).
«GTA VI Shorts» la sigue usando para no cambiar el sonido del canal, pero cada asset dice
`licencia: desconocida` y el QC lo muestra como **aviso** (no bloquea). «Dimerso» va sin música.

**Propuesta (costo US$0):** bajar a mano una carpeta de música con licencia clara (por ejemplo, la
Biblioteca de audio de YouTube o pistas CC0) y apuntar `musica.carpeta` y `musica.licencia` de la
plantilla ahí desde la página Plantillas.

## 3. Voz al 0,85 para acercarse a ≤ 17 caracteres por segundo

**Choque:** la voz Kokoro `ef_dora` a velocidad 1 habla a ~17,2 car./s **de media** (medido en un short
de 47 s). Con eso ninguna agrupación deja todos los subtítulos en ≤ 17 car./s, que es la regla del QC.

**Decisión:** las plantillas piden la voz a **0,85** (`voice_rate` de MPT y `voz.velocidad`) y el
compilador:
- corta grupos de hasta 4 palabras como `mpt-acabado`, partidos para que quepan en 2 líneas,
- **suaviza el ritmo**: une grupos vecinos o les pasa una palabra mientras baje el exceso sobre
  17 car./s y sigan cabiendo en 2 líneas (un grupo puede cruzar un corte de escena),
- deja que cada grupo aparezca hasta 0,3 s antes si hay silencio y se quede hasta 0,6 s después,
- empieza cada video con **0,3 s de entrada** en silencio (la imagen ya se ve), así el primer
  subtítulo no queda a 19 car./s porque la voz arrancaba en el segundo 0.

El QC mide exactamente los mismos intervalos que anima el compilador (`intervalos()` en
`src/lib/linea.ts`).

**Medido** sobre 5 shorts reales de MPT (voz regenerada con el Kokoro de MPT):

| Velocidad | Aprobados por legibilidad | Peor pico |
|---|---|---|
| 0,9 | 1 de 5 | 17,44 car./s |
| 0,85 | 3 de 4 | 17,39 car./s (el que falla) |

**Pendiente del dueño:** con 0,85 un short de cada cuatro todavía queda apenas por encima (17,4). Las
salidas son (a) voz a 0,8, (b) aceptar 18 car./s para shorts con karaoke (el texto aparece al ritmo
de la voz, no hay que leerlo de corrido) o (c) dejarlo así y corregir a mano el guion de los que
fallen. La regla vive en `OBJETIVO.maxCps` (`src/lib/qc.ts`).

En 9:16 el subtítulo pasa de 74 a 60 px (24 caracteres por línea en una pastilla de 940 px) y en 1:1 a
58 px, para que quepan grupos más largos.

### 3 bis. Regenerar la voz: Kokoro de MPT, no el de Hyperframes

`hyperframes tts` (Kokoro-82M por kokoro-onnx) a 0,9 habla tan rápido como MPT a 1,0 y reparte peor
las pausas: necesitaría ~0,82 para pasar el QC. Por eso regenerar la voz usa `POST /api/v1/audio` de
MPT (sólo voz: Kokoro en CPU, sin LLM ni imágenes, sin GPU) y suena igual que el short original. El
motor `kokoro` (Hyperframes, con el venv del estudio en `HYPERFRAMES_PYTHON`) queda como alternativa por
proyecto si MPT no está levantado.

## 4. Los cortes de escena se ajustan a silencios y fin de frase

MPT reparte los clips cada 6 s sin mirar la voz. Geeper corta las escenas cerca de esos múltiplos,
pero en el límite entre palabras con más silencio y, si hay, en un punto o una coma (±2 s). Así quitar
o mover una escena no corta una palabra. Whisper suele dar tiempos contiguos, por eso el puntaje
premia la puntuación.

## 5. Render con NVENC si la GPU está libre; si no, CPU

El render pasa por `gpu-lock`, pero **sin esperar**: si la GPU está ocupada (por ejemplo, MPT generando
otro tema del lote), renderiza con libx264 y Chrome por software. Así reeditar nunca queda bloqueado
detrás de una generación. Chrome captura siempre por software en WSL (Hyperframes no ve
`/dev/dri/renderD128`): es como ya funcionaba `mpt-acabado`.

## 6. whisper.cpp corre en CPU

`hyperframes transcribe` compila whisper.cpp sin CUDA (`GGML_CUDA=OFF`), así que la alineación no
usa la GPU ni toma `gpu-lock`. `medium` tarda unos 30 s por un short de 47 s.

## 7. Detección de reinicio: Kernel-Power 41 + arranque de WSL + lease

Al arrancar, el worker busca eventos Kernel-Power 41 posteriores al último latido guardado y, además,
compara el arranque de WSL (`/proc/stat btime`) con ese latido, porque un reinicio limpio o un
`wsl --shutdown` no deja un evento 41. Si hubo reinicio, todo lo que estaba «corriendo» pasa a
«interrumpido». Sin reinicio, se mira el lease: los trabajos de GPU con lease vencido quedan
«interrumpidos» (nunca se reintentan solos) y los de CPU vuelven a la cola.

Revisión de Nemotron Ultra (2026-11-17), verificada contra el diseño:
- **Aceptado:** un trabajo «hecho» no se puede relanzar (evita que la cadena se bifurque); la huella
  del motor (`input_hash`) incluye la versión de ffmpeg y de Hyperframes; ancla de encuadre por clip.
- **Descartado:** quitar la consulta de Kernel-Power 41 (el encargo la pide; el lease ya es la
  evidencia principal); «ripple» manual de los clips (la posición en la línea de tiempo no se guarda,
  se deriva del orden); que el `flock` lo herede el render (es hermano del proceso que retiene el
  candado, no hijo); quitar `mostrar` (va por palabras, no por desplazamientos de texto).

## 8. Correcciones de subtítulos y regenerar la voz

Corregir un subtítulo guarda una corrección sobre las palabras **oídas** de la escena (índices), no
sobre el texto. Si después se regenera la voz y la escena dice exactamente las mismas palabras, las
correcciones se conservan; si el texto cambió, se descartan (los índices ya no valen) y hay que
volver a corregir.

## 9. Vista previa: el render, no `hyperframes preview` (superada por §14)

La vista previa del proyecto es el último render (aprobado o no). `hyperframes preview` abre un
servidor por proyecto y un estudio pensado para editar HTML, que en Geeper no se edita a mano. Se puede
abrir igual desde la terminal sobre `~/geeper-data/<proyecto>/build/hf-9x16`.

## 10. Duración en el QC: la del stream de video

El contenedor MP4 suma el relleno del códec AAC (unos 0,1 s), así que medir `format.duration` rechazaba
renders correctos. El QC mide la duración del stream de video contra la esperada (± 2 fotogramas) y
aparte exige que el audio no se aparte más de 0,15 s del video.

## 11. Pico real a −2 dBTP

`loudnorm` apunta a −2 dBTP (no −1,5): tras codificar en AAC el pico real sube unas décimas y con
−1,5 quedaba en −1,03, al borde de la regla de ≤ −1.

## 12. Puerto, datos y procesos

Web en `:3300`, worker aparte (`pnpm run worker`) y los dos juntos con `pnpm run dev:up`. Base SQLite y
proyectos en `~/geeper-data/`, fuera del repo. El worker no recarga código en caliente: tras cambiar
código, reinicia `dev:up` (reiniciarlo deja «interrumpido» lo que estaba corriendo). Si el worker muere
solo, `dev:up` lo vuelve a lanzar (hasta 5 veces en 10 min) y el barrido de leases marca
«interrumpido» lo que tenía. Un `kill -9` del worker deja huérfano el render de Hyperframes que estaba
corriendo: termina solo y su temporal nunca recibe el nombre final.

## 13. Entrega liviana: libx264 High CRF 20 sobre el máster de Hyperframes

**Choque:** el render `--quality delivery` de Hyperframes sale en H.264 Main a ~16 Mbps: un short de
57 s pesaba 115 MB, que es lento de subir y ocupa disco sin ganar calidad visible.

**Decisión:** el render de Hyperframes queda como máster (`build/crudo-<perfil>.mp4`) y el archivo
entregado se recodifica en la misma pasada que el `loudnorm` (`ENTREGA` en `src/lib/qc.ts`): libx264
`slow`, CRF 20, perfil High, keyframe cada 2 s, tope de 12 Mbps, etiquetas Rec.709 y AAC 192k sin PNS
(`-aac_pns 0`, de explainroo). Medido sobre el short de los barcos: **115 MB → 31,5 MB** (4,2 Mbps),
SSIM 0,992 frente al máster, 14 s de CPU, QC aprobado. CRF 18 daba 43 MB (SSIM 0,993) y CRF 22,
23 MB (0,991). No hay `libvmaf` en el ffmpeg local; si se instala, el criterio es VMAF ≥ 93.

Cada render deja también `v<N>-<perfil>.srt` con los mismos intervalos que anima el compilador, para
subirlo junto al video.

Origen: revisión de `zhuyansen/awesome-claude-video-skills` (2026-11-18). Lo heredado y lo
descartado está en `docs/HEREDADO.md`.

## 14. Vista previa en vivo con `<hyperframes-player>`

El editor tiene dos pestañas: «En vivo» y «Último render». «En vivo» compila la versión actual sin
renderizar (`src/lib/vista-previa.ts`: mezcla + compilación, ~0,8 s la primera vez y ~30 ms después,
cacheado por versión, compilador y plantilla en `build/vista-<formato>/`) y la reproduce con
`@hyperframes/player` 0.9.27, de la misma versión que el render. Al guardar una edición se ve al
instante; el QC y la descarga siguen siendo del render.

**Choque encontrado:** si la composición expone `window.__timelines`, el player la maneja «en directo»
(sólo GSAP) y no inyecta el runtime de Hyperframes, que es quien muestra y oculta cada clip: se veía
siempre el último clip. La vista previa enlaza una copia local de `@hyperframes/core` 0.9.27
(`hyperframe.runtime.iife.js`, sin CDN); el HTML del render no cambia. Verificado en Chrome headless:
listo en ~0,5 s, duración 57,44 s igual al render y saltos exactos con el mismo clip y subtítulo que el
render (`scripts/ui/vista-en-vivo.ts`).

Diferencias conocidas: el ajuste de línea de los subtítulos puede variar un poco por las fuentes del
navegador, y los clips de MPT tienen un keyframe cada 6 s, así que un salto tarda un instante más en
mostrar la imagen.

## 15. Esquema v2: pistas libres y textos aparte, migración en la lectura

**Decisión:** `geeper.json` pasa a `schemaVersion: 2` sin romper nada. Las pistas `visual`, `voz` y
`musica` siguen reservadas (un clip por escena, en orden); cualquier otra pista es **libre** y sus
clips llevan `inicio` en la línea final (superposiciones y efectos de sonido). Los textos superpuestos
van en un arreglo `textos` propio y no como pistas, para que toda pista tenga clips con asset y el
resto del código no cambie de tipos. `validarProyecto` migra v1 → v2 antes de validar, así las
versiones viejas guardadas en la base se leen igual; al guardar quedan en v2.

**Transiciones:** se montan sobre el final de la escena anterior (que se alarga lo que dura la
transición) en vez de comerle tiempo a la escena nueva: la voz no cambia de lugar. Escenas pares e
impares van en carriles distintos de Hyperframes. Sin transición propia ni movimiento, la escena
conserva el golpe de zoom de la plantilla; `corte` lo quita.

## 16. Edición por texto: recortes en tiempo del audio, no índices de palabras

Un recorte guarda `{ inicio, fin, motivo }` en tiempo del asset de voz, no índices: así sirve igual
para palabras, muletillas y silencios. Recortar palabras corta de la mitad del silencio anterior a la
mitad del siguiente (nunca se come una palabra vecina). La mezcla arma la voz por tramos con fundidos
de 15 ms; los subtítulos se recolocan en los tramos y una palabra cuyo centro cae en un recorte no se
muestra. La imagen de la escena sigue corrida (no salta): el material de MPT es B-roll sobre la voz.

Regenerar la voz descarta los recortes (sus tiempos eran de la voz anterior) pero **no** vuelve a decir
lo recortado: se sintetiza el texto sin esas palabras. No se puede recortar una escena entera (para eso
está «Quitar escena»).

## 17. Confianza de la alineación sin probabilidades de whisper

`hyperframes transcribe` (whisper.cpp) no da probabilidad por palabra (comprobado: sólo `text`,
`start`, `end`, `id`). La confianza se calcula con el parecido entre la palabra del guion y lo que oyó
whisper en ese tiempo, si cae dentro de un silencio (`silencedetect` −35 dB / 0,6 s) y si dura menos de
30 ms o más de 2 s. Menos de 0,6 es «dudosa»; con más del 20 % dudosas el QC bloquea (transcripción
fallida), si no, avisa. Los proyectos importados antes no tienen confianza («sin medir») hasta que se
regenera su voz.

## 18. Pulsos: se mueve la música, no los cortes

Los cortes los decide la voz (pausas y fines de frase). Para cortar al ritmo se elige desde qué segundo
empieza la música (hasta 30 s) para que más cortes caigan a ≤ 70 ms de un pulso. Los pulsos los da
`hyperframes beats`, que devuelve vacío si la pista no tiene pulso estable (comprobado con la música
actual de MPT: 0 pulsos; con un clic sintético a 120 BPM: 40 pulsos a 5 ms del real). El importador lo
intenta solo; el QC lo informa como aviso.

## 19. Licencias, plataformas, pico real, máster y pesos

- **Uso comercial** (`comercial: true`): el QC bloquea todo asset cuya licencia no se reconozca como
  comercial. Sin la marca sigue siendo aviso, como antes (la música de MPT, DECISIONES §2).
- **Plataformas** en 9:16: la banda segura es la intersección de lo que no tapa la interfaz de cada
  una (fracciones de explainroo, HEREDADO.md). Con TikTok la banda queda en x 119–864: los subtítulos
  pasan a menos caracteres por línea y marca y tarjeta final se centran en esa banda. Sin plataformas,
  todo queda como antes.
- **Pico real:** tras codificar, si el archivo pasa de −1 dBTP se limita el audio a 192 kHz y se
  recodifica sólo el audio (el video se copia), hasta 4 veces con un tope cada vez más bajo.
- **Máster:** con `entrega.master`, un segundo render de Hyperframes en MOV calidad alta, en CPU.
- **Pesos:** el sha256 de `ggml-medium.bin` y `kokoro-v1.0.onnx` entra en la huella de la alineación y
  en `regenerar` de cada voz, con caché por tamaño y fecha en `~/geeper-data/modelos.json`. Los modelos
  dentro del contenedor de MPT no se ven desde aquí.

## 20. Un paso hecho con otra ruta de salida se reutiliza

**Bug (venía de antes):** `paso()` daba por hecho un paso si las salidas *del manifiesto anterior*
seguían intactas, sin mirar si eran las rutas pedidas ahora. El render de entrega lleva el número de
versión en el nombre (`v<N>-<perfil>.mp4`): al renderizar una versión nueva con la misma imagen y el
mismo sonido (p. ej. después de «Volver a esta» o de cambiar sólo «uso comercial»), `entrega.loudnorm`
se saltaba y el QC fallaba porque `v<N>.mp4` no existía.

**Arreglo:** si el resultado ya existe con otra ruta, se enlaza (o copia) a la ruta pedida y el paso
sigue saltado. Medido: re-render de una versión sin cambios de imagen ni sonido en 6 s. Prueba en
`tests/reanudar.test.ts`.

## 21. Clips de material largo (G5 + E4), con lo útil de gtavi-claudecode

Revisión del kit Bodila51/gtavi-claudecode (MIT, Python, commit dd95d39) el 2026-11-19. Qué se tomó,
qué no y por qué (detalle de cada pieza en HEREDADO.md).

- **Puntuar primero sin transcribir.** Su `moments.py` transcribe el VOD entero con faster-whisper;
  aquí la sonoridad (dB por segundo menos su media móvil de 30 s), «lo más visto» de YouTube y el chat
  dan los candidatos en segundos aunque el VOD dure horas, y **sólo los candidatos** se transcriben
  (whisper `medium`) para ajustar los bordes a frases y sumar palabras de emoción en inglés y español.
  Medido con un material de 60 s: 22 s en total, un candidato. Transcribir un VOD de 4 h entero en CPU
  costaría ~1 h.
- **El visual sigue a la voz (`sincro: "voz"`).** En un clip la imagen y el audio son la misma
  grabación. Antes, el video de una escena corría seguido aunque se recortaran palabras: con stock da
  igual, con la cara de un streamer se desincroniza la boca. El compilador emite un tramo de video por
  cada tramo que suena, con el mismo desplazamiento sobre el asset; `velocidad` se ignora. No se guarda
  la lista de tramos (se deriva de los recortes, como el audio), así no hay dos verdades.
- **El reencuadre se hornea** como asset 1080×1920 con ffmpeg (paso con manifiesto). `regenerar`
  guarda todo para rehacerlo igual sin volver a detectar: modo, caja de la cámara, bordes, seguimiento
  de la cara, recorte, offset del juego, versión y sha256 de YuNet. Hacer la pantalla partida en el
  compilador no compensa hoy.
  - *react*: cara arriba (1080×730), juego abajo, corrido para no mostrar la cámara ni overlays fijos
    (contadores, alertas). Si no hay cara estable o fuera de la cámara no hay juego, cae a «contener».
  - *cara*: 9:16 a toda la altura siguiendo la cara (IRL o cámara a pantalla completa). Si la cara
    está en una webcam sobre el juego, se niega y sugiere *react*.
- **Tramo con 1 s de margen** a cada lado y un keyframe por segundo (vista en vivo, E1).
- **La voz es la del creador:** no hay música por defecto y `voz.regenerar` se niega en un clip.
- **Licencia «revisar»** salvo que se diga el permiso (`--permiso`, queda como «permiso del creador:
  …»). Con `comercial: true`, el QC bloquea un clip sin permiso.
- **Regla de QC «clip»** (bloquea): sin leaks, «jugar antes», piratería, trampas de dinero ni bots en
  título y textos; nunca «oficial»; crédito del creador presente; duración dentro de la campaña si se
  cargó (`--campania`). Los insultos racistas u homófobos se enmascaran en los subtítulos (vía
  `mostrar`); el audio no se toca.
- **Descartado:** grabar directos en vivo (`live.py`) y leer el chat de Twitch por IRC anónimo o su GQL
  con el Client-Id de la web (zona gris de los términos; sólo VODs ya publicados o archivos propios);
  traducir con Google Translate web y voces de edge-tts (servicios en línea: choca con «todo local»;
  D3 irá con un LLM local y Kokoro); su `cut.py` (Geeper ya compila, normaliza y hace QC); buscadores
  de campañas, trucos y secretos de GTA (contenido, no producto).
- **Segunda opinión (Nemotron Ultra):** aceptado puntuar sin transcribir, guardar todos los parámetros
  del recorte, contrato con versión y ping del puente Python, términos prohibidos en el QC y no grabar
  directos. Descartado: guardar `mapaVoz[]` en el esquema (duplica lo que dan los recortes), marca de
  agua obligatoria (decisión del dueño, no del producto) y portar su loudnorm (Geeper ya lo hace en
  dos pasadas con reintento del pico).
- **UI:** página Clips (buscar momentos como trabajo `clip.momentos`, radar de tendencias, «Hacer
  clip»), origen del clip y crédito en el editor, y la descripción del post sale con crédito, mención y
  hashtags de la campaña. «Seguir la cara» (trabajo `visual.reencuadrar`) sirve en cualquier proyecto
  9:16 y cambia el video en todas las escenas que lo usan.
- **Radar de tendencias** (de `trends.py`): YouTube por vistas por hora con yt-dlp, de a 6 pedidos en
  paralelo, guardado una hora por consulta. Excluye directos en curso.
- **Título legible:** el estilo `titulo` usaba la tinta de la plantilla (blanco) sobre el degradado de
  acentos y daba 1,8:1 en GTA VI Shorts (el `hyperframes check` lo bloqueaba). Ahora el compilador elige
  la tinta del título por contraste WCAG (≥ 4,5:1 con los dos acentos): casi negro en las dos
  plantillas actuales.
- **Verificado de punta a punta** (2026-11-19, base y datos aislados): clip react de 25 s de un material
  de 60 s → importar 35 s (reencuadre 6 s, whisper 15 s) → render y QC. Pasan sonoridad, pico, color,
  integridad, `hyperframes check`, alineación y la regla «clip»; la licencia avisa («revisar», sin
  permiso). El ritmo de subtítulos daba 17,4–17,8 car./s y bloqueaba; con la decisión siguiente el
  clip queda aprobado con ese aviso. También: búsqueda de momentos y creación de clip desde la API, reencuadre posterior
  (cubrir → react en las 3 escenas) y capturas de la UI a 1440 px y 390 px sin errores.
- **Ritmo de subtítulos en clips: aviso** (decisión del dueño, 2026-11-19). La voz es la del creador y
  no se puede frenar como la de Kokoro (§3): en clips, pasarse de 17 car./s es la regla de aviso
  «subtitulos-ritmo»; el largo de línea (≤ 42) y el número de líneas (≤ 2) siguen bloqueando. Los
  shorts propios no cambian.

## 22. Clips para quien no sabe nada de video (asistente de 3 pasos)

Decisiones del dueño (2026-11-19): asistente guiado, ganchos sugeridos con el modelo local, permiso con
casilla y la UX simple primero en clips (el resto de la app, después).

- **Paso 1, elige tu video:** pegar un enlace o arrastrar un archivo. La subida va en flujo (el
  cuerpo es el archivo, hasta 20 GB, sin cargarlo en memoria) a `~/geeper-data/_subidos/`. El idioma
  se pregunta en palabras («¿En qué idioma hablan?»); la duración mínima y máxima quedan en «Más
  opciones». El radar se ofrece como «¿No sabes qué video usar?».
- **Paso 2, elige un momento:** cada candidato trae una vista previa liviana (480p, 10 s de aire a
  cada lado) y una miniatura; el play reproduce sólo el momento. El puntaje se muestra como 1 a 3
  estrellas (por tercios) y los motivos en palabras («El chat explotó»).
- **Paso 3, ajusta y crea:** barras de inicio y fin sobre la vista previa, «Ver mi recorte», estilos
  con dibujo, «✨ Sugerirme ideas» y permiso con casilla (campaña, autorización escrita o video propio).
  El paso vive en la URL: recargar no saca del paso.
- **Ganchos con Ollama local** (`gemma4:26b` del stack de MPT, vía `docker exec`, sin abrir puertos):
  toma el candado de la GPU sin esperar (si está ocupada lo dice), descarga el modelo al terminar
  (`--keepalive 0s`) y filtra lo que devuelve: sin comillas (serían palabras en boca del creador), sin
  términos prohibidos, sin repetidos. Si Docker está apagado lo dice y el campo queda para escribir.
- **Motor apagado:** la página avisa si el worker no late hace más de 60 s y cómo encenderlo.
- **QC en palabras:** «¿Está listo para publicar?» con «Listo», «Listo, con cosas para mirar» o «Falta
  arreglar N cosas», y por cada una qué se revisa y qué hacer (`src/lib/qc-explicado.ts`). La tabla
  técnica queda plegada.
- **Marca:** en react la etiqueta de arriba tapaba los ojos del streamer y abajo no cabe (quedan 20 px
  entre los subtítulos y el borde de la banda segura; la etiqueta mide ~80). `marca: false` la quita
  durante el video (la tarjeta final la muestra igual); los clips react nacen así y el editor la
  enciende o apaga en «Destino».
- **Verificado:** subida por API (y rechazo de lo que no es video), análisis con vistas previas,
  sugerencias con Docker apagado (mensaje claro en 0,3 s), los 3 pasos a 1280 y 390 px, «Crear mi
  clip» con clics reales, el QC en palabras y un render react sin marca aprobado. En `next dev` dentro
  del worktree la página se recarga en bucle (también `/trabajos`, que no se tocó): las pruebas de UI
  se hicieron con `next build` + `next start`, donde no pasa.

## 24. Voz nueva: VoxCPM2 diseña una vez y después clona su propia muestra

Comparativa en MODELOS.md («Comparativa de modelos locales»). VoxCPM2 (Apache 2.0) porque con **un solo
modelo** diseña una voz desde una descripción y la repite clonando la muestra: el diseño cambia en cada
corrida, la clonación no (Nemotron Omni: mismo hablante, 9/10). Sin eso cada escena regenerada sonaría
a otra persona. Qwen3-TTS necesitaría dos modelos (VoiceDesign y Base).

- La persona **elige escuchando**, no por el nombre del modelo: tarjetas con «▶ Escuchar» y «Usar esta
  voz» (que ofrece poner la voz ya en todo el video). «Crear una voz nueva» propone 3 tomas; la elegida
  se guarda con nombre en `~/geeper-data/voces/<id>/` (muestra + transcripción) y sirve para cualquier
  proyecto (`motor: "voxcpm"` en `geeper.json`).
- Sólo voces inventadas: no se ofrece clonar a una persona real (pediría su consentimiento escrito).
- VoxCPM2 habla a 17–18 car./s: la velocidad del proyecto se aplica con `atempo` (conserva el tono).
- `torch.compile` falla en la RTX 5080 bajo WSL («CUDA error: unknown error»): se apaga
  (`TORCHDYNAMO_DISABLE=1`). Cargar el modelo tarda 60–95 s la primera vez, por eso regenerar el guion
  completo (una carga) conviene más que escena por escena.
- Toma el gpu-lock y espera su turno (~6 GB). Venv `~/dev/video-tools/venvs/voxcpm`.

## 26. Escenas 3D: plantillas de Blender, el modelo local sólo elige ajustes

El dueño pidió (2026-11-25) poder hacer videos con Blender, con UI para quien no sabe nada, a partir de
`ahujasid/mcp-for-blender`. Ese repo es un puente MCP para que un asistente maneje un Blender **abierto**
(el complemento no arranca en `blender -b`); sirve para trabajar con Claude Code en el estudio
(`~/dev/video-tools/LEEME-BLENDER.md`), no dentro de la app. Decisiones del dueño (las recomendadas):

- **Plantillas + «Descríbelo y lo armo».** Cinco plantillas hechas con código en `py/blender/escena3d.py`
  (título, logo, producto en pedestal, fondo en bucle, caja sorpresa), sin modelos bajados. Al describir,
  el modelo local (llama.cpp) **no escribe Python**: devuelve plantilla, texto, estilo, movimiento y colores
  en JSON, que se validan; sin modelo o con la tarjeta ocupada, se eligen por palabras clave. Lo que la
  persona puso entre comillas manda sobre lo que proponga el modelo.
- **Sección «Escenas 3D» y «Escena 3D aquí» en cada escena del editor**; pedida desde el editor, al
  terminar se pone sola (versión nueva, se deshace en el historial).
- **Blender 5.2.5 LTS con un clic** (Windows zip, Linux tar.xz, macOS arm64 dmg), verificado con el
  `.sha256` de blender.org; GPL, se baja al instalar (no viaja dentro de Geeper). Siempre `blender -b
  --factory-startup`: no toca un Blender que la persona use aparte.
- **Generadores 3D de pago bloqueados** (Meshy, Tripo, Rodin, World Labs): se muestran con aviso de costo.
  De Poly Haven sólo se usa un HDRI de estudio CC0 (1,6 MB, sha256 fijo) para los reflejos; sin él, luz gris.
- Render con **Cycles en la GPU** (OptiX → CUDA → HIP → Metal; si no hay, CPU), con el candado de GPU y en la
  fila `mpt` (`escena3d.crear`). Cycles y no EEVEE porque corre igual sin pantalla en Windows, Linux/WSL y
  macOS. Cuadros PNG → MP4 H.264 con ffmpeg. Vista transform «Standard» para que el fondo salga del color
  exacto de la marca; la luz se ajustó para que no queme colores con fondos claros.
- Muestras de cada plantilla (`py/blender/previas/`) hechas en CPU con `scripts/previas-escenas3d.sh`.

