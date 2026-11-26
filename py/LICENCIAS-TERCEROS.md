# Código de terceros en py/

## Bodila51/gtavi-claudecode (commit dd95d39)

- `py/facecam.py`: copia de `scripts/facecam.py` (sólo cambia cómo se encuentra el modelo).
- `py/reencuadre.py`: el layout react y `game_offset` vienen de `scripts/cut.py`.
- `src/lib/momentos.ts`: puntaje de momentos portado a TypeScript desde `scripts/moments.py`.

```
MIT License

Copyright (c) 2026 Bodila51

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## YuNet (opencv_zoo, `face_detection_yunet_2023mar.onnx`)

MIT (OpenCV Zoo). Se descarga una vez a `~/.cache/geeper/modelos` y se verifica por sha256.

## Blender (escenas 3D, `py/blender/`)

`py/blender/escena3d.py` es código propio que corre dentro de Blender (GPL-2.0-or-later). Blender no viaja
con Geeper: se baja de blender.org al instalarlo y corre como programa aparte. Los videos que produce son de
quien los hace (la licencia de Blender no alcanza a lo que se crea con él).

## Poly Haven: «Studio Small 09» (Sergej Majboroda)

CC0. HDRI de 1k para la luz y los reflejos de las escenas 3D; se baja al instalar Blender y se verifica por
sha256 (`src/lib/blender.ts`). `py/blender/muestras/` (frasco y logo de ejemplo) son propios.

