# Qué heredamos de otros proyectos de video

Revisión del 2026-11-18 de [zhuyansen/awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills)
(520 repos; se leyó el código de 10) y de los cinco del artículo «5 Best GitHub Repo for Claude Videos».
Las rutas son dentro de cada repo. Todo lo listado es local y gratis salvo que diga lo contrario.

## Ya hecho

| Qué | De dónde | Resultado |
|---|---|---|
| Entrega libx264 High CRF 20, GOP 2 s, tope 12 Mbps | Medición propia (halfsize da los umbrales SSIM/VMAF) | 115 MB → 31,5 MB, SSIM 0,992 (DECISIONES §13) |
| AAC sin PNS (`-aac_pns 0`) | vincentsch/explainroo `src/ffmpeg.js:87` (MIT) | Sin chasquidos en pasajes suaves |
| `.srt` junto a cada render | iart-ai/tiktok-video-skills (MIT) | Botón «Subtítulos (.srt)» en el proyecto |
| Sección Anuncios: resultados pass/fail/unknown con evidencia, specs sin límites congelados, marcos de copy como preguntas, conceptos distintos, diseño de pruebas | AgriciDaniel/claude-ads `ads/references/*`, `skills/ads-{create,creative,test}` (MIT) | `/anuncios`, ver `docs/ANUNCIOS.md` |

## Para Geeper actual (orden sugerido)

1. **Vista previa en vivo en el editor** (idea del Player de Remotion): mostrar `build/hf-*/index.html`
   en un iframe y hacer *seek* de la línea de tiempo. Ojo: los clips de MPT traen un solo keyframe cada
   6 s; en el navegador eso congela al saltar (hyperframes `skills/hyperframes/references/overlays.md:37`).
   Si se hace, recodificar los clips con `-g 30` al importar. El render no se ve afectado: extrae los
   fotogramas con ffmpeg (verificado: el QC nunca vio congelados).
2. **Pico real tras el AAC con reintento** (explainroo `src/ffmpeg.js:96-150`): medir el TP del archivo
   final y, si pasa de −1, `alimiter` a 192 kHz y recodificar (hasta 4 veces). Hoy apuntamos a −2 y
   medimos −1,86: margen corto.
3. **Texto del guion con tiempos de Whisper** (explainroo `src/align.js`): alinear por distancia de
   edición; el subtítulo conserva la ortografía del guion. Arreglaría «corrección perdida al regenerar la voz».
4. **Limpiar alucinaciones de Whisper** en el silencio final (hyperframes `captions.md:8-10`: descartar
   palabras que empiezan dentro de `silencedetect=noise=-35dB:d=0.6`; >20 % basura = transcripción fallida).
5. **`hyperframes check --caption-zone` y contraste WCAG** (hyperframes `lint-validate-inspect.md:30-115`):
   comprobar primero que 0.9.27 lo soporta.
6. **Zonas seguras por plataforma** (explainroo `src/project.js:33-35`, fracciones arriba/der/abajo/izq):
   TikTok .125/.20/.34/.11 · Shorts .15/.12/.35/.06 · Reels .14/.11/.35/.06. Hoy usamos una banda única.
   (2026-11-27: Shorts pasó a la guía oficial de YouTube, ver «Doory».)

## Para los clips de directos (Kick/Twitch)

Ninguno de los repos ingiere directos: el grabador con búfer y el chat (IRC de Twitch, websocket de Kick)
hay que hacerlos. Lo reutilizable, todo MIT:

- **Ventanas de 30 s cada 15 s, normalizadas al p95** con piso (ghost1412/shorts-generator
  `engine/game_moments.py`): `action = 0.4·pico + 0.35·movimiento + 0.25·dinámica`,
  `story = 0.5·texto + 0.25·dinámica + 0.25·movimiento`. Añadir `chat_n` (mensajes/s al p95 y su salto
  sobre una EMA).
- **Silencio y luego estallido:** `log1p(|energía − EMA|)·3` (mismo repo, `engine/analysis.py:622`).
- **Risa sin modelo:** ritmo 3–8 Hz de la envolvente + planitud espectral 300–4000 Hz
  (`engine/signals.py:17-82`). Peso bajo en juegos: los disparos la imitan.
- **Re-ranking con Ollama local** (`engine/highlight_rank.py`): puntaje 1–10, `complete`, `extend_end`,
  `trim_start`; mezcla 60 % LLM / 40 % señales; 8–60 s.
- **Rúbrica de ganchos en portugués, fácil de pasar al español** (pedroxcardoso/maquina-cortes-gta
  `references/ganchos.md`): descartar < 6/10; empezar 0,2 s antes del gancho.
- **Bordes:** inicio a comienzo de frase ±1,5 s, fin a `.?!` ≤ 3 s + 0,3 s, luego al silencio más cercano
  (AgriciDaniel/claude-shorts `scripts/snap_boundaries.py`). Umbral relativo al ruido, nunca dB fijos
  (louisedesadeleer/cut-video: piso p10 + 6 dB; proteger risas > piso + 10 dB).
- **Duplicados:** rechazar solapes > 50 % con uno mejor (WhiteTowerAI/cut-as-code).
- **Facecam y 9:16:** YuNet ONNX de OpenCV (230 KB), confianza ≥ 0,8 (las caras falsas de juegos dan
  0,6–0,75), EMA 0,3, salto > 0,2 del ancho = corte (shorts-generator `engine/analysis.py:356-433`).
  Diseño mitad streamer / mitad juego con subtítulo en la costura (maquina-cortes-gta `estilo-metade-metade.md`).
- **Cortar el VOD sin recodificar** al keyframe (técnica de LosslessCut) para sacar el tramo en segundos.

## gtavi-claudecode (Bodila51, MIT) — revisión 2026-11-19

Plugin de Claude Code en Python para sacar clips verticales de directos y videos de GTA 6 (16 skills,
13 scripts). Decisiones en DECISIONES.md §21.

| Pieza | Qué hace | En Geeper |
|---|---|---|
| `moments.py` | Puntaje por segundo: sonoridad, «lo más visto», chat, palabras de emoción | **Portado** a `src/lib/momentos.ts`, puntuando sin transcribir y transcribiendo sólo candidatos; bordes a frase |
| `facecam.py` | Webcam del streamer con YuNet + bordes estáticos; seguimiento de cara suavizado | **Copiado** a `py/facecam.py` (modelo con sha256 fijo, sin descarga en ejecución) |
| `cut.py` (layout react, `game_offset`) | Cara arriba, juego abajo, esquivando overlays fijos | **Portado** a `py/reencuadre.py`; el resto de `cut.py` no (Geeper compila, normaliza y hace QC) |
| `cut.py` (máscara de insultos) | Enmascara insultos en los subtítulos | **Tomado** sólo para insultos racistas, homófobos y capacitistas, vía `mostrar` |
| `check.py` + `rule-check` | Reglas de campaña y términos prohibidos | **Portado** como regla de QC «clip» (`src/lib/clips.ts`) |
| `hook-writer` | Fórmulas de gancho y títulos de reacción | **En la skill `geeper`**, en español |
| `learning-loop` | Una prueba por día, lecturas a 12/24/72 h, sólo números reales | **Diseño de D2** (BRECHAS.md) |
| `trends.py` | Videos recientes por vistas por hora (yt-dlp) | No por ahora: útil para elegir fuentes; se puede correr aparte |
| `streams.py`, `twitch.py`, `live.py` | Directos en curso (GQL de Twitch con el Client-Id de la web), chat por IRC anónimo, grabación de directos | **Descartado**: zona gris de términos y grabar directos ajenos |
| `translate.py`, `multilang` | Traducción con Google Translate web y voz con edge-tts | **Descartado**: servicios en línea; D3 irá local |
| `campaign-finder`, `payouts.py` | Campañas pagadas de Whop y registro de pagos | No: operación del canal, no producto. Las reglas de una campaña entran con `--campania` |
| `questions-to-posts`, `secrets-map`, `cheat-codes`, `playbook` | Contenido y rutina de una página de GTA 6 | No: contenido. Sus reglas duras (sin leaks, sin «oficial», acreditar siempre, no prometer ingresos) sí están en la skill y el QC |

## open-seo (every-app, MIT) — revisión 2026-11-20

Alternativa abierta a Semrush/Ahrefs (TanStack Start en Cloudflare o Docker), commit `af3f995`. Casi todo
su valor son datos de **DataForSEO, que se paga por consulta**, y SEO de sitios web; Geeper es un estudio
de video a US$0 cuyo único sitio (`sitio/`) es la página legal para la verificación de las apps de redes.

| Pieza | Qué hace | En Geeper |
|---|---|---|
| `src/shared/audit-issues.ts` | Registro de problemas de la auditoría: gravedad, explicación y cómo arreglarlo (`missing-title`, `duplicate-title`, `missing-meta-description`…) | **Portada la idea** a `src/lib/redes/revision-texto.ts`: en el panel de publicar, cada cuenta muestra «✓ listo» o lo que la red recortaría, ignoraría o rechazaría, con botón de arreglo cuando se puede (YouTube: `<` `>`, título > 70 que se corta, sin descripción, descripción > 5000 bytes, > 60 hashtags; TikTok e Instagram: 2200 caracteres; Instagram: > 30 hashtags o > 20 menciones bloquea). Avisa de títulos repetidos en la cuenta, en cualquier proyecto (`/api/cuentas/titulos`) |
| Skills `keyword-research`, `keyword-clustering` | Elegir temas por lo que la gente busca y por encaje con el negocio, no por volumen; no inventar métricas | **Hecho con fuente gratis**: «Lo que busca la gente en YouTube» (`src/lib/busquedas.ts`, autocompletado de YouTube, sin clave; país en `GEEPER_PAIS_BUSQUEDAS`, por defecto MX) al escribir el tema en /nuevo y en el radar de tendencias. No es API oficial: si falla, no se muestra nada. Sale a Google sólo el texto del tema. Sin volúmenes: open-seo los saca de DataForSEO (de pago) |
| Auditoría de sitio, Lighthouse, backlinks, rank tracking, visibilidad en IA, SEO local | Rastreador propio + DataForSEO + LLMs | **No**: SEO web o de pago; `sitio/` no compite en búsquedas |
| MCP y skills de SEO para agentes | Herramientas sobre su API | **No**: requieren una instancia de OpenSEO con clave de DataForSEO |
| Skills internas (`papercuts`, `test-audit`, `merge-ready`, `deslop`) | Flujo de trabajo del repo | **No por ahora**: `deslop` ya lo cubre la skill `humanizer`; las otras están atadas a su CI y su facturación |

## VoiceStudio (debpalash, AGPL-3.0) — revisión 2026-11-20

Estudio de voz local (clonar, diseñar, doblar, dictar y transcribir), v0.5.8, commit `1ceb6d7`. **Es
AGPL-3.0**: como con OpenMontage, Geeper no copia su código. Sólo se toman ideas, que se reescriben, y
el inventario de licencias de modelos (`docs/licensing/model-license-data.json`, 73 modelos). Su voz por
defecto (OmniVoice) tiene **pesos CC-BY-NC**: no sirve para uso comercial.

**Lo que Geeper ya tenía** (no se toca): su verificación del doblaje por ASR (`dub_qc.py`: volver a
transcribir la voz generada y medir la distancia de edición contra el texto) es lo que ya hace
`src/lib/confianza.ts` palabra por palabra. Su chequeo de señal (`audio_quality.py`: silencio, recorte,
muestras inválidas) lo cubren el QC de sonoridad y pico real y `silencedetect`. Su diccionario de
pronunciación (`pronunciation.py`) lo resuelven las reglas «Mostrar en pantalla otra cosa que la que se
oye»: el guion se escribe como se dice y la regla cambia lo que se lee (`GTA seis=GTA VI`). Un segundo
mecanismo para lo mismo sólo confundiría.

**Medido y descartado: separar la voz con Demucs antes de whisper** (su `dub_pipeline.py` usa
`htdemucs --two-stems vocals`). La idea era mejorar los tiempos de los clips con música de fondo (BRECHAS
E5). Prueba del 2026-11-20 con la voz y la música de «los faros más extraños del mundo» (47 s, 126
palabras), whisper `medium` a través de `transcribir()` de Geeper. Las columnas de error comparan el
inicio de cada palabra con el de la voz limpia:

| Audio | WER contra la voz limpia | Error de inicio, mediana / p90 | Dudosas |
|---|---|---|---|
| Voz + música al mismo nivel | 0 % | 140 / 370 ms | 1 |
| … separada con Demucs | 0 % | 140–150 / 410–450 ms | 0–1 |
| Voz + música 3 dB por encima | 0 % | 180 / 460 ms | 1 |
| … separada | 0 % | 140 / 390 ms | 1 |
| Voz + música 9 dB por encima | 0 % | 150 / 410 ms | 1 |
| … separada | 0 % | 140 / 360 ms | 2 |

Whisper `medium` ya aguanta la música instrumental y la separación no cambia nada que se note.
Separar cuesta 12 s en CPU por 47 s de audio (en GPU, menos de 3 s). Hace falta torch (~3 GB); el venv
de prueba quedó en `~/dev/video-tools/venvs/demucs`. Con torchaudio 2.11 hay que guardar con soundfile,
porque `demucs.separate` exige `torchcodec`. **Volver a medirlo** sólo si un clip real de directo (voces
encimadas, diálogo del juego) da muchas palabras dudosas. Esta prueba no cubre ese caso.

**Para BRECHAS G2 (voz nueva)**, del inventario de VoiceStudio. Verificar cada licencia en la tarjeta del
modelo antes de usarlo:

| Modelo | Licencia | Español | Lo que aporta | Contra |
|---|---|---|---|---|
| VoxCPM2 (openbmb) | Apache 2.0 | Sí (30 idiomas) | Clona y **diseña una voz desde una descripción**; 48 kHz nativos | GPU |
| Pocket TTS (kyutai) | CC-BY-4.0 (atribución), descarga con aceptación de términos | Sí (un modelo por idioma) | **Sólo CPU** y clona: mantiene «reeditar sin GPU» | Revisar los términos de la aceptación; la conversión de sherpa-onnx es no comercial |
| Ming-3.0-tts 0.5B (inclusionAI) | MIT | Sí (7 idiomas) | Liviano (~3 GB), clona, 44,1 kHz | Calidad sin medir |
| dots.tts-soar (rednote) | Apache 2.0 | Sí (24 idiomas) | De los mejores clonando; 48 kHz | ~9 GB de VRAM |
| MOSS-TTS v1.5 (OpenMOSS) | Apache 2.0 | Sí (31 idiomas) | Control de duración por token y pausas `[pause Ns]` | 8B: ~16 GB en bf16, no cabe junto a nada |
| Fun-CosyVoice3 0.5B | Apache 2.0 | Sí | Clona; ~5,4 GB | Instalación pesada (Matcha-TTS) |

Descartados por licencia: OmniVoice (CC-BY-NC), NLLB-200 (traducción, CC-BY-NC), OuteTTS (CC-BY-NC-SA),
IndexTTS 2.5 («other»), Supertonic-3 (OpenRAIL con condiciones). La conversión MLX de Chatterbox no
declara licencia (el original de Resemble es MIT; usar ése).

**Para G3 (efectos de sonido):** MOSS-SoundEffect v2.0 (Apache 2.0, código y pesos) genera efectos desde
una descripción en inglés, hasta 30 s a 48 kHz. Pesa 11,2 GB en bf16: hay que medir si cabe en los 16 GB
con `gpu-lock` antes de pensar en una biblioteca generada.

**Integrado el 2026-11-20** (DECISIONES §23–§25): «Hacer una versión en otro idioma», voces diseñadas con VoxCPM2 y efectos de sonido con MOSS-SoundEffect. Abajo, las ideas de origen.

**Para la Localización (PRODUCTO.md §4)**, ideas de su doblaje (reescritas en `src/lib/traducir.ts`):

- **Antes de sintetizar**, estimar cuánto durará cada frase traducida con los caracteres por segundo
  medidos en la voz del propio proyecto (mediana de lo ya generado; sin datos, ~15,5 car./s en español) y
  marcar las que no caben en su tramo. A ésas, pedirle a Claude una versión más corta con el mismo
  sentido (su `duration_planner.py`).
- **Después de sintetizar**, ajustar cada frase a su tramo (su `fit_planner.py`). Usar primero el
  silencio hasta la frase siguiente, dejando 50 ms. Acelerar sólo el audio hasta 1,2× (no se nota). Más
  allá, repartir entre audio (tope 1,5×) y video (tope 2× más lento). Una frase que queda corta se estira
  hasta 0,85× para no dejar un hueco mudo. Lo que no quepa, se recorta y se avisa.
- **Traducir con Claude Code** pasándole el guion completo, en orden y con el tiempo de cada frase, en
  vez de frase por frase.
- **QC del doblaje:** volver a transcribir la voz doblada y comparar con el texto traducido. Es la
  confianza de `confianza.ts` aplicada al idioma destino.

## Descartado

- **Remotion:** licencia de empresa paga para algunas organizaciones; Hyperframes ya cubre lo mismo con Apache-2.0.
- **Revideo:** MIT pero con telemetría PostHog; la API de render ya la cubre la cola.
- **MoviePy:** más lento que ffmpeg directo y suma Python al render sin ganancia.
- **Editly:** sin cambios desde mayo de 2025, un solo mantenedor. Queda la idea de un «borrador rápido»
  sin Chrome.
- **Motion Canvas:** sin versión estable desde 2024.
- **Manim** (MIT, activo): no ahora; sirve más adelante para clips de diagramas en Dimerso como «clip propio».
- Todo lo que usa ElevenLabs, HeyGen, Gemini, Veo o Google CSE: de pago.
- **Voz a ritmo 1,2 para shorts** (explainroo): choca con la regla de ≤ 17 car./s (DECISIONES §3).

## storytold (FilmCraft, EffectCraft, SoundCraft, craft-libs) — revisión 2026-11-18

Apps de escritorio en Rust (egui/wgpu), MIT o Apache-2.0, sin telemetría ni llamadas a IA de pago.
Todas en **alfa** según su propio ROADMAP: FilmCraft «~56 % listo», EffectCraft «~45 %», SoundCraft
«~40 %», con Linux/WSL poco probado. Tienen CLI sin interfaz (`<app>-cli`) y servidor MCP. Su exportación
usa códecs propios en CPU (H.264 sin NVENC en EffectCraft, ~0,7× tiempo real en FilmCraft): **no
reemplazan** a Hyperframes + ffmpeg/NVENC como motor de render.

**Hecho:** exportar a OpenTimelineIO (`src/lib/otio.ts`, `GET /api/proyectos/<id>/otio`,
`scripts/exportar-otio.ts`) para terminar a mano en FilmCraft, DaVinci Resolve o Premiere. Reproduce la
línea de tiempo del render (la primera escena cubre la entrada; un clip más corto que su escena vuelve a
empezar). Validado con la biblioteca oficial `opentimelineio` 0.18.1 en los 5 proyectos (pistas de igual
duración, assets existentes, rangos dentro del medio) y convertido a FCP 7 XML y EDL con los adaptadores
oficiales. No viajan: subtítulos animados (van en el `.srt`), chip, zoom de cortes, tarjeta final, fondo
desenfocado y ducking.

**Para después (rutas dentro de cada repo):**
- **Plantillas de motion graphics de EffectCraft:** `effectcraft-cli render --template x.ectemplate
  --values v.json --format prores --channels rgba` (docs/agents.md:385-397) para intros, rótulos y
  tarjetas con brillo, partículas o desenfoque de lente que CSS no logra; se superponen con ffmpeg. Requiere
  instalar Rust o un binario publicado para Linux, y fijar la versión.
- **Seguimiento de cara para la facecam:** EffectCraft `crates/track/src/face.rs` (MediaPipe Face
  Landmarker en Rust puro) y el suavizado gaussiano de trayectoria de FilmCraft
  `crates/render/src/vfx/temporal.rs:346`. El «Auto Reframe» de FilmCraft no detecta caras: no sirve.
- **Recorte de fondo y segmentación locales:** `craft-ai-integrations` (BEN2 + ViTMatte y SAM 2.1 sobre
  rten en CPU, `.onnx` de los autores): texto detrás del streamer.
- **Análisis de audio para momentos fuertes:** `soundcraft/crates/dsp` (`meter.rs:139` R128 con pico
  real 4×, `offline.rs:715` silencios, `offline.rs:580` transitorios). Sólo depende de rustfft.
- **Detector de cortes de escena** portable a TS: FilmCraft `crates/render/src/scene.rs:62-95`
  (rejilla de luma 32×18 + histograma de 16 niveles por canal, umbral frente a la mediana local).
- **Semántica de edición** (ripple, roll, slip, slide) como especificación: FilmCraft
  `crates/edit/src/lib.rs:310-1262`; base de tiempo exacta de 254 016 000 000 ticks por segundo.
- **Subtítulos y listas de corte:** `craft-libs/crates/captions` (SRT, VTT, ASS, TTML con ajuste a
  fotograma) y `crates/timeline` (FCPXML 1.9–1.11, EDL, OTIO).
- **Valores de referencia de exportación:** FilmCraft `crates/export/src/presets.rs:125-160` (TikTok,
  Reels y Shorts 1080×1920 a 8–12 Mbps y −14 LUFS); los nuestros quedan por debajo con CRF 20 y SSIM 0,99.

**Descartado:** usar sus códecs o su render como motor, la UI egui o su build wasm (es la app entera, no
una biblioteca), generar `.ecproj` a mano (esquema sin publicar), `--gpu` de EffectCraft bajo WSL2, y los
demás repos de la organización (Unreal, mocap, Kinect, TTS de 2020–2023, infraestructura, `craft-skills`
vacío, `cloud-worker` en nube de pago).

### FilmCraft 0.20.1 — segunda revisión 2026-11-19 (commit `ae0a71d`)

Sigue en alfa (~56 % «listo para trabajo real»). Cambio desde la revisión anterior: la exportación
H.264/HEVC puede usar NVENC en Linux (opcional). No cambia la conclusión: el compositor sigue siendo
Hyperframes.

**Hecho: el `.otio` se abre bien en FilmCraft.** Leído contra su lector (`crates/interchange/src/otio.rs`):
- Sin `metadata.filmcraft.settings`, FilmCraft crea la secuencia en **1920×1080**: un short 9:16 abría en
  horizontal. Ahora va el bloque `SequenceSettings` completo (tamaño del formato, fps). Todos sus campos
  son obligatorios en el deserializador; si falta uno, descarta el bloque sin avisar.
- El volumen de la música y de los efectos de sonido va como `metadata.filmcraft.gain_db` (0,16 lineal →
  −15,9 dB). Antes la música entraba a 0 dB y tapaba la voz.
- El fundido se llama «Cross Dissolve», el nombre que FilmCraft reconoce; con «Fundido» lo importaba
  igual pero con un aviso. El mapeo `in_offset: 0` es correcto: el compilador arranca el fundido en el
  corte y alarga la escena anterior (`StartAtCut` en FilmCraft).
- Validado con `opentimelineio` 0.18.1 en los 3 proyectos de `~/geeper-data` y con pruebas en
  `tests/otio.test.ts`, y con el binario real 0.20.1 (tarball de Linux con SHA256 verificado, sin
  instalar): `filmcraft-cli import x.otio --save-as p.fcproj` y `filmcraft-cli --project p.fcproj inspect
  sequence` dan 0 avisos, 0 archivos sin conexión, 1080×1920 a 30 fps, música a −15,92 dB, 7 marcadores y
  la misma duración (49,5 s; el de 16:9, 1920×1080 y 42,497 s). El `.srt` entra solo en una pista de
  subtítulos (35 subtítulos).

**Hecho: botón «Terminar en otro editor»** en la página del proyecto (`src/components/panel-otro-editor.tsx`,
`GET /api/proyectos/<id>/editor`, `src/lib/paquete-editor.ts`). Baja un `.zip` con el `.otio`, el `.srt`
de la versión actual y `LEEME.txt`, una guía de 3 pasos en español (menús reales de FilmCraft en español
y de Resolve, qué no llega, qué hacer si faltan archivos). Las rutas del `.otio` van a la carpeta de red
de WSL (`file://wsl.localhost/<WSL_DISTRO_NAME>/...`): un editor en Windows no ve `/home/...`. FilmCraft
las convierte en `//wsl.localhost/Ubuntu-24.04/...` (comprobado). Fuera de WSL quedan las de Linux.
**Sin probar:** abrirlo en FilmCraft o Resolve de Windows (lo hace el dueño).

**Revisado y descartado:**
- `crates/tts-text` (normalizar números, fechas y siglas antes del TTS): el español se recortó de su
  alcance, sólo hace inglés. Kokoro en español ya fonetiza con espeak-ng.
- Textos en pantalla como texto editable en FilmCraft: allí son capas gráficas (esquema v12,
  `LayerExtra`), no generadores. Siguen yendo como marcadores con su duración.
- Opacidad, movimiento y color como efectos de FilmCraft: la lista de `metadata.filmcraft.effects`
  **reemplaza** los efectos intrínsecos del clip. No se escribe sin poder probarlo con el binario.
- Su servidor MCP (`filmcraft-cli mcp`): útil para que un agente termine la pieza en FilmCraft, pero
  no hace falta para Geeper; las convenciones (anotaciones de sólo lectura, argumentos estrictos) quedan
  como referencia si algún día Geeper tiene MCP.

### PdfCraft 0.21.1 — revisión 2026-11-19 (commit `6de8335`)

Lector y editor de PDF en Rust (egui), MIT o Apache-2.0, sin telemetría. No trata video ni audio:
**no se integra como dependencia**. Sirven tres patrones suyos:

**Hecho:**
- **Archivos secretos verificados al leerlos** (idea de su archivo de control, que rechaza enlaces
  simbólicos, archivos de otro usuario y permisos abiertos): `src/lib/redes/archivo-privado.ts`. La
  clave de cifrado y `redes.json` se abren con `O_NOFOLLOW` y se validan con `fstat` sobre el mismo
  descriptor (archivo normal, del usuario, sin permisos para grupo ni otros). Antes, una clave con
  permisos 644 se usaba igual, y un `redes.json` ilegible se tomaba como «sin redes configuradas».
  Ahora los dos casos dan error con el arreglo (`chmod 600`). Pruebas en `tests/redes-nucleo.test.ts`.
- **Informe por paso** (como `pdfcraft-cli run --script --report`): `scripts/proponer.ts` dice en qué
  paso y por qué falla una lista de ediciones, omite los siguientes, no aplica nada y sale con código 1.
  `--informe` devuelve un solo JSON para agentes.

- **Aviso en lenguaje simple + «Protegerlos ahora»** en Cuentas y Sistema (`components/aviso-privados.tsx`,
  `lib/redes/privados.ts`, `POST /api/sistema/privados`): deja en 600 la clave y `redes.json` sólo si
  son archivos normales del usuario (nunca un enlace ni uno ajeno). Cuentas ya no dice «Faltan las
  credenciales» cuando el problema son los permisos.
- **Revisión guiada de palabras dudosas** (su «OCR Verify»), en la edición por texto: color según la
  confianza con leyenda (< 60 % dudosa, 60–80 % poco segura), «▶ Escuchar» de cualquier selección y
  «Revisarlas una por una»: suena el tramo y se elige «Sí, suena bien» (edición `confirmarPalabras`,
  confianza 1: deja de contar en el QC), «Recortarla», «Saltar» o «Terminar»; al acabar ofrece seguir
  con la próxima escena.
- **Buscador de acciones** (Ctrl+K / ⌘K o «Buscar acción» en la barra; `components/paleta.tsx`): ir a
  cualquier página y, dentro de un proyecto, renderizar, descargar, revisar dudosas, acortar silencios,
  quitar muletillas, cambiar formato o plantilla, alinear al ritmo, regenerar la voz o volver a la
  versión anterior (`components/acciones-proyecto.ts`). Busca sin tildes y por sinónimos.

**Para después:**
- **MCP de Geeper** con su diseño: una sola tabla de herramientas con JSON Schema compartida por la CLI
  y el MCP, que sólo arranca cuando la pide un agente (stdio, sin puertos), `--root` para limitar los
  archivos y `--compact` (unas diez herramientas más `tool_search` y `tool_call`). Las ediciones Zod ya
  son esa tabla.
- **OCR de texto deforme en imágenes generadas** (Q3 de BRECHAS.md): su `crates/ocr` (ocrs sobre rten,
  con Tesseract opcional y confianza por palabra). Requiere Rust o Tesseract; ninguno está en esta PC.

**Descartado:** el motor de PDF, la UI egui y el build wasm (no hay PDFs en el flujo de Geeper); sus
fuentes (Inter, JetBrains Mono, Dancing Script, OFL), porque las plantillas no las usan; y su auditoría
de licencias con sha256 (`LICENSES.toml`, `xtask license_check`), porque Geeper ya registra procedencia
y licencia por asset y el QC bloquea las no comerciales (Q1).

### LightCraft 0.21.1 — revisión 2026-11-19 (commit `976f52a`)

Revelador RAW y biblioteca de fotos en Rust puro (egui/wgpu, ~385 000 líneas), MIT o Apache-2.0, con
CLI sin interfaz y servidor MCP. Es de fotografía fija: **no se integra como dependencia** (sin Rust en
esta PC, y su export de video es AV1 por CPU, sin audio). Sirve una pieza y un patrón:

**Hecho: reencuadre automático por cara (E4 de BRECHAS.md).** De `crates/faces/src/known.rs` se toma el
manifiesto de YuNet 2023mar: dirección **fijada a un commit** de opencv_zoo, tamaño (232 589 bytes),
SHA-256, licencia (MIT) y su advertencia (entrenado con WIDER FACE, cuyos términos no cubre la licencia
de los pesos; detecta, no identifica). Su patrón de descarga (`crates/fetch`: archivo temporal, hash
comprobado, rename; si no coincide, se descarta) está en `src/lib/caras.ts`. La inferencia no es su
intérprete Rust sino `cv2.FaceDetectorYN` del venv `geeper-clips` (OpenCV 4.14), el mismo modelo.
- `py/caras.py`: hasta 40 muestras por clip, cara principal = mayor área × puntaje (≥ 0,8), EMA 0,3 que
  se reinicia si la cara desaparece, mediana; guarda `asset.foco` (centro, ancho, cobertura, dispersión).
- Compilador: si el clip no fija ancla y la cara es estable (en ≥ 50 % de las muestras, ≤ 60 % del ancho
  visible, se mueve < ¼ de lo visible), **cubre** el cuadro con la cara centrada y a 40 % del alto, en
  vez de contener con fondo desenfocado. Sin foco, el HTML sale idéntico al de antes.
- Corre solo al importar y al subir un clip propio. Los proyectos ya importados se analizan **una vez**
  al abrirlos (`POST /api/proyectos/<id>/caras`, resultados en `<proyecto>/caras.json` por sha256, así
  restaurar una versión vieja no los vuelve a cambiar). Si algo cambia, un aviso dice qué escenas y
  ofrece «Dejar como estaba». Por terminal: `scripts/analizar-caras.ts <slug> [--aplicar]`.
- Interfaz «¿Qué se ve?» por escena (`src/components/selector-encuadre.tsx`): la miniatura con un
  recuadro de lo que entra en el video y la cara marcada; opciones en palabras simples (Automático,
  Seguir la cara, El centro, La parte de arriba/abajo, Todo con fondo borroso), sólo las que cambian
  algo en ese clip; pasar el mouse o el foco muestra el recorte antes de elegir. El recuadro sale de
  `visibleDe`, la misma función que usa el compilador.
- Medido: 5 clips de paisaje en 4,7 s (sin cara, correcto). Un 16:9 con la cara a la derecha (x 0,728)
  renderizado en 9:16 con Hyperframes 0.9.27 deja la cara en x 0,487 del cuadro final.
- Pendiente: seguimiento dinámico (hoy es un punto fijo por archivo; para facecams que se mueven hace
  falta animar `object-position` con la trayectoria suavizada) y el foco por rango de tiempo, no por
  archivo entero.

**Para después:**
- **Manifiesto de modelo con licencia y aceptación** (`crates/faces/src/manifest.rs`, docs/faces.md): id,
  URL fijada, SHA-256, tamaño, licencia, «¿uso comercial?» (sí / no / desconocido) y procedencia de los
  datos de entrenamiento. Sirve para P1 de BRECHAS.md (registro de modelos con VRAM medida) cuando
  entren Chatterbox, Qwen3-TTS o Wan: hoy `src/lib/modelos.ts` sólo guarda la huella.
- **Herramientas MCP compartidas** (`command_list` / `command_run`, docs/mcp.md): misma convención que
  FilmCraft; junto a lo anotado en PdfCraft, es el diseño a seguir si Geeper tiene MCP.
- **Grano de película independiente de la resolución** (docs/grain.md): si una plantilla pide grano,
  primero mirar el bloque de grano de `hyperframes-registry`.

**Descartado:** SAM 3 (segmentación; licencia propia de Meta, revisar antes de usar), relleno PatchMatch,
reconocimiento facial (SFace, AuraFace: Geeper no necesita identificar a nadie), RAW, lentes, HDR,
panoramas, geocodificación, la presentación de diapositivas (Hyperframes ya hace más) y la pila de
actividad (la página Trabajos cumple ese papel).

### VectorCraft 0.24.1 — revisión 2026-11-19 (commit `54f58ff`)

Editor de ilustración vectorial en Rust (egui/wgpu), MIT o Apache-2.0, sin telemetría ni IA de pago.
Alfa (~65 % «listo para trabajo real» según su ROADMAP). Trae `vectorcraft-cli` sin ventana: `convert IN
OUT` (abre SVG, PDF, `.ai`, EPS, DXF, EMF, Affinity y rasters; escribe SVG, PDF, PNG, JPEG, WebP, PSD…),
`run --commands pasos.json --export x.svg` (la misma API de comandos que su MCP, con renderizador en CPU),
`info` y `mcp --headless` con `--automation-read-root/--automation-write-root`. No trata video: **no
reemplaza** a Hyperframes ni a PhotoCraft (las portadas, D1, ya van por PhotoCraft).

**Hecho:**
- **SVG como imagen** (`src/lib/svg.ts`): logos, rótulos y superposiciones vectoriales se ven nítidos
  en 9:16, 16:9 y 1:1 sin un PNG por formato. Entran por «subir clip propio» (pista libre o escena) y en
  `plantilla.marca.logo`. El tamaño sale de `width`/`height` en px o del `viewBox` (ffprobe no lo da). No
  se sanea: se **rechaza** el SVG con scripts, `foreignObject`, eventos `on…`, DOCTYPE o entidades, CSS
  con `@import`, `image-set()`, escapes `\`, o cualquier `href`/`url()` que no sea `#id` o un PNG/JPEG/WebP
  en base64; todo eso también con las entidades decodificadas (`attributeName="hr&#x65;f"` es un href).
  Además se sirve con `Content-Security-Policy: … sandbox`. Los SVG no pasan por la detección de caras.
  Revisión de bypasses con Nemotron (`razonar`): de 14 propuestas, 4 eran reales (entidades en valores y
  en `url()`, escapes CSS, `image-set` con cadena) y quedaron cubiertas con pruebas; el resto no pasaba
  el filtro o no tiene efecto en Chrome (entidades en nombres de etiqueta o atributo).
- **Regla de QC «Resolución de imágenes y clips»** (aviso), del chequeo *Image Resolution* de su
  Production Preflight (docs/production-preflight.md): ampliación efectiva de cada clip raster en la
  salida, con cubrir/contener y el zoom máximo del movimiento. Umbral 2×: los clips de MPT (832×1216)
  en 9:16 dan 1,58× y pasan; un logo PNG chico a pantalla completa, no. Pruebas en `tests/svg.test.ts`.
  Se llama «Nitidez de imágenes y clips» y dice en palabras qué escena se verá borrosa y de qué tamaño
  mínimo tiene que ser el reemplazo (`src/lib/nitidez.ts`).
- **Logo de la marca desde /plantillas**: lo lleva la sesión de la paleta (`api/plantillas/[slug]/logo`,
  `src/lib/imagen-subida.ts`, que valida los SVG con `revisarSvg`). Notas que le dejo: avisar si un logo
  raster mide menos de 53 px de alto (así se muestra en 9:16: `marcaFs` 44 × 1,2), un botón «Quitar
  logo» y nombre con hash del contenido para no pisar el de renders viejos (ya lo hace).

- **Instalado y conectado** (2026-11-19): `~/dev/video-tools/vectorcraft/0.24.1`, enlace `actual`,
  `VECTORCRAFT_CLI`/`VECTORCRAFT_VERSION` en `src/lib/rutas.ts`, chequeo en el doctor y botón «Instalar con
  un clic» en Sistema (`src/lib/instalar-craft.ts`: el procedimiento de PhotoCraft con la app como
  parámetro; el de PhotoCraft puede pasarse a éste).
- **Subir un logo o rótulo `.ai`, `.pdf`, `.eps`, Affinity, DXF o EMF** como clip propio o superposición:
  se convierte a SVG con el texto en contornos (`convert … --outline-text`, siempre `--safe-mode`, ~10 ms)
  y entra como SVG; lo que VectorCraft avise (p. ej. una fuente que faltaba) se muestra al subirlo y el
  historial dice «convertido a SVG» (`src/lib/vectorcraft.ts`, `src/lib/formatos-vector.ts`).
- **`vectorizar()`** (Image Trace, `imageTrace.makeAndExpand`): un logo PNG plano pasa a pocos trazos.
  En el proyecto, cuando el QC avisa que una imagen se verá borrosa, aparece «Vectorizar … (si es un
  logo)» junto al aviso (sólo para imágenes, no videos, y sólo si siguen en el proyecto): reemplaza la
  imagen por el SVG en todos sus clips como versión nueva, que se deshace desde Historial
  (`api/proyectos/[id]/vectorizar`, `cambiarAsset` en `src/lib/nitidez.ts`). El MCP queda sin registrar
  (decisión del 2026-11-19: no hay flujo que lo pida).
- Pruebas contra el binario real en `tests/vectorcraft.test.ts` (se saltan si no está instalado).
- **Pendiente para la sesión del logo de plantillas:** `guardarImagenSubida` todavía no acepta `.ai`/`.pdf`
  /`.eps`; con `esVector()` y `aSvg()` es una línea.

**Para después:**
- **Rótulos y tercios inferiores vectoriales** diseñados por Claude con el MCP sin ventana, encerrado en
  la carpeta del proyecto: `claude mcp add vectorcraft -- ~/dev/video-tools/vectorcraft/actual/bin/vectorcraft-cli
  mcp --automation-read-root ~/geeper-data/<slug>/assets --automation-write-root ~/geeper-data/<slug>/assets`.
- Chequeo de fuentes faltantes del mismo Preflight (`document.preflight`): aplicaría a los textos en
  pantalla si una plantilla usa una tipografía que Chrome no tiene.

**Descartado:** su render o su UI como motor (no hace video), los efectos 3D, malla de degradado, perspectiva
y cotas (sin uso en shorts), el build wasm y escribir `.vectorcraft` a mano (es JSON documentado, pero la
API de comandos es la vía estable).

### DesignCraft 0.21.0 — revisión 2026-11-19 (commit `a354990`)

Maquetación de páginas (revistas, libros) en Rust puro (egui, vello_cpu), MIT o Apache-2.0, sin
telemetría, con `designcraft-cli` sin ventana y servidor MCP. Sale a PNG, PDF/X, EPUB, IDML y PPTX: no
tiene tiempo, audio ni video, así que **no se integra como dependencia**. Lo que sirve es su tipografía.

**Hecho: líneas equilibradas en subtítulos, textos en pantalla y tarjeta final.** De su «Balance Ragged
Lines» (`crates/compose/src/breaker.rs:1065`): conservar el número de líneas del corte voraz, pero con la
medida más estrecha que lo mantiene, para que las líneas queden parejas. `lineasDePalabras` en
`src/lib/subtitulos.ts` lo hace como programación dinámica sobre caracteres (costo Σ largo²), y además
evita cerrar una línea con artículo, preposición o conjunción («la / casa») si el costo en equilibrio es
razonable (penalización max²/8; con puntuación pegada, «que,», sí puede cerrar). Esa regla es una pauta
habitual de subtitulado en español, no viene de DesignCraft.
- Como el número de líneas no cambia, no cambian el reparto en grupos (`partirEnDosLineas`,
  `suavizarRitmo`) ni el conteo de líneas del QC; el largo máximo por línea sólo puede bajar.
- El compilador pinta cada línea de subtítulo como un `.linea` propio, así lo que se ve es lo que mide
  el QC (antes el navegador partía la pastilla a su manera). Los textos en pantalla toman el ancho de las
  líneas equilibradas y llevan `text-wrap: balance`, igual que el título de la tarjeta final.
  `VERSION_COMPILADOR` pasa a `compilador-hf-v3` (cambia el HTML, se recompila la vista previa).
- Verificado en los 5 proyectos de `~/geeper-data` con `hyperframes snapshot` (tipografías reales):
  «fundamentales para la / seguridad marítima,» y «visuales que guían a / los barcos en aguas poco» en dos
  líneas parejas, y «GTA VI / SHORTS» en la tarjeta final. Pruebas en `tests/subtitulos.test.ts`.

**Hecho (segunda tanda, 2026-11-19): lo que necesitaba interfaz, pensado para quien no sabe de diseño.**
- **Editor visual de plantillas** (`src/components/editor-plantilla.tsx`): reemplaza el cuadro de JSON por
  campos normales (marca, logo, seis colores con nombre y para qué sirven, letra de una lista de Google
  Fonts que Hyperframes descarga sola, cierre, música) con vista previa en vivo (video claro u oscuro), barra
  de guardar fija y aviso de cuántos proyectos la usan. «Duplicar» crea una copia para probar sin afectarlos.
  El JSON queda en «Avanzado». Rutas: `PUT /api/plantillas/<slug>` acepta `{ nombre, datos }`,
  `POST /api/plantillas` duplica, `POST /api/plantillas/<slug>/logo` guarda el logo en
  `~/geeper-data/plantillas/<slug>/`.
- **Colores desde el logo o una foto** (`src/lib/colores-marca.ts`, `src/lib/paleta.ts`, `POST /api/paleta`):
  el median cut de `color_theme.rs:71-127`, con una diferencia: corta donde queda menos varianza, no en la
  mediana, porque la mediana promediaba dos colores del logo en uno que no existía (probado). ffmpeg lee
  PNG, JPG, WebP y SVG (librsvg). Propone qué color va en cada rol: el principal es el más característico de
  la marca; el secundario, uno que se lea sobre el cierre. Está en el editor de plantillas y en Anuncios
  («Leer la marca desde su web» → sacar colores del logo).
- **Legibilidad con arreglo de un toque** (contraste WCAG contra el peor caso, video claro u oscuro debajo):
  subtítulos, palabra que suena, botón final y título final, con «Arreglar» (sube la opacidad del fondo o
  ajusta el color lo mínimo). DesignCraft no lo tiene; cierra el contraste WCAG pendiente de BRECHAS Q2
  para las plantillas. Las letras del botón final y de los títulos en pantalla se eligen solas en el
  render (`textoSobre`): la tinta si se lee (≥ 3:1), si no negro o blanco. La plantilla Dimerso tenía el
  botón ilegible (1,1:1); GTA VI no cambia (3,4:1).
- **Variantes de anuncios en una tabla** (su combinación de datos): ver `docs/ANUNCIOS.md` §9.
- **Pasos encadenados en `proponer.ts`** (sus guiones con `$N.ruta`, `src/lib/encadenar.ts`): `"$1.id"`,
  `"$ultimo.id"`, `"${1.id}"` y `$$`; el informe dice qué creó cada paso. Numerado desde 1, como el informe
  (DesignCraft cuenta desde 0).
- Revisión con Nemotron (`razonar`) de las partes delicadas: de 10 hallazgos, 4 eran reales y quedaron
  arreglados con prueba (una ruta de imagen `anuncios/<id>/../../geeper.db` salía de la carpeta de la
  campaña; claves heredadas como `__proto__` en las referencias; encabezados repetidos al pegar; fórmulas
  de Excel en el CSV exportado de Anuncios). El resto ya estaba cubierto o no aplica a una app local.

**Para después:** el preflight en vivo y el diseño del MCP ya están anotados arriba (VectorCraft y PdfCraft).

**Descartado:** el compositor de párrafos (Knuth–Plass con estiramiento de espacios, letras y glifos) y la
partición con guion, incluidos los patrones en español de `hypher`: un subtítulo no se parte con guion y
no se justifica; sus fuentes (Inter, Source Sans 3, Source Serif 4, JetBrains Mono, OFL), porque
Hyperframes ya descarga y fija las tipografías de las plantillas al renderizar; el render, PDF/X, EPUB,
IDML, INDD y PPTX (no hay salida impresa en Geeper); el soporte CJK y árabe; la UI egui y el build wasm;
y la escritura atómica (Geeper ya la tiene en `src/lib/archivos.ts`).

## Open-Generative-AI (Anil-matcha, MIT) — revisión 2026-11-20

Estudio de imagen y video (Next.js + Electron), commit `7858e08`. Casi todo es una interfaz para
**MuAPI, un servicio de pago en la nube** (600+ modelos: Kling, Veo, Sora, Seedance, Nano Banana…),
vendido como «sin filtros»; Geeper es local y a US$0. Lo útil es lo poco que corre en el equipo.

| Pieza | Qué hace | En Geeper |
|---|---|---|
| `electron/lib/wan2gp{Local,Catalog,Output}.js` | Corre [Wan2GP](https://github.com/deepbeepmeep/Wan2GP) sin interfaz (`wgp.py --process ajustes.json --output-dir`), lee el avance por fases, el archivo guardado y los fallos (sin VRAM, archivo faltante, traceback), mira qué pesos hay en `ckpts/`, valida con `--dry-run` y mata todo el árbol al cancelar | **Portado** a `src/lib/wan2gp.ts` + `scripts/plano.ts`: primer paso de G4 (planos generativos). Arreglado respecto del original: sin `image_prompt_type: "S"`, `wgp.py` descarta `image_start` (`wgp.py` ~l. 1643) y TI2V hacía texto → video sin la imagen de la escena. Cuadros según los fps de cada modelo (Wan 4k+1, LTX 8k+1), formatos y licencias de Geeper, GPU por `gpu-solo` (pausa Ollama y el servidor de imágenes de MPT) o el candado de `gpu.ts`. Pruebas con un `wgp.py` falso (`tests/fixtures-wan2gp/`, también de ellos) |
| `src/lib/promptUtils.js` (Cinema Studio) | Cámara, lente, focal y apertura → texto del prompt | **Portado** a `src/lib/prompt-camara.ts` con nombres en español, más movimientos de cámara (propios). Opciones `--camara --lente --focal --apertura --movimiento` de `scripts/plano.ts` |
| sd.cpp empaquetado (Z-Image, SDXL, SD 1.5) | Imágenes locales con un binario C++ | **No**: Geeper ya hace Z-Image-Turbo en la GPU con MPT. Si un día la app de escritorio necesita imágenes sin Docker, es la opción a mirar (`electron/lib/localInference*.js`: descarga reanudable con avance) |
| Wan2GP por MCP (`wan2gpMcp.js`) | El mismo motor en otra máquina de la red | **No por ahora**: la GPU está en esta PC. Sirve si el PC del estudio y el de edición se separan |
| Image/Video/Audio/LipSync/Cinema/Marketing/Recast/Influencer Studio, AI Clipping, Workflows, Agentes | Formularios sobre la API de MuAPI | **No**: todo pasa por MuAPI (de pago, con la clave en `localStorage`). AI Clipping es su endpoint `runClipping`; Geeper ya tiene `/clips` local |
| Catálogos de modelos (`packages/studio/src/*Models.js`, `*Parameters.js`) | Parámetros por modelo de nube (duraciones, relaciones de aspecto) | **No**: modelos de pago |

**Animar esta escena** (2026-11-20). En cada escena del proyecto, «Animar esta escena con IA» convierte
su imagen en un video corto con movimiento. A la vista: cómo se mueve la cámara (quieta, acercarse,
alejarse, girar, rodear, en mano o «que decida la IA»), la duración y **Rápido** (FastWan, 3 pasos) o
**Calidad** (TI2V-5B, 50 pasos). En «Más opciones»: qué tiene que pasar (prompt), lente, focal,
desenfoque, tipo de cámara, motor (también I2V-A14B y LTX-2.3), partir o no de la imagen y semilla. Va a
la cola (`plano.generar`, motor `mpt`: nunca corre a la vez que MPT), muestra el avance en palabras
(«Bajando el modelo: 3,2 GB», «Animando: paso 2 de 3») y guarda una versión nueva que «Historial» deshace.
Lógica en `src/lib/plano.ts`; API `/api/proyectos/[id]/plano`; panel `src/components/panel-animar.tsx`.

- Imagen de inicio: la de la escena o, si es un clip de MPT (zoom sobre la imagen), su cuadro donde
  empieza el clip. Prompt por defecto: el de la imagen de MPT; si no hay, lo que se dice en la escena.
- Se salta el **primer cuadro** del plano: es la imagen de inicio tal cual y desde el segundo el modelo
  la reinterpreta (otra escala, detalles nuevos), así que se veía un parpadeo al entrar la escena.
- Si el plano es hasta un 40 % más corto que la escena, se pasa más lento para llenarla (en vez de
  repetirse); si es más corto todavía, se repite y el panel lo avisa.
- Los valores de cada modelo (`<Wan2GP>/defaults/<modelo>.json`: pasos, guidance, flow_shift) van debajo
  de los ajustes de Geeper: con `--process`, `wgp.py` no los completa solo.

**Instalar** (Sistema → «Wan2GP (animar escenas)» → «Instalar con un clic», o
`pnpm tsx scripts/instalar-wan2gp.ts`): código de Wan2GP en el commit fijado `f4cfc12` (v20) como checkout
de git en `~/dev/video-tools/Wan2GP` (`GEEPER_WAN2GP` lo cambia), Python 3.11 propio con uv en su `venv`,
PyTorch 2.10 con CUDA 13 (lo que recomienda Wan2GP para RTX 20xx–50xx; driver R580 o más nuevo) y sus
dependencias con PyTorch fijado por restricciones (sin mezclar índices: `unsafe-best-match` dejaría colar
un paquete homónimo de otro índice, hallazgo de la revisión con Nemotron). Al final prueba que PyTorch vea
la GPU y que `wgp.py --dry-run` valide una tarea. Cada paso se salta si ya está; un Wan2GP con cambios
propios no se toca. Ocupa 8,5 GB; los pesos de TI2V-5B (int8), su VAE y el codificador de texto, unos
14 GB más, los baja Wan2GP la primera vez que se anima (Rápido y Calidad comparten pesos). macOS: no
disponible (hace falta GPU NVIDIA). Windows: sin probar (necesita Git).

Su licencia, WanGP Community License 2.0, deja usarlo gratis también en una empresa y vender los videos
(citando a WanGP cuando se vende el video mismo), pero no venderlo, embeberlo en un producto pago ni
ofrecerlo como servicio: se baja de su repo al instalarlo y corre como proceso aparte; no va dentro del
instalador de Geeper. Los pesos tienen la suya (`MODELOS_PLANO` en `wan2gp.ts`; LTX-2.3 queda en
«revisar» y el QC lo bloquea en proyectos de uso comercial).

Terminal:

```bash
pnpm tsx scripts/plano.ts --estado                              # ¿está instalado? ¿qué motores bajaron?
pnpm tsx scripts/plano.ts <slug> <escena> --probar              # wgp.py --dry-run, sin GPU
pnpm tsx scripts/plano.ts <slug> <escena> [--modelo rapido|ti2v|i2v|ltx2] [--prompt "…"] [--segundos N] \
  [--movimiento acercar] [--lente anamorfico --focal 35]        # genera y guarda una versión nueva
```

**Medido** (2026-11-20, RTX 5080, «faros-en-costas-escarpadas», escena 2, Rápido, acercarse, semilla 7):
614 s en total la primera vez, casi todo bajando 14 GB de pesos; el trabajo en sí, unos 100 s (codificar
el texto 33 s, 3 pasos 21 s, armar el video y guardar el resto). VRAM pico 11 GB de 16 (con `gpu-solo`,
que pausó y volvió a levantar Ollama y el servidor de imágenes de MPT). Salió 121 cuadros a 24 fps en
800×1152: Wan2GP conserva la proporción de la imagen de MPT (832×1216) y la composición la encuadra a
9:16 como antes. El faro se mantiene fiel y aparecen personas caminando; el «acercarse» casi no se nota
con 3 pasos. Render v6 con el plano: QC aprobado. **Sin medir:** Calidad (50 pasos; estimado ~8 min por
~7 s/paso), I2V-A14B y LTX-2.3.

Falta: comparar Rápido y Calidad lado a lado; botón «Cancelar» en el propio panel (hoy, desde Trabajos).

## Cap (CapSoftware, AGPL-3.0) — revisión 2026-11-20

Grabador de pantalla tipo Loom (Rust + app de escritorio + web Next.js), commit `a29df6c`. **Licencia:
AGPLv3** salvo los crates `cap-camera*` y `scap-*` (MIT, captura de cámara y pantalla nativa, en Rust:
no le sirven a una app Node). Geeper tiene instalador de escritorio, así que de Cap se toman **ideas y
parámetros reescritos, nunca código**. Lo de valor está en su editor (`crates/project`, `crates/rendering`,
`crates/audio`) y en la skill `apps/cli/skill/cap-demo`.

| Pieza | Qué hace | En Geeper |
|---|---|---|
| Skill `cap-demo` (`scout-shoot.mjs`, `treat.py`) | URL → explora la página, elige el botón que cuenta la historia, la recorre con entrada virtual, graba la ventana con el binario de Cap y la trata: cámara 3D apuntada al titular, al botón y a la página siguiente, fondo con los colores de la marca, cursor sintético, 12 s | **Rehecho** en `src/lib/demo-web.ts` + `scripts/demo-web.ts` (primer paso de F4 «Lanzamiento de producto»). Cap sólo corre en macOS (captura de ventana); aquí la toma es Chromium headless + screencast de CDP (Linux/WSL, sin permisos de pantalla, el cursor de la persona no se mueve) y el tratamiento es una composición de **Hyperframes** (tarjeta con `perspective`, cortes duros en cada cambio de contenido, cursor y pulso de clic dibujados). Mismas reglas editoriales (cortar en la acción, quitar la carga, un solo sistema de movimiento, apuntar al contenido). Arreglado respecto del original: un botón blanco/negro ya no da el color de marca (salía un fondo gris), un enlace a la misma página o al blog ya no abre la historia, y `--force-device-scale-factor` (sin él la toma sale a 1280 px y la tarjeta queda borrosa). Agregado: palabras de botón en español, versión móvil para 9:16 y estilo «plano» |
| `crates/project/src/auto_zoom.rs` | Zoom automático por clics | **Portado** a `rangosZoomPorClics` (estilo «plano» de la demo): 0,3 s antes del clic y 2,5 s después, se ignoran los del último segundo, terminan 0,8 s antes del final, se juntan si los separan ≤ 2,5 s |
| `crates/project/src/disfluency.rs` | Detecta vacilaciones, repeticiones, arranques en falso y muletillas de discurso (en inglés) | **Portado al español** en `src/lib/ediciones.ts` («Quitar muletillas»): vacilaciones estiradas de cualquier largo («eeeeh», «mmmmm», «ehmmm») y tartamudeos («el el», «en la en la»; se quita la primera vez), salvo dobles intencionales («no no», «muy muy», números), si la primera cierra oración o si hay una pausa ≥ 1 s. Además, aplicarlo dos veces ya no duplica recortes. Los arranques en falso y «o sea / ¿no? / tipo» quedan fuera: dependen de la gramática inglesa y en español necesitan su propia lista |
| `fpsDominante` (de `treat.py`) | fps reales de una captura de cuadro variable: la moda, no la media | **Portado**; lo usa la toma para informar |
| `crates/audio/src/voice*.rs` («Studio Sound») | RNNoise (xiph, **BSD**, mezcla 0,9 húmedo) → ganancia a −16 LUFS (±12/+24 dB) → compresor 2:1 (umbral ≈ −18 dBFS, ataque 15 ms, relajación 180 ms) → compensación ±6 dB → limitador a 192 kHz a −1,5 dBTP; ecualización de voz (pasa-altos 90 Hz, −4 dB a 350 Hz, +5 dB a 3,5 kHz, +3 dB sobre 9 kHz) | **Hecho** (2026-11-20): «Mejorar la voz» en Clips (`src/lib/voz-limpia.ts`, encendido por defecto, con «Escuchar antes y después»). Sólo filtros de ffmpeg, sin modelo que licenciar: `afftdn` en lugar de RNNoise (medido: con ruido rosa a −32 dB el fondo baja 5,3 dB y la voz no cambia; `anlmdn` quitaba menos y tardaba 10×), ecualización más suave que la de Cap y su compresor 2:1. Whisper sigue oyendo el original. La sonoridad final la pone la entrega (−14 LUFS). En la voz de Kokoro no hace falta |
| `crates/editor/src/join_fade.rs` | Fundido de 5 ms en cada corte de audio | **Ya lo teníamos**: `mezcla.ts` pone 15 ms |
| `caption_words.rs` | Segmentos de 6 palabras (máx. 8), no cerrar en palabra débil, cada palabra dura como mucho 2,5 s | La palabra débil ya está (`subtitulos.ts`, de DesignCraft). **Hecho** el tope de 2,5 s en pantalla (`MAX_DURACION_PALABRA` en `linea.ts`): la paridad con `mpt_acabado.py` es de cómo se agrupa el texto, no de los tiempos, así que no hubo que tocar el Python |
| Resorte del zoom (k 205, c 33,3, m 1,5: 90 % en 317 ms, sin rebote) y adelanto c/k | Movimiento de cámara del editor | Referencia para los golpes de zoom de `compilador.ts` si se pasan a resorte |
| IA de la web (`apps/web/workflows/generate-ai.ts`) | Título, resumen y capítulos con un LLM | **Hecho** (D1): «✨ Sugerir título, descripción y hashtags» en Publicar (`src/lib/texto-publicacion.ts`), con el modelo local de MPT y largo según la duración (< 60 s: 15–35 palabras). La salida se limpia con los límites de cada red, sin hashtags de relleno (#fyp, #viral), con el crédito del creador si es un clip; la persona la revisa antes de publicar. Capítulos (≥ 120 s, separados ≥ max(5 s, duración/10)) quedan para cuando haya videos largos |
| Teclas en pantalla (`keyboard.rs`), cursor con resortes (`cursor_interpolation.rs`), mejora de nitidez (`screen_enhance.rs`, red propia sin procedencia) | Grabación de pantalla | **No por ahora**: Geeper no graba la pantalla de la persona. Los pesos de la red no se reutilizan (AGPL, sin datos de entrenamiento) |
| Render farm, web de compartir, S3, Loom import, CLI `cap record`, MCP | Producto de Cap | **No**: nube, cuentas o macOS. La música de `cap-demo` (lofi de Pixabay) tampoco: licencia no clara |

Uso:

```bash
pnpm tsx scripts/demo-web.ts https://producto.com                       # 16:9, cámara 3D
pnpm tsx scripts/demo-web.ts https://producto.com --formato 9:16 --estilo plano
pnpm tsx scripts/demo-web.ts https://producto.com --fondo E4DCF8,C6BAEA --retratar   # recomponer sin volver a grabar
```

**En la web:** «Nuevo → Desde una página web» (link, forma, movimiento y lo que dice la voz). El trabajo
`demo.crear` hace primero la voz (da la duración exacta), después la demo a esa medida (si la voz es larga, la
toma sigue bajando por la página) y un proyecto normal con la imagen en `sincro: "voz"`; sigue el render con QC.
La captura queda con licencia «revisar» salvo que la persona marque que el sitio es suyo.

Desde la terminal sale en `~/geeper-data/demos/<slug>/<slug>-demo.mp4` (sólo la imagen), con `toma.json`
(eventos, cursor, colores) y `qa-*.jpg` para mirar antes de usarlo. Como en cap-demo, conviene revisar los fotogramas: en sitios claros o con
degradados el color medido miente (`--fondo` a ojo), y si el botón lleva a un registro o login, forzar
`--historia scroll`.

**Probado** (2026-11-20) contra cap.so en 16:9/3D (toma 1920×1200, 60 fps reales, 12 s) y
hyperframes.heygen.com en 9:16/plano (toma móvil 1030×2230): `hyperframes check` sin errores ni avisos y
fotogramas revisados. El flujo de la web, probado de punta a punta en una base aparte (cap.so, 9:16, 3D): voz
11 s → demo → proyecto → render **aprobado** por el QC (−14,3 LUFS, subtítulos legibles, licencias). Falta:
1:1, y que `brag` escriba el texto de la voz leyendo el código del producto.

## OpenWhispr (MIT) — revisión 2026-11-20

App de dictado de escritorio (Electron + whisper.cpp + Parakeet por sherpa-onnx), v1.12.0, commit
`007826d`. Casi todo es dictado en vivo, reuniones, notas y nube; lo útil para Geeper es cómo usa whisper
sobre audio real, que es lo que hacen los clips. Medido en esta PC con la voz de «faros-en-costas-escarpadas»
(44,5 s, whisper `medium`, CPU).

| Pieza | Qué hace | En Geeper |
|---|---|---|
| VAD Silero (`--vad`, `src/constants/whisperVad.json`) | whisper sólo decodifica donde hay voz | **Hecho** (`src/lib/whisper.ts`). Con 12 s de música tras la voz, sin VAD whisper inventaba «y no te dejes de ver.»; con VAD, 0 palabras de más y los mismos tiempos al milisegundo en las 112 palabras. Modelo ggml de 885 KB con tamaño y SHA-256 fijados, se baja solo a la caché de whisper; si falla, se transcribe sin VAD y se avisa |
| Umbrales del decodificador (`whisperServer.js:50`: entropía 2,8, logprob −1,25) | Bajaron sus colas inventadas de 2,25 % a 0,06 % en 4814 dictados | **Hecho**, junto con el VAD. Solos no frenaron la cola sobre música en nuestra prueba |
| Probabilidad por token | whisper.cpp la da en `--output-json-full`; `hyperframes transcribe` la descarta | **Hecho**: whisper corre directo (el mismo binario y modelo que compila Hyperframes) y cada palabra lleva `p` (la menor de sus tokens). DECISIONES §17 queda corregido: en los clips, una `p` < 0,35 hace la palabra «dudosa» (las mal oídas dieron 0,27–0,31; la mediana es 0,99). En voces TTS no se usa: ahí el texto sale del guion |
| Diccionario como `--prompt` | Nombres propios que whisper escribiría mal | **Hecho, opcional, sólo clips**: `--glosario "GTA VI, Lucia"` en `scripts/importar-clip.ts` y `glosario` en `POST /api/clips`. Corrigió «hierguen» → «yerguen», pero también cambió «linternas» por «linterna» (p 0,27, que queda marcada). En el asistente de `/clips`, paso 4 «¿Se dicen nombres difíciles?» (opcional, vacío por defecto) con botones «+ nombre» sacados del título y el canal (`src/lib/glosario.ts`; de un título gritado sólo «sigla + número») |
| (propio) Revisión de dudosas en clips | — | En un clip la palabra dudosa puede estar mal escrita: la revisión pregunta «¿dice "X"?» y ofrece «Sí, dice eso», «No, dice otra cosa…» (se escribe lo que se oye; `corregirSubtitulo` con `revisada: true` la saca de las dudosas en un solo paso del historial), «Recortarla» y «Saltar». «Preparar el estudio» baja el VAD y Sistema dice si está. Probado en el navegador con un clip real |
| `--js-runtimes node:<execPath>` (`urlAudioDownloader.js:592`) | yt-dlp necesita un runtime de JS para YouTube y sólo trae Deno activado | **Hecho** en `fuentes.ts` y `tendencias.ts`. Sin él yt-dlp avisaba «some formats may be missing» y `--no-warnings` lo ocultaba; hoy faltaban formatos (18, 136, 247), no el 1080p, pero YouTube lo va a exigir |
| Binarios de whisper.cpp con CUDA y Vulkan (`OpenWhispr/whisper.cpp`, releases con SHA-256; `whisperCudaManager.js`) | whisper en la GPU | **Para después**: el de Linux con CUDA pesa 800 MB, no está claro que traiga kernels para la RTX 5080 (sm_120), y la GPU es de MPT (`gpu-lock`). En CPU un short tarda 25–34 s |
| Diarización local (`diarization.js`, sherpa-onnx con pyannote + embeddings) | Quién habla en cada tramo | **Para después**: sirve para clips de podcasts o con dos personas (color de subtítulo por voz). `hyperframes transcribe --speakers` sólo lo hace con HeyGen (de pago) |
| `noSpeechSegments.js` (no_speech_prob > 0,6 y logprob ≤ −1) | Quitar segmentos «sin voz» de la API de OpenAI | No: whisper.cpp no da `no_speech_prob` por segmento en el JSON; el VAD cubre lo mismo |
| Filtro de fragmentos en otro alfabeto (`meetingFragmentFilter.js`) | Quita «Да.», «うん。» inventados en reuniones | No: Geeper fija el idioma (`--language es`) |
| Parakeet por sherpa-onnx | ASR más rápido | Ya está en Hyperframes 0.9.27 (`--engine parakeet`, instalado en la caché), pero no da probabilidad por palabra ni admite glosario: se queda whisper |
| Dictado, atajos, reuniones, calendario, notas, nube, agentes, MCP, app móvil | El producto OpenWhispr | **No**: nada de eso es edición de video |

## ComfyUI (Comfy-Org, GPL-3.0) — revisión 2026-11-21

Motor de nodos para imagen, video y audio con IA, commit `0072b86` (v0.46.0), y sus repos vecinos:
`workflow_templates` (las 776 plantillas del hub, `templates/index.json`), Cinematic Studio (`f223ccf`),
Reshoot (`dc53fc7`) y Openjutsu (`70ec62d`), los tres MIT. ComfyUI es GPL-3.0: si entra, entra como
**proceso aparte** (su API HTTP `/prompt` + websocket), como OpenMontage; Geeper no importa su código.

**Lo que sirve, y dónde lo hace Geeper.** Casi todo lo que ComfyUI trae en el núcleo para personajes
que hablan también lo trae Wan2GP, que ya está instalado y maneja mejor la memoria en 16 GB. Para no
duplicar 30–60 GB de pesos en otro formato, el avatar se hizo con Wan2GP (decisión del dueño, 2026-11-21):

| En ComfyUI | Qué hace | En Geeper |
|---|---|---|
| `WanInfiniteTalkToVideo` (`comfy_extras/nodes_wan.py`), plantilla `video_wan2_1_infinitetalk` | Imagen + audio → personaje que habla (Wan 2.1 I2V 14B + InfiniteTalk, Apache-2.0) | **Hecho** con Wan2GP (`infinitetalk` + lightx2v 4 pasos): «Presentador» (`src/lib/presentador.ts`) |
| `TextEncodeQwenImageEditPlus`, plantilla `templates-1_click_multiple_character_angles` | Retocar conservando la identidad | **Hecho** con Wan2GP (`qwen_image_edit_plus2_20B` + Lightning 4 pasos): retoques y avatar desde foto (`src/lib/avatares.ts`) |
| Z-Image en el núcleo | Retrato desde una descripción | **Hecho** con Wan2GP (`z_image`), 4 tomas para elegir |
| `WanSoundImageToVideo` (Wan 2.2 S2V), `WanHuMoImageToVideo`, LongCat Avatar | Otros personajes que hablan | **Para probar**: S2V/HuMo no están en Wan2GP v20; LongCat Avatar sí (licencia por revisar) |
| `WanAnimateToVideo`, SCAIL-2 (`nodes_scail.py`), plantillas `video_wan_animate2`, `video_wan21_scail2_character_replacement_int8` | Cambiar a la persona de un video por un personaje | **Paso 3** (Openjutsu local): también en Wan2GP (`animate2`, `scail2_14B`) |
| SAM 3 (`nodes_sam3.py`), MediaPipe Face (`nodes_mediapipe.py`), `RemoveBackground` | Seguir y recortar personas, caras y fondos en video | **Para después**: avatar con fondo transparente; hoy la burbuja recorta un círculo y no lo necesita |
| SeedVR2 (`nodes_seedvr.py`), `FrameInterpolate` | Superresolución e interpolación de cuadros | **Para después**: subir el presentador de 480p sin generarlo a 720p |
| Sección **Workflows** (las plantillas del hub) | Cualquier workflow oficial | **Paso 2**: instalar ComfyUI y catalogar las 776 (abajo) |

**Workflows del hub.** `comfy.org/hub/workflows` sale de `Comfy-Org/workflow_templates` (`templates/index.json`:
título, descripción, modelos, tamaño en bytes, nodos personalizados, versión mínima de ComfyUI, entradas).
Medido el 2026-11-21: **776** plantillas; **504** usan nodos de pago de la nube de Comfy (`openSource: false`:
Kling, Veo, Gemini, Flux Pro…) y **272** corren en el equipo (51 de ellas piden nodos personalizados); de
las locales, 69 pesan menos de 10 GB, 84 entre 10 y 25, 89 entre 25 y 50 y 30 más de 50. Los workflows
de la comunidad del hub no tienen API pública: se importarán pegando su JSON. Decisión del dueño: mostrar
las 776, con las de pago bloqueadas («nube de pago») hasta que haya una clave de Comfy y avisando el costo
en cada corrida.

**Cinematic Studio** (MIT). Una app que arma un prompt con plano, cámara, luz y look y lo manda a
FLUX.2 Pro en la nube de Comfy (de pago). **Portado** sólo el lenguaje: `PLANOS`, `LUCES` y `LOOKS` en
`src/lib/prompt-camara.ts` (más opciones que el original), en «Animar esta escena» y en los retratos de avatar.

**Reshoot** (MIT). Sube un clip, estima profundidad (MoGe), deja mover la cámara con una vista previa
deformada (`src/lib/crossview/camera.ts`, `warp-renderer.ts`, `cvgeo.ts`) y regenera la toma con
MiniMax H3 + un LoRA CrossView. **Paso 3**: se porta la cámara y la vista previa (MIT); la generación, con
lo que cabe en 16 GB. H3 pide 96 GB en su guía (el modelo podado más chico, 16 GB, más 15,7 GB de su
codificador de texto) y su licencia, «MiniMax H3 Community License», está por revisar: sólo experimental.

**Openjutsu** (MIT; el pack de nodos de Akatz es GPL-3.0). Cambia a la persona de un tramo de 5–15 s por
el personaje de una imagen, conservando escena, actuación y sonido, con MiniMax H3 + SAM 3.1 + LoRA de
Akatz (licencia de H3). Lo útil: el tramo, el «primer cuadro ancla» y los límites (un solo plano, una
persona en el primer cuadro). **Paso 3**: lo mismo con Wan Animate o SCAIL-2 en 16 GB, y con el avatar
de la biblioteca como personaje.

### Avatar y Presentador (2026-11-21)

**Avatares** (`/avatares`, `src/lib/avatares.ts`): asistente de 3 pasos. 1) Cómo lo quieres: describirlo
(estilo realista, animado 3D, anime, caricatura, ilustración o plastilina; fondo; luz y look opcionales)
o desde una foto (con la casilla de consentimiento, que queda escrita en `avatar.json`). 2) Elegir entre 4
retratos (2 si es desde una foto) u «Hacer otras». 3) Nombre. Después, «Retocar» con una frase («ponle
lentes») conserva la cara; «Deshacer retoque» vuelve al anterior. Biblioteca en `~/geeper-data/avatares/`.
El prompt fija lo que InfiniteTalk necesita: de frente, mirando a cámara, boca cerrada y cara despejada.

**Presentador** (panel del proyecto, `src/lib/presentador.ts`): el avatar dice la voz del video.
- *Burbuja*: un recuadro (círculo o rectángulo redondeado, 3 tamaños, 4 esquinas) todo el video, en la
  pista libre `presentador` con el campo nuevo `marco` del esquema (`src/lib/marco.ts`: dentro de la banda
  segura, debajo de la marca y encima de los subtítulos; la cara se encuadra con YuNet). Se hace sobre la
  voz final: si después cambia lo que se dice, el panel avisa («hay que actualizarlo», por la huella de
  los tramos de voz).
- *Pantalla completa*: reemplaza el visual de las escenas elegidas, en `sincro: "voz"` sobre el audio sin
  recortes de cada escena (con la entrada de 0,3 s en silencio al comienzo): recortar palabras después
  corta igual imagen y voz.
- Audio: ffmpeg recorta y concatena los tramos a mono 16 kHz (`argsAudio`). Ajustes de Wan2GP: la imagen
  va en `image_refs` con `video_prompt_type: "0KI"` (con `image_start` InfiniteTalk la rechaza), audio en
  `audio_guide` + `audio_prompt_type: "A"`, 25 fps, ventana 81 con solape 9, 480p (alta: 720p). Hasta 120 s
  por vez. El retrato se copia al proyecto: el video no depende de que el avatar siga en la biblioteca.
- Trabajos `avatar.proponer`, `avatar.retocar` y `presentador.generar`, en la fila de la GPU (motor `mpt`).

**Verificado** (2026-11-21): `wgp.py --dry-run` valida retratos, retoque, desde foto, presentador en
pantalla (480p y 720p) y en burbuja; 23 pruebas nuevas (`tests/avatares.test.ts`, `tests/presentador.test.ts`);
capturas a 1280 y 390 px sin errores de consola ni desbordes.

**Medido en la RTX 5080** (2026-11-21, carpeta aislada): 4 retratos 371 s la primera vez (baja ~11 GB) y
103 s después, VRAM pico 3,7 GB, calidad muy buena; retoque «ponle lentes» con Qwen Edit, conserva la cara
(1310 s con la descarga de sus pesos); el avatar hablando: 3,2 s de voz → 497 s y 10,4 s → 622 s a 480p
(~7 min fijos + ~18 s por segundo de voz; pesos ~28 GB la primera vez), VRAM pico 6,9 GB, identidad y
lentes estables, parpadeo, sin cortes visibles entre ventanas; la boca sigue a la energía de la voz
(correlación 0,56, desfase de un cuadro). Dos hallazgos: (1) InfiniteTalk fallaba siempre en Wan2GP v20
(parche en «Parches a Wan2GP»); (2) en WSL, consultar `nvidia-smi` cada 2 s durante la generación lo hizo
caer con «CUDA error: unknown error» dos veces en ventanas distintas; sin consultarlo, pasó. Por eso Sistema
ya no consulta `nvidia-smi` mientras un trabajo usa la GPU (`doctor.ts`).

Terminal:

```bash
pnpm tsx scripts/avatar.ts --lista
pnpm tsx scripts/avatar.ts crear "mujer de 30 años, blusa blanca" --estilo animado-3d [--fondo oficina] [--probar]
pnpm tsx scripts/avatar.ts guardar <propuesta> <toma> "Sofía"
pnpm tsx scripts/avatar.ts retocar <avatar> "ponle lentes"
pnpm tsx scripts/avatar.ts presentador <slug> <avatar> [--burbuja --esquina arriba-izquierda | --escenas 1,5] [--probar]
```

### Workflows (2026-11-21, paso 2)

**Página Workflows** (`/workflows`, `src/components/workflows.tsx`): el catálogo de recetas de ComfyUI para
quien no sabe de nodos. Arriba, lo que está en curso y los resultados (ver, escuchar, descargar). Buscador,
«Corren en tu PC / Todos / De pago» y categorías en español. Al abrir una receta: su ejemplo y descripción,
**1. Tus archivos** (un botón por entrada; sin archivo usa el ejemplo de la plantilla), **2. Lo que quieres**
(los textos del workflow como cajas de texto, con etiquetas como «Lo que NO quieres que aparezca») y cuántos
modelos baja la primera vez. «Para expertos: el editor de ComfyUI» abre ComfyUI tal cual (puerto 8190) para
lo que Geeper no corre solo.

- **Instalar** con un clic desde la misma página (`src/lib/instalar-comfyui.ts`): código fijado
  (`0072b86`, v0.46.0) del .tar.gz de GitHub en `<herramientas>/ComfyUI` (`GEEPER_COMFYUI`), Python 3.12
  propio con uv, el mismo PyTorch 2.10 + CUDA 13 de Wan2GP (la caché de uv no lo baja dos veces) y sus
  dependencias con PyTorch fijado. Trae el editor (`comfyui-frontend-package`) y las plantillas
  (`comfyui-workflow-templates`) de esa versión: el catálogo siempre coincide con lo instalado.
- **Catálogo** (`py/comfy_catalogo.py` + `leerCatalogo`): índice y ruta de cada archivo, en caché por
  versión. Las de pago (`openSource: false`) y las que piden nodos de la comunidad quedan bloqueadas con el
  motivo en palabras simples (`bloqueo`).
- **Correr** (trabajo `workflow.correr`, fila de la GPU; `src/lib/workflows.ts`): baja los modelos que
  declaran los nodos (`properties.models`, también dentro de subgrafos; sólo https y sin `..`), copia los
  archivos de la persona a `ComfyUI/input/`, pone sus textos, arranca ComfyUI con gpu-solo en el puerto 8189,
  **convierte con el propio editor de ComfyUI en un Chrome sin ventana** (`app.graphToPrompt()`: subgrafos,
  nodos salteados y widgets quedan como los resuelve ComfyUI, sin reescribir esa lógica), manda `/prompt`,
  sigue el avance por las barras de su salida, espera `/history`, copia lo que salió a
  `~/geeper-data/workflows/<corrida>/` y apaga ComfyUI.

- **Código de la comunidad** (`src/lib/nodos-comfy.ts`, decisión del dueño 2026-11-21: «con permiso y
  versión fija»): sólo se instala lo que está en `src/lib/nodos-comfy.json`, generado con
  `scripts/fijar-nodos-comfy.ts` desde el registro oficial (api.comfy.org): por paquete, la última versión
  que el registro tiene como **activa** (salta las «marcadas» por su revisión), con su sha256, autor, repo y
  licencia. La receta muestra qué paquetes usa, de quién y un enlace al código; nada se instala sin la casilla
  «Permito instalar este código de la comunidad» (queda en `~/geeper-data/comfy-nodos.json`). Al correr: baja
  el .zip, **comprueba la huella**, lo pone en `custom_nodes/<id>`, instala su `requirements.txt` con PyTorch
  fijado (su `install.py` no se corre) y ComfyUI arranca **siempre** con `--disable-all-custom-nodes` y sólo
  carga los paquetes de esa receta (`--whitelist-custom-nodes`); el editor, sólo los ya permitidos.
  Fijado 2026-11-21: 33 paquetes; de las 45 recetas locales que piden nodos, 36 quedan usables. Siguen bloqueadas
  (con el motivo) las que usan ComfyMath, comfyui-gimm-vfi, ComfyUI-LTXVideo, comfyui-string-converter,
  masquerade-nodes-comfyui o RES4LYF (todas sus versiones marcadas) y ComfyUI_Swwan, FL_PromptSelectorBasic
  o QwenVL (no están en el registro). Volver a fijar es trabajo de /novedades.
- **Todo el hub** (`src/lib/hub-comfy.ts`): el paquete de pip deja fuera las recetas con código de la
  comunidad y las de sólo nube (0.11.114: trae 693 de 776). Geeper lee el índice del repo oficial
  (Comfy-Org/workflow_templates, MIT) en el **mismo commit** de esa versión (`f77d47c`), baja los .json de
  las 83 que faltan (~9 MB) y sus miniaturas y ejemplos al pedirlos (~560 MB en total si se usaran todas).
  Resultado 2026-11-21: 776 recetas, 315 locales, 306 usables. Las de `includeOnDistributions: ["cloud"]`
  quedan como «nube». Si la receta no recibe archivo, se copia su ejemplo a `ComfyUI/input/`.
- **Experimentales**: las recetas de MiniMax H3 (licencia por revisar, pensadas para mucha más memoria)
  corren pero salen al final con «Experimental» y un aviso de no usarlas en videos que se publiquen.
- **Usar en un video** (`src/app/api/workflows/usar/route.ts`): cada imagen o video que sale tiene
  «Usar en un video» → elegir el video y la escena → reemplaza su visual en una versión nueva (con
  reencuadre a la cara) y la licencia dice de qué receta salió.

Falta: clave de Comfy para las de pago (bloqueadas por decisión del dueño).

### Rehacer la toma: Openjutsu y Reshoot (2026-11-21, paso 3)

De comfy-openjutsu y comfy-reshoot (MIT) se toma la idea y la experiencia, no sus modelos (MiniMax H3,
licencia por revisar): todo corre en Wan2GP, que ya está, con licencia Apache-2.0. Panel «Rehacer la toma con
IA» en cada escena con video (`src/components/panel-rehacer.tsx`, trabajo `escena.rehacer`,
`src/lib/rehacer.ts`):

- **Cambiar la persona** (Openjutsu): elige uno de tus avatares → Wan2.2 Animate 14B, modo «Replace Person»
  (`PVBAIH#`, con «Igualar la luz» = reiluminación `#1`), 30 fps, ventanas de 81 cuadros, lightx2v 4 pasos.
  La máscara de la persona se hace sola con **SAM 3.1** de Meta (SAM License: uso comercial sin regalías)
  por el mismo código del «Magic Mask» de Wan2GP (`py/mascara_persona.py`, palabra «person»); si no
  encuentra a nadie en el 30 % de los cuadros, lo dice antes de usar la GPU. Hasta 15 s por escena.
- **Mover la cámara** (Reshoot): 10 movimientos de ReCamMaster 1.3B (`model_mode` 1–10: girar, mirar arriba
  o abajo, acercarse, alejarse, subir, bajar, rodear), cada uno con su **vista previa animada sobre la
  imagen de la propia escena** para elegir viéndolo. ReCamMaster hace 81 cuadros a 16 fps (5 s): una escena
  de hasta 8 s entra acelerada y se pasa más lenta para llenarla.
- Si la escena **sigue a su voz** (`sincro: "voz"`, un clip de un directo), «Cambiar la persona» recorta el
  mismo tramo de la grabación y el clip nuevo sigue a la voz con el desplazamiento justo: los recortes de
  palabras siguen cortando la imagen y la boca no se desincroniza (test en `tests/rehacer.test.ts`). Mover
  la cámara ahí se rechaza (la boca dejaría de coincidir).
- Validado con `wgp.py --dry-run` y **probado en la RTX 5080** (2026-11-21), con los pesos bajándose la
  primera vez: «Cambiar la persona» sobre 3 s del avatar hablando, con otro retrato de la biblioteca →
  1147 s en total (máscara SAM 3.1: 183 s, persona en el 100 % de los cuadros; baja ~23 GB: Animate int8
  18 GB, reiluminación 2,9 GB, SAM 3.1 1,7 GB): cambia cara, ropa y lentes y conserva gestos y boca.
  «Mover la cámara» (rodear por la derecha) sobre un plano de FastWan → 781 s con ~3 GB de descarga; la
  toma se vuelve a filmar girando. Sin medir aún los tiempos con los pesos ya bajados.

### Tu avatar en el video (2026-11-21, a pedido del dueño)

El avatar actúa en los videos como una persona (`src/lib/actuar.ts`). Decisiones del dueño: **Geeper
propone y la persona ajusta**; en gameplay, **streamer primero y después dentro del juego**; en promociones,
**con la foto del producto**. Todo en Wan2GP con licencias Apache-2.0:

- **Encuadres** (`poseAvatar`): cara, medio cuerpo o cuerpo completo, sobre fondo neutro o verde, con Qwen
  Image Edit desde el retrato; se guardan en `avatares/<id>/poses/` atados a la versión del retrato.
- **Primer cuadro** (`componerCuadro`): Qwen Image Edit con varias referencias — 1 el avatar, 2 un cuadro de
  la escena, 3 el producto — pone al avatar en el lugar (o en un estudio, o en un lugar descrito).
- **Habla a cámara**: InfiniteTalk sobre ese cuadro con la voz de la escena (presentador en pantalla, con
  `imagen` propia). **Hace algo**: Wan 2.2 I2V A14B con Lightning (4 pasos, dos fases) desde ese cuadro
  (`plano.ts` con `imagen` y `extra`). **Streamer**: el avatar sobre verde habla todo el video; ffmpeg quita
  el verde (`chromakey` + `despill`) a un WebM VP9 con `alpha_mode=1` que Hyperframes compone con
  transparencia; marco `recorte` (figura vertical apoyada abajo, sin borde, con sombra). **Dentro del
  juego**: «Rehacer la toma» → «Cambiar la persona».
- **Geeper propone** (`proponerEscenas`): habla en el gancho (medio cuerpo) y en el cierre (cara, con el
  producto si hay), y actúa en una escena del medio que habla de personas. En «Nuevo» se elige el avatar y la
  cadena pasa a `proyecto.importar → avatar.escenas → render.entregar`; una escena que falla queda como estaba.
- UI: panel del proyecto «Tu avatar en el video» (Geeper elige dónde / como streamer) y, en cada escena,
  «Tu avatar en esta escena» (quién → qué hace, con ejemplos → cuánto se le ve → dónde → producto).

### Parches a Wan2GP (2026-11-21)

`src/lib/parches-wan2gp.ts`: reemplazos exactos e idempotentes, al instalar y antes de cada tarea; si el
texto ya no está (Wan2GP cambió), no se toca nada y se avisa. Hoy uno: en el commit fijado (`f4cfc12`, v20)
**InfiniteTalk fallaba siempre** en la GPU («indices should be either on cpu or on the same device…»):
mmgp deja CUDA como dispositivo por defecto y los índices del audio se creaban en la GPU contra una tabla en
la CPU (`models/wan/multitalk/multitalk.py`, `rows`). El arreglo mueve los índices al dispositivo de la tabla.
Tampoco está arreglado arriba (main, 2026-11-21): conviene reportarlo.

### Voz del avatar (2026-11-21)

Cada avatar tiene su voz, elegida escuchándola en el paso 3 («Nombre y voz») o después con «Cambiar voz»:
las de Kokoro o las diseñadas de la biblioteca (`src/components/elegir-voz-avatar.tsx`). En el panel
Presentador, si el video habla con otra voz, un aviso ofrece «Usar la voz de <avatar> en el video» (lo mismo
que la sección de voz: cambia la voz y ofrece decir el guion de nuevo). El presentador no se encola mientras
la voz se está diciendo de nuevo, y en pantalla completa también avisa si después cambió el audio de una
escena (huella por escena). El panel muestra además una **vista previa a escala** de dónde queda el avatar,
la forma de hablar en botones en español («Alegre y con energía», «Seria y profesional»…) y «Cancelar».

## OpenDesign (nexu-io/open-design, Apache-2.0) — revisión 2026-11-27 (commit `a7eb8e9`)

Espacio de trabajo de diseño con IA (prototipos, presentaciones, sistemas de diseño). Casi todo es para
páginas y presentaciones; de video sólo trae plantillas de HyperFrames, que ya seguimos en su fuente.

**Integrado**

- **Estilos de partida para las plantillas** (`src/lib/estilos-plantilla.ts`, editor de plantillas → «¿No
  sabes qué colores elegir?»): 15 estilos (Noche azul, Blanco y negro, Amarillo brutal, Vibrante, Lujo,
  Editorial cálido, Papel antiguo, Zen…) sacados de los 67 sistemas genéricos de `design-systems/`. Se
  reducen a ~20 paletas distintas (muchos repiten la misma) y son para web (fondo blanco, un acento, letras
  del sistema), así que se rehicieron para video: caja de subtítulos, palabra que suena, segundo acento y
  letras de Google Fonts. Cada uno pasa la legibilidad del editor contra video claro y oscuro
  (`tests/estilos-plantilla.test.ts`), sin el índigo de Tailwind que OpenDesign marca como «AI slop».
- **Copiar la marca de tu página web** (`src/lib/marca-web.ts`, `POST /api/plantillas/<slug>/marca-web`,
  editor de plantillas → Marca): versión reducida de `clipper/brand-capture.js`. Abre la página en el Chrome
  headless, puntúa colores por área y por estar en botones, lee la letra de títulos y textos y busca el logo
  (imagen o SVG del encabezado, después el ícono de la app). La paleta va a `proponerRoles` como la de un
  logo, cada letra se cambia por la de Google Fonts más parecida, se descartan los colores que pone el
  navegador (enlaces sin estilo) y el logo se guarda como uno subido a mano (`guardarImagenSubida`: SVG
  revisado). Sólo links http/https. Probado contra páginas públicas: 2–5 s, logo en 3 de 4.
- **Dos estilos de avatar** (`src/lib/avatares.ts`): «Foto de celular» (piel con poros, sin filtro, luz de
  ventana) y «Blanco y negro» (retrato de estudio), de dos prompts CC-BY-4.0 de su galería (autores en
  `NOTICE`). Cada estilo puede traer su propia luz.

**Descartado o pendiente**

- Sistemas de marcas reales (~90: Apple, Nike, Stripe, Ferrari…) y el catálogo «OpenMotion» (videos de
  Figma, etc.): es la identidad de otros; no se copia.
- Prompts de video (58; 40 para Seedance 2.0 de 15 s con tomas por segundo): Wan 2.2 hace tomas de ~5 s sin
  guion por tiempo, habría que reescribirlos. Los 18 de HyperFrames vienen de heygen-com/hyperframes, que ya
  seguimos.
- `skills/chat-motion-overlay` (conversación de chat animada para shorts): interesante, pero es Remotion
  (licencia de pago para empresas) y no trae licencia propia. Si se quiere, rehacerlo en HyperFrames.
- La mayoría de `skills/` son fichas que apuntan a otro repo (youtube-clipper, copywriting, enhance-prompt…);
  el resto es de diseño web, presentaciones o servicios de pago (fal, Venice, Replicate).
- Reglas «anti-AI-slop» (`craft/anti-ai-slop.md`): sólo se usó la del índigo, como prueba de los estilos.

## Doory (shaongitbd/doory, código con Attribution Assurance License; audio CC0) — revisión 2026-11-27

Editor de diseño en el navegador, tipo Canva (React + Fabric.js, Django). Se revisó el commit `a05f1a8`.
**Su código no se copia:** la Attribution Assurance License obliga a mostrar el crédito del autor al abrir
el programa, y Geeper es Apache-2.0. Lo que no es código sí sirve.

### Hecho

| Qué | De dónde | Resultado |
|---|---|---|
| 24 pistas de música (8 ánimos) y 88 efectos de sonido, CC0, sintetizados | `backend/data/audio/`, `audio_library.json` | `audio-libre/` (7 MB, va en el instalador). Ver `audio-libre/LEEME.md` |
| Efectos al instante, sin tarjeta de video | lo anterior | Panel «Efectos de sonido»: «Listos al instante», con 7 grupos y para escuchar antes de elegir. Antes, un whoosh o un pop pedía MOSS (14,5 GB de VRAM) |
| Música con licencia clara en los estilos | lo anterior | «¿Qué música?» en el editor de estilos: `musica.carpeta = "libre:<ánimo>"` (`src/lib/audio-libre.ts`). El QC comercial la deja pasar (CC0) |
| Música por video, escuchando | lo anterior | Panel «Música» del proyecto: el ánimo que sugiere el tema viene marcado, se escuchan las canciones y «Usar esta» o «Quitar la música», al instante |
| Ningún video mudo por error | lo anterior | Si el estilo no tiene música o su carpeta no existe (Windows), `elegirMusica` usa música libre con el ánimo del tema (`animoSugerido`). «Sin música» a propósito: `musica.carpeta = "ninguna"` |
| «Poner sonidos solos» | lo anterior | Un clic: whoosh suave en cada cambio de escena y pop en cada texto, en la pista `efectos-auto`; «Quitar los automáticos» no toca los elegidos a mano |
| Créditos al publicar | idea de Doory (créditos de Freesound CC BY); código propio | `src/lib/creditos.ts` + panel «Créditos» en el paso 4: dice si hace falta dar crédito y da el texto; al publicar desde Geeper va solo en la descripción. Lo de licencia desconocida o no comercial sale como aviso |
| Zonas seguras de YouTube Shorts | PDF oficial que cita `size_presets.json` (verificado: 288/192/672/48 px en 1080×1920) | `ZONAS_9X16.youtube` pasa de .15/.12/.35/.06 a .15/.178/.35/.044 |
| Varios videos desde una tabla | idea de `bulk_fill`; código propio | En «Nuevo»: pegar filas de Excel/Sheets o subir un .csv (Tema, Título, Guion, Final), con vista previa y ejemplo para descargar. `src/lib/tabla-videos.ts`; la frase final va en `pedido.json` y el importador la pone en `p.cta` |

### Pendiente

- TikTok: Doory da derecha .28 (nosotros .20), pero de una guía de anuncios de terceros (AdKit). Sin fuente oficial, no se cambió.

### Descartado

- Quitar fondo en el navegador (u2netp/ISNet por rembg), el reescalado y las animaciones de entrada y
  salida: son código de Doory o ya existen en Geeper (segmentación, Hyperframes).
- Las ~1600 medidas de `size_presets.json`: Geeper sólo entrega 9:16, 16:9 y 1:1.
