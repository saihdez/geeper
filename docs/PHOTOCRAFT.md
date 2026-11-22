# Geeper — PhotoCraft

<!-- 2026-11-19 · PhotoCraft 0.23.1 (45066c482, 2026-11-12) -->

[PhotoCraft](https://github.com/storytold/photocraft) (MIT o Apache 2.0) es una reimplementación
«clean-room» de Photoshop en Rust: capas, máscaras, ajustes, estilos de capa, texto, vectores y PSD
reales. Todo lo que hace la interfaz es un comando de un registro de ~1000, y esos mismos comandos se
pueden correr desde un CLI sin ventana (`photocraft-cli`), un canal JSON o un servidor MCP. Corre
offline, sin cuenta y sin GPU si se le pide. Encaja con Geeper: cuesta US$0, es local y su licencia
permite el uso comercial.

## 1. Qué se tomó y qué no

| De PhotoCraft | En Geeper | Dónde |
|---|---|---|
| Variables y Data Sets (`image.variables.*`, `image.applyDataSet`) | **Portada del video**: hasta 3 opciones, la persona elige una | `src/lib/photocraft.ts`, `src/lib/portada.ts`, panel «Portada del video» |
| `layer.smartObjects.replaceContents` | Diseños de portada propios hechos en Photoshop o Photopea | `src/lib/apariencia.ts`, Plantillas → «Color y portada» |
| `type.info` / `type.setStyle` (líneas ya maquetadas) | El título que no entra en su caja se achica de a 10 % | `componer()` |
| Looks `colorLookup` (warm, cool, tealOrange…) + `file.export.colorLookupTables` | **Look de color por canal**, horneado en una LUT `.cube` que ffmpeg aplica a cada clip | `src/lib/looks.ts` |
| Capas de ajuste Levels + Vibrance en la misma LUT | **Mejora automática** de las imágenes hechas con IA | `src/lib/looks.ts` |
| `run` / `info` sin ventana, con `--no-gpu` | Motor de imágenes del servidor y del worker; no compite con `gpu-lock` | — |
| Releases firmadas con SHA256SUMS | **Instalar con un clic** desde Sistema | `src/lib/instalar-photocraft.ts` |
| Servidor MCP (`photocraft-cli mcp --headless`) | Que Claude retoque una portada o un diseño | §6, documentado y no registrado |

**No se tomó:**
- La app de escritorio, los pinceles y los filtros: Geeper no edita fotos a mano.
- Los formatos exóticos (Affinity, XCF, KRA, PDN): los diseños son PSD o `.pcraft`.
- El código Rust: Geeper llama al binario publicado.
- Su metodología (scorecard, presupuestos de rendimiento, paridad con Photoshop): es de otra escala.
- `batch` sobre las imágenes `openai-image-*.png` de MPT: el video usa los clips ya animados por MPT,
  así que la mejora va sobre los clips (§4), no sobre las imágenes fijas.

## 2. Portada del video (panel en cada proyecto)

En tres pasos, sin saber nada de diseño:

1. **Elegir la imagen:** una miniatura por escena, sacada del clip de origen, que no trae subtítulos
   ni el chip de marca.
2. **Elegir los títulos:** la IA local propone 3 al abrir el panel; se pueden editar o pedir otros.
3. **Elegir el diseño:** «Título abajo», «Título al centro» o «Banda de color», o el diseño propio
   del canal si lo hay.

«Crear portadas» arma una opción por título (~1 s cada una, CPU) y «Usar esta» la deja como la
portada del video (`<proyecto>/portada/portada.jpg`). El archivo `portada.json` guarda la elegida,
las opciones y los títulos propuestos, cada uno con su procedencia: escena, asset y segundo de
origen, versión, diseño, motor y avisos. No hace falta haber renderizado. Si el video cambia
después, el panel avisa que conviene rehacer la portada.

**Títulos con IA** (`src/lib/titulos.ts`): usa Gemma (`gemma4:12b`, o `GEEPER_LLM_TITULOS`), que ya
corre en el contenedor `mpt-ollama` de MPT, con `docker exec`, porque Ollama no expone puerto al host.
Toma el `gpu-lock` sin esperar. Si la GPU está ocupada o Docker está apagado, ofrece el nombre y el
tema como títulos sugeridos y explica por qué en una línea. El prompt prohíbe inventar cifras o
promesas que el guion no diga.

**Diseños base** (`pasosPlantillaBase`): se arman con los colores, las fuentes y la marca del canal y
se guardan en `~/geeper-data/portadas/plantillas/`. Miden 1280×720 (lo que pide YouTube), 1080×1920
o 1080×1080. En vertical el título queda por encima de los botones de la app. En «Banda de color» el
texto es negro o blanco según el contraste WCAG con el color de la marca.

## 3. Plantillas → «Color y portada»

Es un modo aparte del editor de la plantilla: no se abren los dos a la vez, porque el editor guarda
la plantilla entera desde su copia y pisaría estos cambios. Cada clic se guarda al momento y solo
toca `color` y `portada.estilo` (`PATCH /api/plantillas/:slug/apariencia`).

- **Look de color:** 9 muestras sobre una imagen real del canal (o un degradado si todavía no hay
  videos). Opciones: Natural, Cálido, Frío, Cine, Película antigua, Dramático, Revelado cruzado,
  Blanco y negro y Noche. Un deslizador regula «cuánto se nota».
- **Mejorar automáticamente las imágenes hechas con IA:** Niveles por canal calculados de 3
  fotogramas de cada clip, más Vibrance +12. Recorta el 0,5 % de cada punta, corrige solo la mitad
  del tinte para no «arreglar» un atardecer, y nunca sube el negro de 40 ni baja el blanco de 200. No
  toca los videos que sube la persona (solo `source: "mpt"`).
- **Diseño de las portadas:** los 3 estilos con su muestra.
- **Diseño propio (.psd):** se sube y Geeper lo revisa (`revisarDiseno`): dice en palabras simples
  qué encontró, qué falta y qué está mal, deduce el formato por la proporción y muestra cómo queda.
  «Quitar» vuelve a los estilos listos.

### Cómo se hace un diseño propio

Cualquier PSD sirve (de Photoshop, Photopea o PhotoCraft). Las capas cuyo nombre empieza con `@` son
variables:

| Capa | Clase | Qué hace Geeper |
|---|---|---|
| `@titulo` | Texto (mejor de párrafo, con caja) | Reemplaza el texto y conserva el estilo. Si no entra, lo achica de a 10 % hasta el 50 % y avisa si ni así entra |
| `@imagen` | Píxeles | La imagen cubre la capa, recortada al centro |
| `@imagen` | Objeto inteligente | Recorta la imagen a la proporción de la capa con ffmpeg y reemplaza el contenido |
| `@marca` | Texto | El nombre del canal |

## 4. Color en el video

`prepararColor` hornea una LUT de 33³ por combinación de ajustes (caché compartida en
`~/geeper-data/color/luts/`) y crea una copia de cada clip visual con `lut3d` en
`<proyecto>/assets/color/`. Codifica con libx264 CRF 16 y un keyframe por segundo, para que la vista
previa pueda saltar. `compilar(…, sustitutos)` usa esas copias: el `geeper.json` no cambia, y los
textos, subtítulos y la marca no se tiñen. Corre en el render (etapa «Aplicando el color del canal»)
y en la vista previa en vivo. Primera vez: ~7 s para 5 clips de un short; después, desde la caché.
Los niveles de cada clip se guardan por hash del asset.

## 5. Publicar con la portada (YouTube)

Al publicar un video horizontal en YouTube, el título se precarga con el de la portada elegida y
aparece «Usar la portada del video como miniatura» (marcada por defecto). Al encolar se congela una
copia (`portada/publicada-<render>.jpg`). Después de publicar se sube con `thumbnails.set`: usa el
permiso `youtube.upload` que ya se pide al conectar la cuenta y gasta 50 unidades de cuota.

- Si YouTube la rechaza (por ejemplo, un canal sin verificar por teléfono), el video queda
  publicado y la publicación muestra el aviso.
- Si se agotó la cuota, el trabajo espera y al reanudar reintenta solo la miniatura.
- En los Shorts no se ofrece: YouTube elige la miniatura desde su app.

## 6. Instalación

**Con un clic:** Sistema → «PhotoCraft (portadas)» → «Instalar con un clic». Baja el tarball oficial
de Linux de la versión fijada (`PHOTOCRAFT_VERSION` en `src/lib/rutas.ts`, hoy 0.23.1), verifica su
SHA256 contra `SHA256SUMS.txt` de la misma release, lo descomprime en
`~/dev/video-tools/photocraft/<versión>` y apunta `actual` ahí. Las sumas vienen del mismo lugar que
el archivo: garantizan que la descarga llegó entera, no quién la publicó. Para verificar la firma
GPG, usar los `.asc` de la release a mano.

**A mano:**

```sh
V=0.23.1; D=~/dev/video-tools/photocraft; mkdir -p $D && cd $D
curl -fsSLO https://github.com/storytold/photocraft/releases/download/v$V/SHA256SUMS.txt
curl -fsSLO https://github.com/storytold/photocraft/releases/download/v$V/photocraft-$V-linux-x86_64.tar.gz
grep "linux-x86_64.tar.gz$" SHA256SUMS.txt | sha256sum -c -
mkdir -p $V && tar -xzf photocraft-$V-linux-x86_64.tar.gz -C $V
ln -sfn $D/$V/photocraft-$V-linux-x86_64 $D/actual
```

Para cambiar de versión: subir `PHOTOCRAFT_VERSION`, instalar con el botón y correr
`pnpm run test:reales -- tests/photocraft.test.ts` (`pnpm test` salta las pruebas reales). El test
«PhotoCraft real» compone una portada de verdad. Además, `DISENO_BASE` (portada) y
`VERSION_COLOR` (looks) invalidan sus cachés. `GEEPER_PHOTOCRAFT` apunta a otro binario.

**MCP para Claude (opcional):**

```sh
claude mcp add photocraft -- ~/dev/video-tools/photocraft/actual/bin/photocraft-cli mcp --headless \
  --automation-read-root ~/geeper-data --automation-write-root ~/geeper-data
```

## 7. Trampas de PhotoCraft 0.23.1 (verificadas y cubiertas)

- Los ids de capa cambian cada vez que se abre el PSD: se leen con `info` justo antes de usarlos.
- Las variables no se guardan en el PSD: Geeper las define en cada `run`.
- El reemplazo de píxeles en un objeto inteligente no hace nada y no avisa. Por eso se usa
  `replaceContents`, y la imagen se recorta antes porque `replaceContents` la estira.
- Un texto de párrafo que no entra en su caja pierde las últimas líneas sin avisar. Los offsets
  cuentan puntos de código, también con emojis.
- `shape` de `type.info` es el texto `"Point"` o un objeto `{Box: …}`.
- Si falta una fuente, PhotoCraft avisa por stderr y usa otra. El panel lo muestra en palabras
  simples: por ejemplo, «Archivo Black», del canal GTA, no está en esta PC.
