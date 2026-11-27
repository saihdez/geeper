---
name: geeper
description: Proponer cambios a un proyecto de Geeper (geeper.json) y sacar clips de material largo (VODs, videos, grabaciones) con ganchos — corregir subtítulos, recortar palabras o silencios, quitar o reordenar escenas, transiciones y efectos, textos en pantalla, superposiciones, formato, plantilla, voz, destino — validados con el esquema y mostrados como diferencias antes de aplicarlos. Úsala cuando la persona pida editar un video de Geeper o entender su geeper.json, para sacar clips de material largo, y para proponer conceptos, ganchos, guiones o afirmaciones de una campaña de la sección Anuncios.
---

# Geeper: editar un proyecto vía geeper.json

Geeper (`~/dev/dimerso/products/geeper`, web en http://localhost:3300) guarda cada proyecto en
`~/geeper-data/<slug>/geeper.json`. Ese archivo es la **fuente de verdad**; Hyperframes es sólo un
destino de compilación. **Nunca edites `geeper.json` ni el HTML de `build/` a mano**: propone el cambio
y deja que Geeper lo valide, muestre las diferencias y lo guarde como versión nueva.

## El esquema (v2), en corto

Definido con Zod en `src/lib/esquema.ts` (la referencia exacta). Un `geeper.json` v1 se migra solo al
leerlo (`migrar`): v2 sólo agrega campos con valor por defecto.

- `schemaVersion: 2`, `id`, `nombre`, `tema`, `formato` (`9:16 | 16:9 | 1:1`), `plantilla` (slug),
  `fps` (24, 25, 30 o 60; por defecto 30).
- `voz`: `{ motor, voz, velocidad, idioma }`: cómo se genera la **próxima** voz.
- `guion.texto`: el guion que se oye.
- `mostrar`: `[{ de, a }]`: cambia lo que se lee sin cambiar lo que se oye (`GTA seis` → `GTA VI`).
- `assets`: `{ id: { tipo, ruta, hash, source: archivo|mpt|tts|wan, licencia, duracion, ancho, alto, regenerar } }`.
  `regenerar` guarda prompt, modelo y, para los modelos locales, el sha256 de los pesos (`pesos`, `alineacion`).
- `pistas` (como OpenTimelineIO):
  - `visual` y `voz` con **un clip por escena, en el mismo orden**; `musica` opcional. Cada clip:
    `{ id, asset, rango: { inicio, duracion }, escena }`; `rango` es sobre el asset (source range). La
    posición en la línea **no se guarda**: sale del orden de la pista `voz`.
  - `sincro: "voz"` en el clip visual (clips de material largo): la imagen sigue a la voz, así
    recortar palabras corta también la imagen. No lo quites a mano.
  - Efectos del clip visual de una escena: `transicion` (`corte | fundido | deslizar | zoom | barrido |
    radial | iris | persianas`, entra sobre la escena anterior; las cuatro últimas son máscaras y aceptan
    `angulo` en grados (90 = de izquierda a derecha; en `radial`, el ángulo de inicio), `suavizado` en px
    (borde suave), `ancho` en px (persianas) y `sentido: horario|antihorario|ambos` (radial)),
    `movimiento` (`{ desde, hasta, curva? }` con `{ escala, x, y }`: Ken Burns, paneos; `curva`:
    `lineal | suave | acelera | frena`, donde `suave` es el Easy Ease de After Effects), `velocidad`
    (0,1–10), `color` (`{ brillo, contraste, saturacion }`) y `efectos`: lista en orden de aplicación,
    de hasta 8, con `{tipo:"tinte", negro, blanco (#rrggbb), cantidad 0–1}`,
    `{tipo:"niveles", entradaNegro, entradaBlanco, gamma, salidaNegro, salidaBlanco}` (0–1; gamma
    0,1–10), `{tipo:"vineta", cantidad 0–1, angulo 1–179}`, `{tipo:"desenfoque", radio px}` y
    `{tipo:"grano", cantidad 0–1, color, semilla}`. Fórmulas y límites en docs/EFFECTCRAFT.md.
  - **Pistas libres** (cualquier otro `id`, p. ej. `broll`, `efectos`): superposiciones de video/imagen
    o efectos de sonido. Cada clip lleva `inicio` en la línea final, y además `opacidad`, `volumen`,
    `transicion`, `movimiento`, `efectos` y `fusion` (modo de fusión con lo de abajo: `normal |
    multiplicar | trama | superponer | oscurecer | aclarar | sobreexponer | subexponer | luz-fuerte |
    luz-suave | diferencia | exclusion | tono | saturacion | color | luminosidad | anadir`; para luces o
    polvo sobre fondo negro, `trama` o `anadir`).
- `estilo` (opcional): estilo del video, `{ efectos?, transicion?, curva? }`. Lo heredan los clips
  visuales que no tienen el suyo (la primera escena nunca tiene entrada). En una escena, un valor propio
  es una excepción; `efectos: []` es «sin efectos» como excepción. Prefiere cambiar el estilo antes que
  repetir lo mismo en cada escena.
- `textos`: títulos, rótulos o citas superpuestos: `{ id, texto, inicio, duracion, estilo: titulo|rotulo|cita, posicion: arriba|centro|abajo }`.
- `escenas`: `{ id: { texto (lo que se oye), palabras: [{ texto, inicio, fin, confianza? }] (en el tiempo
  del asset de voz), correcciones: [{ desde, hasta, texto }], recortes: [{ inicio, fin, motivo }] } }`.
  Una corrección cambia lo **mostrado** sobre las palabras oídas `[desde, hasta)`. Un **recorte** quita
  ese tramo de la voz (y su tiempo) — es la edición por texto. La duración de una escena es la de su
  clip de voz menos sus recortes. `confianza` < 0,6 = tiempo dudoso (no recortes ahí sin escuchar).
- `marcadores`: cortes, notas y pulsos de la música (`tipo: "pulso"`).
- `comercial` (el QC bloquea licencias no comerciales o dudosas), `plataformas` (`youtube | tiktok |
  instagram | facebook`: en 9:16 estrechan la banda segura) y `entrega.master` (máster .mov).

Los subtítulos no se guardan: se calculan (grupos de hasta 4 palabras, ≤ 2 líneas, ritmo ≤ 17 car./s).

## Cómo proponer un cambio

1. Mira el estado: `cat ~/geeper-data/<slug>/geeper.json` o la página del proyecto. Para ver los
   subtítulos actuales con sus índices, `curl -s localhost:3300/api/proyectos/<id> | jq '.escenas[] | {id, grupos}'`.
   Qué conviene mejorar (lo mismo que el panel «Asistente» del editor, sin GPU):
   `pnpm tsx scripts/recomendar.ts <slug> --json`; sus `ediciones` se pasan tal cual a `proponer.ts`.
   Para una revisión completa con recomendaciones, delega en el agente `geeper-experto`.
2. Escribe una lista de ediciones en un archivo temporal. Tipos (ver `src/lib/ediciones.ts`):
   - `{"tipo":"corregirSubtitulo","escena":"e02","desde":3,"hasta":6,"texto":"nuevo texto"}`
   - `{"tipo":"quitarEscena","escena":"e05"}` (también quita lo que se oye en ella)
   - `{"tipo":"moverEscena","escena":"e05","a":0}`
   - `{"tipo":"cambiarFormato","formato":"16:9"}` · `{"tipo":"cambiarPlantilla","plantilla":"dimerso"}`
   - `{"tipo":"cambiarMostrar","mostrar":[{"de":"GTA seis","a":"GTA VI"}]}`
   - `{"tipo":"ajusteVisual","escena":"e01","ajuste":"contener","ancla":"arriba"}`
     Sin `ajuste` ni `ancla`, si el asset tiene `foco` (cara detectada con YuNet), el clip cubre el cuadro
     siguiendo la cara; fijar `ancla` lo desactiva. Proyectos viejos: `pnpm tsx scripts/analizar-caras.ts <slug>`.
   - `{"tipo":"cambiarVoz","velocidad":0.9}`
   - Edición por texto: `{"tipo":"recortarPalabras","escena":"e02","desde":3,"hasta":5}` ·
     `{"tipo":"restaurarPalabras","escena":"e02","desde":3,"hasta":5}` ·
     `{"tipo":"quitarSilencios","umbral":0.6,"dejar":0.25}` · `{"tipo":"quitarMuletillas"}` ·
     `{"tipo":"quitarRecortes"}` (todas aceptan `"escena"` para limitarse a una)
   - `{"tipo":"efectosVisual","escena":"e03","transicion":{"tipo":"fundido","duracion":0.5},"movimiento":{"desde":{"escala":1},"hasta":{"escala":1.15}},"velocidad":1.25,"color":{"saturacion":1.2}}` (`null` quita un efecto) · `{"tipo":"efectosVisual","escena":"e02","transicion":{"tipo":"barrido","duracion":0.6,"angulo":135,"suavizado":60},"efectos":[{"tipo":"tinte","negro":"#1f1408","blanco":"#fff1d6","cantidad":0.85},{"tipo":"grano","cantidad":0.08}]}`
   - Estilo del video: `{"tipo":"estiloVideo","efectos":[{"tipo":"vineta","cantidad":0.35},{"tipo":"grano","cantidad":0.08}],"transicion":{"tipo":"barrido","duracion":0.6,"angulo":90,"suavizado":60},"curva":"suave"}` (`null` quita cada parte) · en una escena, `"efectos":null`, `"transicion":null` o `"curva":null` dentro de `efectosVisual` la devuelven al estilo
   - Superposición ya agregada: `{"tipo":"editarClipLibre","clip":"broll-1","fusion":"trama","transicion":{"tipo":"iris","duracion":0.5},"efectos":null}`
   - `{"tipo":"agregarTexto","texto":{"texto":"Dato","inicio":2,"duracion":3,"estilo":"titulo","posicion":"arriba"}}` · `{"tipo":"editarTexto","id":"texto-1","cambios":{"inicio":3}}` · `{"tipo":"quitarTexto","id":"texto-1"}`
   - `{"tipo":"agregarClipLibre","pista":"broll","asset":"<id ya registrado>","inicio":6,"duracion":1.5,"fusion":"trama"}` · `{"tipo":"quitarClipLibre","clip":"broll-1"}`
     (para un archivo nuevo, súbelo desde la UI: «Superposiciones y efectos de sonido»)
   - `{"tipo":"cambiarDestino","comercial":true,"plataformas":["tiktok","youtube"],"master":false}`
   - `{"tipo":"confirmarPalabras","escena":"e02","desde":3,"hasta":4}` (sólo si la persona escuchó el tramo y confirmó que el tiempo es correcto: deja la confianza en 1)
   - `{"tipo":"fijarMusica","inicio":1.25}` (mejor: botón «Alinear cortes al ritmo», que detecta los pulsos)
   - `{"tipo":"cambiarCta","cta":"Compra hoy"}` (botón de la tarjeta final sólo de este video; `null` vuelve al de la plantilla)
   - **Pasos encadenados:** un paso usa lo que creó otro. `"$1.id"` es el id que creó el paso 1 (texto o
     clip), `"$ultimo.id"` el del paso anterior, `"${1.id}"` dentro de un texto, `$$` un `$` literal:
     `[{"tipo":"agregarTexto","texto":{"texto":"50 % OFF","inicio":1,"duracion":3}},`
     ` {"tipo":"editarTexto","id":"$1.id","cambios":{"posicion":"centro"}}]`
3. Valida y muestra las diferencias (no aplica nada):
   `cd ~/dev/dimerso/products/geeper && pnpm tsx scripts/proponer.ts <slug> /tmp/propuesta.json`
   Si un paso falla, dice cuál (`paso N (tipo): error — motivo`), omite los siguientes, no aplica nada
   y sale con código 1. Con `--informe`, la salida es un JSON (`pasos` con lo que creó cada uno en
   `resultado`, `diferencias`, `aplicada`).
4. Enséñale las diferencias a la persona. **Sólo con su aprobación**, aplica:
   `pnpm tsx scripts/proponer.ts <slug> /tmp/propuesta.json --aplicar`
5. Renderizar y regenerar la voz se piden desde la UI (botones «Renderizar» y «Regenerar voz»), o:
   `pnpm tsx scripts/encolar.ts <slug> render.entregar` · `pnpm tsx scripts/encolar.ts <slug> voz.regenerar '{"escena":null,"cadena":["render.entregar"]}'`.

## Anuncios: proponer conceptos y guiones

La sección `/anuncios` guarda campañas (brief, conceptos, revisión, prueba). Claude propone; la persona
aprueba en la app. Detalle en `docs/ANUNCIOS.md`.

1. Mira la campaña y lo pendiente: `pnpm tsx scripts/anuncio.ts listar` y
   `pnpm tsx scripts/anuncio.ts ver <id>` (brief, conceptos y cada chequeo que falla o queda «sin saber»).
2. Escribe `/tmp/propuesta.json`:
   `{"brief": {...campos...}, "conceptos": [{"nombre": "...", "marco": "pas", "gancho": "...", "promesa": "...",
   "narrativa": "...", "cta": "...", "objeciones": "...", "hipotesis": "...", "guion": "...", "principal": "youtube-shorts"}],
   "quitar": ["c-id"]}`. Un concepto con `id` existente se edita; sin `id`, es nuevo.
3. Valida y muestra las diferencias: `pnpm tsx scripts/anuncio.ts proponer <id> /tmp/propuesta.json`.
   Enséñaselas a la persona y **sólo con su aprobación** repite con `--aplicar`.

Reglas de contenido (de claude-ads):
- Conceptos **materialmente distintos** (otra idea, otro gancho), no la misma frase reescrita.
- **No inventes** cifras, testimonios, garantías, urgencia ni comparaciones. Si el guion necesita una
  afirmación, propónla en `brief.afirmaciones` con su `prueba`: entra **sin aprobar** y la aprueba la persona.
- El guion va tal cual a MPT: abre con el gancho, cierra con el CTA, frases cortas (≤ 17 car./s al leer).
- Un marco (`aida`, `pas`, `bab`, `4p`, `fab`, `historia`, `ninguno`) ordena el mensaje; no promete resultados.
- No vincules videos ni marques verificaciones manuales: eso es de la persona en la app. Generar el
  video usa la GPU y se pide desde la UI.

## Reglas

- Claude nunca está en el camino del render: sólo propone `geeper.json`.
- Nada de material de Rockstar ni de marcas ajenas en textos o plantillas.
- Todo cambio queda como una versión; la persona puede volver atrás desde «Historial».
- Generar con MPT usa la GPU: no lo lances sin permiso de la persona (Windows se ha reiniciado sin aviso).
- Hyperframes está fijado en la versión de `HYPERFRAMES_VERSION` (`src/lib/rutas.ts`, hoy 0.9.27). Las
  skills `hyperframes*`, `media-use`, `reverse-any-video` y `style-sampling` de `.claude/skills/` son
  las de esa versión; cuando digan `npx hyperframes …`, usa siempre `npx hyperframes@0.9.27 …`, nunca
  la última. Para subir de versión, actualiza a la vez la constante y esas skills (del tag `vX.Y.Z` de
  `heygen-com/hyperframes`).
- Telemetría de Hyperframes siempre apagada: `HYPERFRAMES_NO_TELEMETRY=1` y `DO_NOT_TRACK=1`. No
  ejecutes los «usage beacon» (`npx hyperframes events …`) ni `feedback` que piden esas skills.

## Clips de material largo (VODs, videos publicados, grabaciones propias)

La persona puede hacerlo todo desde la página **Clips** (http://localhost:3300/clips), un asistente de 3 pasos
con vista previa, sugerencias de gancho, «Mejorar la voz» (encendido; `mejorarVoz: false` en el pedido lo
apaga) y casilla de permiso. Por terminal:

1. **Candidatos:** `pnpm tsx scripts/momentos.ts <url|archivo> --top 8 --min 15 --max 40 --idioma <es|en>`.
   Deja `~/geeper-data/_fuentes/<id>/candidatos.md` con el porqué de cada uno (pico de sonoridad, lo
   más visto de YouTube, chat, palabras de emoción), lo que se dice y el comando para importarlo.
   Con un chat de Twitch descargado con TwitchDownloader: `--chat chat.json`. No sirve con directos en
   vivo: hay que esperar el VOD.
2. **Elige con la persona** 1 a 3 candidatos. Léelos: descarta spoilers de historia en semana de
   lanzamiento, desnudos, datos personales y lo que no se entiende sin contexto.
3. **Gancho o título** (ver abajo) y **importa**:
   `pnpm tsx scripts/importar-clip.ts <fuente-id> <inicio> <fin> --encuadre react --gancho "…" [--titulo "…"] [--permiso "…"] [--campania c.json]`.
   Encuadres: `react` (cara arriba, juego abajo: streamer con webcam sobre el juego), `cara` (sigue la
   cara a toda la altura: IRL o cámara a pantalla completa), `contener` (fondo desenfocado), `cubrir`
   (recorte al centro). Si react o cara no encuentran una cara estable, caen a `contener` y lo dicen
   en el log: revisa el primer fotograma.
4. Edita como cualquier proyecto (recortar palabras, quitar escenas, corregir subtítulos). La voz es la
   del creador: **no se regenera**.
5. El QC suma la regla «clip»: sin leaks, «jugar antes», piratería, trampas de dinero ni bots; nunca
   «oficial»; crédito del creador; duración de la campaña si se cargó.

**Permiso:** clipea a un creador sólo dentro de su campaña de clipping o con su permiso; dilo con
`--permiso` (queda en la licencia). Sin permiso, la licencia queda «revisar» y un proyecto de uso
comercial no pasa el QC. El **crédito** va en la descripción del post (`origen.clip.credito`), no en el
video. Nada se publica sin el «sí» de la persona.

### Ganchos (primeros 2,6 s) y títulos de reacción

Da 3 opciones y marca tu favorita. Frase normal (no todo en mayúsculas), 3 a 9 palabras.

- Funciona: promesa con número («3 cosas que nadie vio en este tráiler»), dato que sorprende («Este auto
  está escondido a la vista»), situación («Cuando la policía persigue al jugador equivocado»), negación
  («Esto no se podía hacer en GTA 5»), pregunta («¿Sobrevivirías a esta persecución?»), nombrar al
  creador si es conocido («Ni Kai lo vio venir»).
- No funciona: etiquetas («Clip de GTA 6», «Momento gracioso»), «espera al final», «no lo vas a creer»,
  urgencia falsa, mayúsculas por todas partes.
- **Título de reacción** (encuadre react, todo el clip, va en la costura): creador + verbo de reacción
  + a qué reacciona, con 2 o 3 palabras clave en MAYÚSCULAS: «Kai PIERDE LA CABEZA cuando llega la
  policía en GTA 6». Corto si es de contorno: 3 a 6 palabras.
- Reglas: el clip tiene que cumplir el gancho (si dice 3 cosas, muestra 3). **Nunca pongas palabras en
  boca del creador**: ni citas que no dijo ni opiniones inventadas. Datos y números verificados y
  iguales a los del clip. Escribe «GTA 6». Como mucho un emoji. Sin spoilers de historia en el gancho
  (márcalos como SPOILER en la descripción). No repitas un gancho en la misma semana.

