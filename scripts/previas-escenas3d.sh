#!/usr/bin/env bash
# Rehace los videos de muestra de las plantillas de Escenas 3D (py/blender/previas/<plantilla>.mp4), los que
# se ven en el paso 1. En CPU y con prioridad baja (no usa la tarjeta): 480×270, 5 s, unos minutos cada uno.
# Uso: scripts/previas-escenas3d.sh [plantilla...]   (por defecto, todas)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="${GEEPER_BLENDER:-$HOME/dev/video-tools/blender/actual/blender}"
HDRI="${GEEPER_HDRI:-$HOME/dev/video-tools/blender/hdri/studio_small_09_1k.hdr}"
M="$REPO/py/blender/muestras"
SAL="$REPO/py/blender/previas"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# Personajes: una voz de muestra (sólo se usa su ritmo para la boca: las muestras van sin sonido) y Rhubarb.
VOZ="${GEEPER_VOZ_MUESTRA:-$HOME/dev/video-tools/pruebas/tts-es.wav}"
RHUBARB="${GEEPER_RHUBARB:-$HOME/dev/video-tools/rhubarb/actual/rhubarb}"
boca() {
  ffmpeg -hide_banner -loglevel error -y -i "$VOZ" -ac 1 -ar 16000 "$TMP/voz.wav"
  "$RHUBARB" -q -r phonetic -f json -o "$TMP/boca.json" "$TMP/voz.wav"
  python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["mouthCues"]))' "$TMP/boca.json"
}
plantillas=("$@"); [ ${#plantillas[@]} -gt 0 ] || plantillas=(texto personaje datos logo producto fondo caja personaje-bolita personaje-robot)
for pl in "${plantillas[@]}"; do
  case "$pl" in
    texto)    extra='"texto":"¡Oferta del día!","movimiento":"entra","colores":{"fondo":"#14213d","fondo2":"#05070d","principal":"#fca311","acento":"#ffffff"}' ;;
    logo)     extra="\"logo\":\"$M/logo.svg\",\"estilo\":\"brillante\",\"colores\":{\"fondo\":\"#f4f4f4\",\"fondo2\":\"#d9dde3\",\"principal\":\"#111111\",\"acento\":\"#e63946\"}" ;;
    producto) extra="\"imagen\":\"$M/frasco.png\",\"texto\":\"\$29.99\",\"colores\":{\"fondo\":\"#fff1f3\",\"fondo2\":\"#ffd6e0\",\"principal\":\"#ff8fab\",\"acento\":\"#6c63ff\"}" ;;
    fondo)    extra='"estilo_fondo":"burbujas","colores":{"fondo":"#1a0b2e","fondo2":"#05010a","principal":"#ff2e88","acento":"#2ef2ff"}' ;;
    personaje) extra="\"personaje\":\"bolita\",\"boca\":$(boca),\"audio\":\"$TMP/voz.wav\",\"colores\":{\"fondo\":\"#e9f5f2\",\"fondo2\":\"#b9e4dc\",\"principal\":\"#ff8fab\",\"acento\":\"#6c63ff\"}" ;;
    personaje-bolita|personaje-robot)
      # Miniatura del personaje (una imagen vertical): py/blender/previas/<nombre>.jpg.
      tipo="${pl#personaje-}"
      color=$([ "$tipo" = bolita ] && echo "#ff8fab" || echo "#8d99ae")
      echo "{\"plantilla\":\"personaje\",\"personaje\":\"$tipo\",\"boca\":$(boca),\"audio\":\"$TMP/voz.wav\",\"colores\":{\"fondo\":\"#e9f5f2\",\"fondo2\":\"#b9e4dc\",\"principal\":\"$color\",\"acento\":\"#6c63ff\"},\"formato\":\"9:16\",\"duracion\":3,\"calidad\":\"rapida\",\"muestras\":24,\"escala\":22,\"salida\":\"imagen\",\"cuadro_imagen\":40,\"dispositivo\":\"cpu\",\"hdri\":\"$HDRI\",\"cuadros\":\"$TMP/$pl\"}" > "$TMP/$pl.json"
      echo "== $pl"
      nice -n 15 "$BLENDER" -b --factory-startup --python "$REPO/py/blender/escena3d.py" -- "$TMP/$pl.json" | grep -E "GEEPER_(ERROR|LISTO)" || true
      ffmpeg -hide_banner -loglevel error -y -i "$TMP/$pl/"c_*.png -q:v 4 "$SAL/$pl.jpg"
      ls -la "$SAL/$pl.jpg"
      continue ;;
    datos)    extra='"tipo_datos":"barras","texto":"Ventas por mes","datos":[{"etiqueta":"Enero","valor":120},{"etiqueta":"Febrero","valor":340},{"etiqueta":"Marzo","valor":260},{"etiqueta":"Abril","valor":510}],"unidad":"","colores":{"fondo":"#e9f5f2","fondo2":"#b9e4dc","principal":"#0f8b8d","acento":"#ec9a29"}' ;;
    caja)     extra='"texto":"¡Nuevo!","colores":{"fondo":"#2b0a0a","fondo2":"#000000","principal":"#ff4d00","acento":"#ffd166"}' ;;
    *) echo "No conozco la plantilla $pl" >&2; exit 64 ;;
  esac
  echo "{\"plantilla\":\"$pl\",$extra,\"estilo\":\"brillante\",\"formato\":\"16:9\",\"duracion\":5,\"calidad\":\"rapida\",\"muestras\":16,\"escala\":25,\"dispositivo\":\"cpu\",\"hdri\":\"$HDRI\",\"cuadros\":\"$TMP/$pl\"}" > "$TMP/$pl.json"
  echo "== $pl"
  nice -n 15 "$BLENDER" -b --factory-startup --python "$REPO/py/blender/escena3d.py" -- "$TMP/$pl.json" | grep -E "GEEPER_(ERROR|LISTO)" || true
  ffmpeg -hide_banner -loglevel error -y -framerate 30 -start_number 1 -i "$TMP/$pl/c_%04d.png" -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart -an "$SAL/$pl.mp4"
  ls -la "$SAL/$pl.mp4"
done
