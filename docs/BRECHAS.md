# Qué le falta a Geeper para ser el mejor estudio de video

<!-- revisión: 2026-11-18 · contra el código de chore/skills-hyperframes y el estado del arte a nov. 2026 -->

## Estado (2026-11-18)

| Brecha | Estado |
|---|---|
| B1 esquema v2 | **Hecho** (rama `feat/editor-base-v2`): pistas libres, textos, transiciones, movimiento, velocidad, color, recortes, fps, destino; migración v1 → v2 automática |
| E1 vista previa en vivo | **Hecho** en `feat/m5-publicar-redes` (player de Hyperframes) |
| E2 edición por texto | **Hecho**: recortar y restaurar palabras, acortar silencios, quitar muletillas |
| E5 confianza de la alineación | **Hecho**: confianza por palabra (acuerdo con whisper, silencios, duración) y regla de QC |
| G3 música | **Parcial**: pulsos (`hyperframes beats`) y música alineada a los cortes; efectos de sonido en pistas libres. Falta la biblioteca con licencia clara |
| Q1 licencias que bloquean | **Hecho** (`comercial: true`) |
| Q2 pico real y zonas por plataforma | **Hecho**. Siguen pendientes el contraste WCAG y la decisión de 17 car./s |
| Q4 máster de archivo | **Hecho** (`entrega.master`: MOV calidad alta) |
| Q5 hash de los pesos | **Hecho** para whisper y Kokoro locales; los modelos dentro de MPT no se ven |
| Efectos y transiciones de EffectCraft | **Hecho** (2026-11-19): barrido, radial, iris y persianas; tinte, niveles, viñeta, grano y desenfoque; modos de fusión; Easy Ease. Ver EFFECTCRAFT.md |
| G5 ingesta de material largo | **Hecho** (2026-11-19): `scripts/momentos.ts` + `scripts/importar-clip.ts` y la página /clips, visual en sincro con la voz, regla de QC de clips (DECISIONES §21) |
| E4 reencuadre por cara | **Hecho parcial**: punto fijo por clip con YuNet para todo material (HEREDADO.md, LightCraft) y reencuadre react/cara para clips 9:16 (`py/reencuadre.py`); falta el seguimiento dinámico |
| D1 portada y ganchos | **Hecho** (2026-11-19): portada en 3 pasos con PhotoCraft, diseños propios .psd y miniatura en YouTube (docs/PHOTOCRAFT.md); rúbrica de ganchos en la skill `geeper`. Falta descripción y hashtags con IA |
| Stack agéntico, paso 1 (A1, A2, E2 de STACK-AGENTICO.md) | **Hecho** (2026-11-20, rama `feat/stack-contrato`): `AGENTS.md`, JSON Schema de los contratos en `docs/esquemas/`, pesos sin *pickle*. G1 ya tiene su contrato (`src/lib/director.ts`), falta el flujo |
| E3, G1, G2, G4, Q3, D2, D3, P1, P2 | Pendientes |

## 0. Qué significa «el mejor» aquí

No vamos a ganarle a Premiere o a CapCut en cantidad de botones, y no hace falta. Para Dimerso, «el
mejor» es: **de una idea a un video que rinde en redes, con el mínimo de tiempo humano, US$0 al mes,
todo local, con calidad medida y siempre editable**. Ningún producto comercial junta las cinco cosas.
Cada brecha de abajo se ordena por cuánto acerca a eso.

## 1. Lo que ya es de primer nivel (no tocar)

- `geeper.json` como fuente de verdad, con historial y procedencia y licencia por asset.
- QC **medible y bloqueante** (sonoridad, color, integridad, legibilidad, banda segura). Casi ningún
  editor comercial lo tiene.
- Cola reanudable que sobrevive a reinicios de Windows, con `input_hash` y manifiestos.
- Reedición sin GPU y regeneración por escena; exportación `.otio`.
- Hyperframes como compositor: es el mejor motor de «video con código» disponible (ver HEREDADO.md).

## 2. Brechas, en orden

### Base (bloquea casi todo lo demás)

**B1. Esquema v2 de `geeper.json`.** Hoy hay 3 pistas fijas (visual, voz, música), un clip visual por
escena y 30 fps fijos. Con eso no se puede: B-roll u overlays encima del plano, textos y títulos aparte
de los subtítulos, efectos de sonido, transiciones por corte, movimiento de cámara por clip (Ken Burns,
zoom con keyframes), cambios de velocidad, ajuste de color por clip, ni cortar a mitad de escena (lo
que exige la edición por texto, E2). Hacerlo como **superconjunto de OpenTimelineIO** (pistas libres,
clips, transiciones, efectos, marcadores), con migración automática v1 → v2. El compilador a
Hyperframes y el exportador `.otio` crecen con él; así la exportación deja de perder información.

### Editor

**E1. Vista previa en vivo mientras se edita.** Hoy la vista previa es el último render (~60 s por
cambio); es la mayor diferencia de experiencia con cualquier editor. Mostrar el proyecto Hyperframes
compilado en un iframe y mover la línea de tiempo con *seek* (HEREDADO.md §1). Corre en Chrome, no usa
VRAM. Requisito: recodificar los clips de MPT con un keyframe por segundo (`-g 30`) al importar, o el
navegador se congela al saltar.

**E2. Edición por texto (estilo Descript).** Ya tenemos los tiempos por palabra: borrar palabras del
guion corta la voz y el video en esos tiempos, con un botón para quitar muletillas («eh», «este») y
silencios largos. Requiere B1 (partir clips) y E5 (confiar en los tiempos).

**E3. Línea de tiempo con arrastre** (F3 de PRODUCTO.md): recortar, mover y apilar clips de las
pistas de B1. Diffusion Studio (MPL-2.0) es la referencia a mirar antes de construirla.

**E4. Reencuadre automático 16:9 → 9:16** siguiendo la cara o el sujeto (YuNet de OpenCV, ~230 KB, con
suavizado; detalles en HEREDADO.md). Hoy el ancla es fija: centro, arriba o abajo.

**E5. Confianza de la alineación.** Whisper falla con música de fondo, voces encimadas o ruido, y
alucina en los silencios finales. Puntuar cada tramo, descartar palabras dentro de silencios
(HEREDADO.md §4) y marcar las escenas dudosas antes de editar sobre esos tiempos.

### Generación (lo que entra)

**G1. Director dentro del flujo: brief → guion → storyboard aprobado** (F2). Ya existe la skill
`geeper`; falta el flujo con aprobación en la app y un **contrato estricto** para la salida de
Claude (escenas con narración, plano pedido, duración estimada y marcas de ritmo), validado con Zod
como el resto.

**G2. Voz nueva.** Kokoro sólo tiene voces fijas y su ritmo obligó a bajar la velocidad a 0,85
(DECISIONES.md §3). Candidatos con licencia comercial: **Chatterbox** (MIT, modelos de español
latinoamericano y de España, clona con ~5 s) y **Qwen3-TTS** (Apache 2.0, clona con ~3 s o crea una
voz desde una descripción). Permite una **voz de marca propia** y regenerar una frase con la misma voz
(clave para E2). Clonar una voz real sólo con el consentimiento escrito de esa persona. Contra: estos
modelos van mejor en GPU, así que «reeditar sin GPU» pasa a «reeditar con poca GPU» y compite con los
lotes de MPT por `gpu-lock`. Hay que medir el tiempo en CPU antes de decidir.

**G3. Música con licencia, ritmo y efectos.** La música de MPT tiene licencia desconocida. Hace falta:
una biblioteca con licencia clara (CC0 o la Biblioteca de audio de YouTube) o un generador local;
**detección de pulsos** (el esquema ya tiene marcadores de tipo `pulso`, pero nada los genera) para
cortar al ritmo; y efectos de sonido (whoosh en cortes, golpes en títulos) desde una biblioteca
etiquetada.

**G4. Planos generativos** (M5, no hecho). Primero terminar Wan 2.2 TI2V-5B por plano, que está
medido en esta PC. Después:
- **Consistencia** de personaje y estilo entre planos: generar primero una imagen de referencia por
  personaje o lugar y animarla (imagen → video), en vez de texto → video suelto.
- **Escalado e interpolación** de 576×1024 a 1080×1920: Real-ESRGAN o SeedVR2 y RIFE (verificar la
  licencia de cada uno).
- **Pruebas** (a medir antes de comprometerse): LTX-2.3 en FP8 (genera audio y video juntos; licencia
  propia de Lightricks, hay que verificarla) y Wan 2.2 14B en GGUF Q4 con *offload*. En 16 GB los dos
  son justos.
- Imágenes: pasar de SDXL a un modelo más nuevo con licencia Apache (por ejemplo, FLUX.1 schnell o
  Qwen-Image; verificar).

**G5. Ingesta de material propio largo** (directos, grabaciones de pantalla, demos de producto) →
clips con puntaje de momentos. El plan completo está en HEREDADO.md («clips de directos»). El flujo
«Lanzamiento de producto» con `brag` (F4) también sigue sin integrar.

### Calidad

**Q1. Licencias que bloquean.** Hoy una licencia desconocida es un aviso. Agregar una marca
«uso comercial» por proyecto: si la tiene, el QC **bloquea** cualquier asset no comercial, editorial o
de licencia desconocida, con el detalle de cuál es.

**Q2. Lo que ya está anotado en HEREDADO.md:** pico real con reintento tras codificar en AAC (hoy el
margen es −1,86 contra −1), zonas seguras por plataforma (TikTok, Shorts y Reels difieren), contraste
WCAG del texto y la decisión pendiente de 17 car./s (DECISIONES.md §3).

**Q3. Revisión visual con un modelo local** (manos, caras y texto deformes en planos generativos).
Sólo tiene sentido cuando exista G4, y sobre la hoja de contacto, no sobre cada fotograma.

**Q4. Máster de archivo** (HEVC 10 bits o ProRes) junto a la entrega: está en PRODUCTO.md §7 y no
está hecho.

**Q5. Reproducibilidad.** `regenerar` guarda prompt, semilla y modelo, e `input_hash` incluye las
versiones de ffmpeg y Hyperframes. Falta guardar el **hash de los pesos** de cada modelo, para saber
si un asset se puede volver a generar igual dentro de seis meses.

### Distribución y aprendizaje

**D1. Portada, título, descripción y hashtags.** La publicación (PUBLICAR.md) ya sube y programa,
pero la miniatura que existe es la de cada escena, no una portada diseñada. Generarla con
Hyperframes desde la plantilla (un fotograma) y proponer 3 títulos para que la persona elija.

**D2. Bucle de aprendizaje.** Es lo que más diferenciaría a Geeper: leer retención, CTR y vistas por
las APIs oficiales (YouTube Analytics es gratis; TikTok y Meta según su acceso), guardarlos por video
y **cruzarlos con lo que hay en `geeper.json`** (gancho, duración, plantilla, voz, ritmo). Claude usa
eso al proponer el próximo guion. Ningún editor cierra ese ciclo con el material editable.

Diseño a seguir (del `learning-loop` de gtavi-claudecode): lecturas a las 12, 24 y 72 h; **una prueba
por día** cambiando una sola variable (estilo de gancho, duración, hora, encuadre) con su nombre en
la fila; ningún veredicto antes de 24 h; sólo números reales (nunca estimados) y pagos sólo los que la
plataforma o la campaña muestran.

**D3. Localización** (F5): traducción con un LLM local, la misma voz clonada (G2) y subtítulos
realineados.

### Plataforma

**P1. Presupuesto de VRAM por modelo.** Hoy `gpu-lock` corre un trabajo de GPU a la vez y
`gpu-solo` libera la VRAM para Wan, y alcanza. Con G2, G4 y Q3 entran más modelos: hace falta un
registro (modelo, VRAM pico medida, si necesita `gpu-solo`) que el worker consulte antes de tomar el
candado.

**P2. Biblioteca de assets entre proyectos** con búsqueda por contenido (embeddings de imagen local),
para reusar planos, música y efectos con su licencia.

## 3. Orden recomendado

| Paso | Qué | Por qué primero |
|---|---|---|
| 1 | B1 esquema v2 + E1 vista previa en vivo | Base de todo el editor; la vista previa es la mayor mejora de experiencia y no usa GPU |
| 2 | G1 director + G2 voz nueva (medida) + E5 | El salto de calidad que más se nota en el video final |
| 3 | E2 edición por texto + G3 música, pulsos y efectos | Edición rápida y ritmo profesional |
| 4 | G4 planos generativos con consistencia y escalado | Lo caro, sobre una base ya sólida |
| 5 | D1 + D2 bucle de aprendizaje | Convierte a Geeper en algo que mejora solo con cada video |
| 6 | E3, E4, G5, Q1–Q5, D3, P1, P2 | Según el uso real |

## 4. Lo que no conviene perseguir

- Colaboración multiusuario, nube o SaaS: rompe US$0 y el uso es interno.
- Avatares hablando y sincronización de labios: caros, de calidad irregular en local y poco útiles
  para los canales actuales. Revisar en 2027.
- Edición manual de nivel profesional (corrección de color avanzada, multicámara): para eso está
  Resolve, y el `.otio` ya permite pasarle la pieza.
- ACES u OCIO: ya se descartó (PRODUCTO.md, anexo).

## Anexo: segunda opinión (Nemotron Ultra, 2026-11-18)

**Aceptado:** el esquema v2 va antes que cualquier otra cosa del editor y debe ser un superconjunto de
OTIO (la exportación actual pierde información); contrato estricto para la salida del director;
confianza de la alineación antes de la edición por texto; licencias que bloquean el uso comercial;
hash de los pesos para reproducir; registro de VRAM por modelo cuando entren más; las voces nuevas
empujan la reedición hacia la GPU; Wan 14B y LTX-2.3 como pruebas, no como plan.

**Descartado o corregido:**
- *«La vista previa en vivo compite por VRAM con TTS y video»*: no, corre en Chrome; en WSL Chrome
  captura por software (DECISIONES.md §5). Se mantiene en el paso 1.
- *«Wan 5B tarda 45–70 s por 2 s en una 5080, no 5 min»*: los ~5 min están medidos en esta PC. Sin
  medición propia no se cambia la cifra. Vale como prueba: medir con `torch.compile` y cuantización.
- *«GSAP no es determinista y habrá desfase de audio y video»*: Hyperframes salta cada fotograma a un
  tiempo exacto, y el QC mide duración, fps y desfase de audio en cada render sin fallos hasta hoy.
- *«Rec.709 exige una LUT 3D sRGB → BT.1886»*: desproporcionado para material generado en sRGB; ya
  se decidió exportar en Rec.709 con las etiquetas correctas (PRODUCTO.md, anexo).
- *«Hace falta una estrategia de I/O con tuberías o RAM disk»*: no aplica a piezas de 1–2 min; se
  revisa si llegan videos largos.

## Fuentes del estado del arte (nov. 2026, blogs comparativos: verificar cada licencia en la ficha del modelo)

- Video local: [aimagicx](https://www.aimagicx.com/blog/open-source-ai-video-models-comparison-2026),
  [vdf.ai](https://vdf.ai/blog/best-local-video-generation-models/),
  [ltxworkflow](https://ltxworkflow.com/blog/ltx-2-3-vs-hunyuanvideo-vs-wan2-2-comparison-2026).
- Voz: [findskill](https://findskill.ai/blog/best-open-source-tts-2026/),
  [localaimaster](https://localaimaster.com/blog/local-ai-voice-clone),
  [scriptbyai](https://www.scriptbyai.com/best-open-source-tts-models/).
- Editores comerciales: [opus.pro](https://www.opus.pro/blog/best-ai-video-editors),
  [egoistai](https://egoistai.pages.dev/articles/ai-video-editors-compared-2026).
