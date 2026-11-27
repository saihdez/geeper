# Geeper

[English](README.en.md) · Licencia: [Apache-2.0](LICENSE) · El QC como paquete: [`shortform-qc`](packages/shortform-qc)

El estudio de video local de Dimerso: de un tema a un short terminado, **editable** y con control de
calidad. Corre en una sola PC con GPU, US$0 al mes, sin nube. Ver `docs/PRODUCTO.md` (qué es y hacia dónde va),
`docs/DECISIONES.md` (lo que cambió y por qué) y `MODELOS.md` (licencias).

## Qué hace

1. **Fábrica:** un tema (o un lote, uno por línea) → MoneyPrinterTurbo genera guion, voz e imágenes
   en la GPU → Geeper lo importa a `geeper.json` → lo compila a Hyperframes con la plantilla del canal
   → render → control de calidad.
2. **Importar** un short que MPT ya generó, sin usar la GPU (opcionalmente rehaciendo la voz).
3. **Reeditar sin GPU:** corregir subtítulos, cambiar lo que se muestra sin cambiar lo que se oye,
   quitar o reordenar escenas, poner un clip propio, cambiar de plantilla o de formato (9:16, 16:9,
   1:1) y volver a renderizar.
4. **Editar por texto:** recortar palabras de lo que se oye (se quita su audio y su tiempo), acortar
   silencios largos y quitar muletillas. Las palabras con tiempos dudosos se marcan.
5. **Efectos y capas:** transición de entrada, movimiento de cámara, velocidad y color por escena;
   textos en pantalla (título, rótulo, cita); imágenes (también SVG: logos y rótulos nítidos en todo
   formato, ver HEREDADO.md «VectorCraft») o videos encima y efectos de sonido en su
   segundo; música alineada para que los cortes caigan en el pulso.
6. **Regenerar la voz** de una escena o del guion (Kokoro de MPT, en CPU) y realinear los subtítulos.
   **Elegir la voz escuchándola** o crear una nueva describiéndola («narradora cálida de documental»):
   VoxCPM2 propone 3 y la elegida queda en la biblioteca `~/geeper-data/voces` (GPU, ~6 GB).
   **Versión en otro idioma** (inglés, portugués, francés, italiano): una copia traducida con Gemma
   local, voz nueva, subtítulos realineados y render; el original no cambia.
   **Efectos de sonido** desde una lista o descritos con palabras (MOSS-SoundEffect, GPU): quedan en
   la biblioteca `~/geeper-data/efectos` y la segunda vez entran al instante.
   Lo recortado ya no se vuelve a decir.
7. **Descargar** el render (H.264 High CRF 20, ~4 Mbps: un short de 57 s pesa ~31 MB), sus subtítulos
   `.srt` y, si se pide, un máster de archivo `.mov`, sólo si pasó el QC: −14 LUFS y pico ≤ −1 dBTP
   (con reintento del limitador si el AAC lo sube), Rec.709 rango limitado,
   duración/fps/resolución/fotogramas exactos, sin congelados, subtítulos ≤ 42 car./línea, ≤ 2 líneas y
   ≤ 17 car./s, texto dentro de la banda segura (la de cada plataforma elegida en 9:16), licencias
   comerciales si el proyecto es de uso comercial, tiempos de la voz creíbles y cortes en pulso
   (aviso), más una hoja de contacto por render.

Cada guardado de `geeper.json` es una versión; se puede volver a cualquiera desde «Historial».

## Instalación

Requisitos (ya están en esta PC; `pnpm run doctor` los verifica): Node 24, pnpm 10, Docker Desktop con
los contenedores de MoneyPrinterTurbo, `~/.local/bin/ffmpeg` con NVENC, `~/dev/video-tools` (gpu-lock,
`mpt_acabado.py`, venv de OpenMontage) y Python 3.

```bash
cd ~/dev/dimerso/products/geeper
pnpm install
pnpm run setup        # genera el cliente de Prisma, crea ~/geeper-data/geeper.db y las plantillas
pnpm run doctor       # sólo lectura: dice qué falta y cómo arreglarlo
```

La primera vez, `npx hyperframes@0.9.27` se descarga solo (necesita internet).

## Uso

```bash
pnpm run dev:up       # web en http://localhost:3300 + worker, en una terminal. Ctrl+C apaga los dos.
```

- **Proyectos** (`/`): lista con estado, avance y último render.
- **Nuevo** (`/nuevo`): elige de dónde sale el video.
  - «Desde un tema»: tema o lote, formato y plantilla. Generar usa la GPU: pide confirmar que guardaste
    tu trabajo (Windows se ha reiniciado sin aviso durante generaciones).
  - «Desde una página web»: link, vertical u horizontal, movimiento (cinematográfico 3D o sencillo) y lo que
    dice la voz. Geeper recorre la página solo (sin tocar el mouse), hace la voz, arma el proyecto y lo
    renderiza con QC. Sin GPU, 3–5 min. Idea de cap-demo de Cap (HEREDADO.md «Cap»).
- **Proyecto** (`/proyectos/<id>`): vista previa «En vivo» (cada cambio guardado se ve al instante, sin renderizar) y «Último render», QC, escenas con miniatura, texto, tiempos y
  subtítulos editables, ajustes, historial y trabajos del proyecto. En cada escena, «Animar esta escena con IA» convierte su imagen
  en un video corto con movimiento (Wan2GP en la GPU de esta PC; se instala una vez desde Sistema). «¿Qué se ve?»
  marca sobre la miniatura qué parte del clip entra en el video; si hay una cara, el encuadre automático
  la sigue (los proyectos viejos se revisan solos la primera vez que se abren).
  También la **portada** en tres pasos (escena, títulos que propone la IA local, diseño), que se sube
  como miniatura al publicar en YouTube. Ver `docs/PHOTOCRAFT.md`.
- **Avatares** (`/avatares`): crea un personaje realista o animado describiéndolo o desde una foto (con
  consentimiento), elige entre varias opciones y retócalo con una frase («ponle lentes»). En cada proyecto,
  **Presentador** lo pone en una ventana comentando encima de todo el video con su voz: en una burbuja o
  recortado sin fondo, como un streamer (InfiniteTalk en Wan2GP; ver HEREDADO.md «ComfyUI»). En cada escena con video,
  **Rehacer la toma** cambia a la persona por uno de tus avatares (copia sus gestos y su boca) o vuelve a
  filmarla con otro movimiento de cámara, elegido viéndolo sobre tu propia escena.
  **Tu avatar en el video**: el protagonista. Elígelo en «Nuevo» (o en el editor) y sale en todas las escenas,
  dentro del fondo que se generó para cada una y como única persona del video, hablando a cámara con su voz
  y gesticulando (medio cuerpo o completo; `src/lib/protagonista.ts`).
  En cada escena: que hable, que haga algo (caminar, jugar, celebrar…) o que muestre tu producto.
- **Workflows** (`/workflows`): las recetas oficiales de ComfyUI (imágenes, video, música, voces, 3D) para usar
  sin saber de nodos: buscar, subir tu archivo o escribir lo que quieres, y «Crear». ComfyUI se instala con un
  clic en la misma página; cada receta baja sus modelos al usarla. Las de pago aparecen bloqueadas; las que
  usan código de la comunidad piden tu permiso y sólo instalan la versión revisada. Lo que sale se pone en
  una escena de tus videos con «Usar en un video».
- **Escenas 3D** (`/escenas-3d`): títulos, logos, productos en un pedestal, fondos en movimiento y una caja
  sorpresa en 3D, hechos con Blender (se instala con un clic). Eliges la plantilla viéndola moverse, cambias
  texto, foto o logo y colores, o la describes con tus palabras y el modelo local elige los ajustes. También en
  cada escena del editor («Escena 3D aquí»): al terminar se pone sola en esa escena (`src/lib/escenas3d.ts`).
- **Cámara 3D**: cada foto de escena gana profundidad (Depth Anything V2 Small) y una cámara de verdad se mueve en
  Blender, con paralaje y desenfoque; reemplaza el zoom plano en «Rápido», es el plan B si Wan falla y está en
  cada escena con foto del editor (`src/lib/camara3d.ts`).
- **Asistente** (arriba en cada proyecto): lo que mejoraría el video, de lo que bloquea la descarga a las
  ideas, con «Hacerlo» cuando es una edición (queda como versión nueva) o «Ir ahí» cuando hay que decidir.
  En Claude Code, el agente `geeper-experto` hace la revisión completa (`.claude/agents/geeper-experto.md`).
- **Trabajos** (`/trabajos`): avance en vivo, log, relanzar o cancelar.
- **Anuncios** (`/anuncios`): campañas con brief, conceptos (cada uno genera su video con el guion
  exacto), revisión pass/fail/sin saber por ubicación, diseño de prueba A/B y exportación. Geeper no
  toca las cuentas de anuncios. Ver `docs/ANUNCIOS.md`.
- **Plantillas** → «Color y portada»: look de color del canal (9, con muestras), mejora automática de
  las imágenes hechas con IA y diseño de portada (3 listos o un .psd propio).
- **Plantillas**: editor visual (marca, logo, colores con su legibilidad y arreglo de un toque, letra, cierre,
  música) con vista previa; colores sacados del logo; «Duplicar» para probar sin tocar los proyectos.
- **Media**: las apps Craft de storytold (PhotoCraft, FilmCraft, VectorCraft, EffectCraft, LightCraft, DesignCraft,
  PdfCraft, SoundCraft…) con su interfaz original, en su versión web oficial: «Instalar» (release fijada, SHA256) y
  «Abrir» a pantalla completa. Se instalan en `~/dev/video-tools/<app>-web/` (`src/lib/craft-web.ts`).
- **Sistema**: el diagnóstico del doctor.
  Abajo, «Novedades de los repos integrados»: Geeper mira una vez al día si los repos de los que salió
  (`docs/fuentes.json`: apps Craft, Hyperframes, MoneyPrinterTurbo, claude-ads, gtavi-claudecode, YuNet)
  publicaron versiones o cambios. Las apps de Media se actualizan con un clic (con «Volver a la …»); lo
  demás lo revisa Claude con la skill `/novedades` (`scripts/novedades.ts`: informe, `--probar` un CLI nuevo
  al lado del actual, `--marcar` revisado).
- **Buscar acción** (Ctrl+K o ⌘K, o el botón de la barra): escribe lo que quieres hacer («quitar silencios»,
  «16:9», «renderizar») y Enter.

Desde la terminal (útil para Claude, ver `.claude/skills/geeper/SKILL.md`):

```bash
pnpm tsx scripts/importar-mpt.ts <task_id> "<tema>" [9:16|16:9|1:1] [plantilla]
pnpm tsx scripts/proponer.ts <slug> propuesta.json [--aplicar] [--informe]   # valida y muestra diferencias
pnpm tsx scripts/encolar.ts <slug> render.entregar
pnpm tsx scripts/revisar-subtitulos.ts <slug>                       # QC de subtítulos sin renderizar
pnpm tsx scripts/recomendar.ts <slug> [--json]                     # lo que el «Asistente» recomienda mejorar (sin GPU)
pnpm tsx scripts/exportar-otio.ts <slug>                           # .otio con rutas de Linux (en la web: «Terminar en otro editor», con rutas de Windows y guía)
pnpm tsx scripts/analizar-caras.ts <slug> [--aplicar]             # busca caras para el reencuadre (lo nuevo lo hace solo)
pnpm tsx scripts/plano.ts <slug> <escena> [--probar]              # animar una escena con Wan2GP (usa la GPU; en la web: «Animar esta escena con IA»)
pnpm tsx scripts/instalar-wan2gp.ts                                # instala Wan2GP (en la web: Sistema → «Instalar con un clic»)
pnpm tsx scripts/demo-web.ts <url> [--formato 9:16] [--estilo plano]  # demo de producto desde una web (tarjeta 3D, sin audio; HEREDADO.md «Cap»)
pnpm tsx scripts/avatar.ts crear "<descripción>" [--estilo animado-3d] [--probar]   # avatares y presentador (ver el script)
```

**Clips de material largo** (VOD, video publicado o grabación propia; nunca un directo en vivo): desde la
página **Clips** (`/clips`: un asistente de 3 pasos —elige tu video, elige un momento, ajusta y crea— pensado para
quien no sabe de video; sugiere ganchos con el modelo local de MPT si Docker está encendido, y «Mejorar la voz»
—quita ruido de fondo y empareja el volumen, con «Escuchar antes y después»— viene encendido) o desde la terminal:

```bash
pnpm tsx scripts/momentos.ts <url|archivo> [--top 8] [--min 15] [--max 40] [--idioma es]   # candidatos.md
pnpm tsx scripts/importar-clip.ts <fuente-id> <inicio> <fin> --encuadre react|cara|contener|cubrir \
  [--titulo "…"] [--gancho "…"] [--permiso "campaña de X, 2026-11-19"] [--campania c.json] [--sin-render]
```

El clip queda como cualquier proyecto (subtítulos, recortar palabras, quitar escenas, QC); la imagen
sigue a la voz al recortar. Sin `--permiso` la licencia queda «revisar». Las fuentes viven en
`~/geeper-data/_fuentes/<id>/`. Necesita el venv `~/dev/video-tools/venvs/geeper-clips` y el modelo
YuNet (`pnpm run doctor` dice cómo instalarlos). En cualquier proyecto 9:16, una escena con video
horizontal (p. ej. un clip propio subido) se puede reencuadrar siguiendo la cara desde su tarjeta
(«Seguir la cara»).

Datos de cada proyecto en `~/geeper-data/<slug>/`: `geeper.json`, `assets/`, `renders/`
(`v<N>-<perfil>.mp4`, su `.qc.json` y la hoja de contacto), `manifiestos/`, `logs/` y `build/` (el
proyecto Hyperframes compilado; se abre con `npx hyperframes@0.9.27 preview build/hf-9x16`).

## Cómo está hecho

- Next.js 16 (App Router) + TypeScript estricto + Prisma 7 sobre SQLite (`~/geeper-data/geeper.db`).
- **Cola en SQLite** con lease: un worker (`pnpm run worker`) con un ejecutor por motor (`mpt`, `voz`,
  `render`). Cada paso calcula `input_hash` y deja manifiesto; si se corta, al relanzar se saltan los
  terminados. Al arrancar detecta reinicios de Windows (Kernel-Power 41 y arranque de WSL) y marca
  «interrumpido» lo que corría; lo de GPU nunca se reintenta solo.
- **`geeper.json`** (esquema Zod v1, `src/lib/esquema.ts`) es la fuente de verdad, con pistas, clips con
  rango y marcadores al estilo OpenTimelineIO. Hyperframes es un destino de compilación.
- Todo lo que usa la GPU pasa por `~/dev/video-tools/bin/gpu-lock`.

## Tiempos medidos (2026-11-17, RTX 5080, shorts de 45–57 s)

| Paso | Tiempo |
|---|---|
| `pnpm run doctor` | 5 s |
| Importar un short de MPT (copiar + whisper `medium` en CPU + escenas) | 30 s |
| Regenerar la voz del guion (MPT `/audio`, Kokoro en CPU) | 10 s |
| Realinear subtítulos (whisper `medium` en CPU) | 30 s |
| Render completo: mezcla 0,4 s + check 4–7 s + render NVENC 30–46 s + loudnorm y codificación de entrega 14 s + QC 6 s | 55–71 s |
| Reeditar (2 subtítulos, quitar escena, pasar a 16:9) y renderizar, sin GPU para generar | 58 s |
| Relanzar un render interrumpido (se saltan mezcla y check) | 53 s |
| Render con ediciones v2 (recorte, transiciones, movimiento, color, 2 textos, superposición, 3 plataformas) y máster ProRes, short de 51 s (2026-11-18) | 212 s (el máster: 159 s y 2,1 GB) |
| Volver a renderizar una versión sin cambios de imagen ni sonido (p. ej. sólo «uso comercial») | 6 s |
| Generar un tema con MPT (GPU) | **sin medir en Geeper** (el dueño no autorizó GPU en esta sesión; MPT solo tardaba ~3 min) |

## Limitaciones conocidas

- **Legibilidad:** con la voz a 0,85, 3 de 4 shorts pasan la regla de ≤ 17 car./s; el cuarto queda en
  17,4. Decisión pendiente en `docs/DECISIONES.md` §3.
- **Música:** la de MPT (`resource/songs`) tiene licencia desconocida; el QC lo avisa. Conviene poner
  una carpeta con licencia clara en la plantilla.
- Chrome renderiza por software en WSL (Hyperframes no ve la GPU desde Linux); NVENC sí se usa.
- La vista «En vivo» es la composición sin renderizar (player oficial de Hyperframes): el QC y la descarga son del render.
- Corregir un subtítulo se pierde si después se regenera la voz con otras palabras.
- El worker no recarga código en caliente: tras cambiar código, reinicia `dev:up`.
- M5 (plano Wan) no está hecho; era opcional.

## Apagar todo

```bash
# En la terminal de dev:up: Ctrl+C (apaga web y worker; lo que corría queda «interrumpido»).
pkill -INT -f "scripts/dev-up.ts"          # si dev:up quedó en segundo plano
```

Geeper no levanta servicios propios: MoneyPrinterTurbo sigue en Docker como antes
(`cd ~/dev/MoneyPrinterTurbo && docker compose stop` si quieres apagarlo; nunca `down -v` ni `prune`).
Los contenedores de Farol no se tocan.

## Desarrollo

```bash
pnpm run typecheck && pnpm run lint && pnpm test
pnpm tsx scripts/ui/capturas.ts /tmp/capturas [proyectoId]   # UI a 1440 px y en teléfono, sin errores
pnpm tsx scripts/ui/reeditar.ts <proyectoId> /tmp/capturas    # reedición completa desde la UI
pnpm tsx scripts/ui/editar-texto.ts <proyectoId>               # recortar y restaurar una palabra con clics
pnpm tsx scripts/ui/desborde.ts /proyectos/<id> 390            # qué elementos se salen del ancho
```

Para probar sin tocar `~/geeper-data`, apunta a otra carpeta y otra base (el seed crea las plantillas):

```bash
GEEPER_DATA=/tmp/geeper-prueba GEEPER_DB=/tmp/geeper-prueba/geeper.db pnpm exec prisma db push
GEEPER_DATA=/tmp/geeper-prueba GEEPER_DB=/tmp/geeper-prueba/geeper.db pnpm tsx prisma/seed.ts
```
