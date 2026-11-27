# Música y efectos libres

24 pistas de música en bucle (`musica/`) y 88 efectos de sonido (`efectos/`), en Opus dentro de Ogg
(unos 7 MB). Son **CC0-1.0**: se pueden usar, cambiar y publicar, también con fines comerciales, sin
dar crédito.

- **De dónde salen:** la biblioteca de audio de Doory, [shaongitbd/doory](https://github.com/shaongitbd/doory),
  `backend/data/audio/` y `backend/data/audio_library.json`, commit `a05f1a8` (release 2026.10.1).
  Su `THIRD_PARTY.md` dice que son obra original sintetizada por código (osciladores, filtros, reverb; sin
  muestras, grabaciones ni música de terceros) y dedicada al dominio público con CC0-1.0.
- **Qué se copió:** sólo los archivos de audio, sin cambios, y sus datos (título, ánimo, bpm, duración,
  sha256). El código de Doory tiene otra licencia (Attribution Assurance License) y **no** se copió nada de él.
- **`biblioteca.json`:** los datos de cada archivo, sacados de `audio_library.json` y comprobados contra
  su sha256. Los nombres en español y los grupos están en `src/lib/audio-libre.ts`.

Para actualizar: bajar la versión nueva de Doory, copiar `backend/data/audio/{music,sfx}` aquí como
`musica/` y `efectos/`, regenerar `biblioteca.json` y correr `pnpm vitest run tests/audio-libre.test.ts`
(comprueba los sha256 y que cada efecto tenga nombre en español).
