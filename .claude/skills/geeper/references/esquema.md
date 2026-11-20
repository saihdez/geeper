# El esquema de geeper.json (v2), en corto

Definido con Zod en `src/lib/esquema.ts` (la referencia exacta). El esquema completo como JSON Schema
2020-12 está en `docs/esquemas/geeper.schema.json` (sin las reglas de consistencia, que sólo están en Zod). Un `geeper.json` v1 se migra solo al
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

