# Modelos, motores y material de terceros

Lo que Geeper usa, de dónde sale, su licencia y si permite uso comercial. Cada asset de un proyecto
guarda su licencia en `geeper.json` y en la tabla `Asset`; el QC avisa (sin bloquear) cuando una es
«desconocida» o «revisar». Revisado el 2026-11-18 (comparativa de modelos locales al final).

## Modelos

| Modelo | Para qué | Dónde corre | Origen | Licencia | ¿Comercial? |
|---|---|---|---|---|---|
| Z-Image-Turbo (bf16) | Imágenes de cada escena (vía MPT, `mpt-image-server`) | GPU, Docker | [Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) | Apache 2.0 | Sí |
| RealVisXL V5 Lightning | Imágenes (alternativa de MPT, SDXL) | GPU, Docker | Civitai / Hugging Face (SG161222) | OpenRAIL++-M | Sí, con las restricciones de uso de OpenRAIL |
| Gemma 4 26B MoE (`gemma4:26b`, Q4_K_M) | Guion y palabras clave (vía MPT, `mpt-ollama`) | GPU 80 % / CPU 20 %, Docker | Google Gemma 4 (Ollama) | Apache 2.0 (verificado con `ollama show --license`) | Sí |
| Gemma 4 12B (`gemma4:12b`) | Guion: alternativa más rápida (~5 s frente a ~20 s) | GPU, Docker | Google Gemma 4 (Ollama) | Apache 2.0 | Sí |
| Kokoro-82M (voz `ef_dora`) | Voz (MPT `mpt-kokoro` y `hyperframes tts`) | CPU | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache 2.0 (pesos); el fonemizador espeak-ng es GPLv3 y corre como proceso aparte | Sí |
| whisper `medium` (ggml) | Tiempos por palabra (`hyperframes transcribe`, whisper.cpp sin CUDA) | CPU | OpenAI Whisper / whisper.cpp | MIT | Sí |
| Parakeet TDT 0.6B v3 (int8) | Transcripción rápida (6–12× whisper) para directos; instalado con `hyperframes models install parakeet` | CPU (sherpa-onnx) | [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC-BY-4.0 | Sí, citando a NVIDIA |
| faster-whisper `large-v3` | Subtítulos internos de MPT (Geeper no los usa) | CPU, Docker | OpenAI Whisper / SYSTRAN | MIT | Sí |
| YuNet 2023mar (232 KB) | Dónde está la cara, para reencuadrar (`src/lib/caras.ts`) | CPU (OpenCV del venv `geeper-clips`) | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), URL fijada a un commit y SHA-256 comprobado | MIT (pesos); entrenado con WIDER FACE, cuyos términos no cubre esa licencia | Sí (los pesos); detecta, no identifica |
| Wan 2.2 TI2V-5B | Plano generativo (M5, opcional) | GPU | [Wan-AI/Wan2.2-TI2V-5B-Diffusers](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers) | Apache 2.0 (verificado en la ficha descargada, ver ESTUDIO.md) | Sí |

## Formatos y descargas (regla, 2026-11-20)

- **Pesos nuevos sólo en SafeTensors, GGUF, GGML (whisper.cpp) u ONNX.** Nunca pesos *pickle* de
  PyTorch (`.pt`, `.pth`, `.ckpt` o un `.bin` que no sea GGML): ejecutan código al cargarse. Lo que
  entra en `PESOS` (`src/lib/modelos.ts`) pasa por `formatoDePesos()` y una prueba lo exige.
- **Cada descarga fijada y comprobada:** de Hugging Face, con `revision` = un commit (no `main`); de
  GitHub, una URL con commit o release fijo. Siempre con su SHA-256 en el código y comprobado antes de
  usarlo, como YuNet en `src/lib/caras.ts`. ModelScope sólo como espejo si Hugging Face falla, con el
  mismo SHA-256.
- Los modelos dentro de los contenedores de MPT (Z-Image, RealVisXL, Gemma en Ollama, faster-whisper)
  no los descarga Geeper: se anotan por nombre y licencia, como hasta ahora.
- Estado hoy: whisper `medium` es GGML (`ggml-medium.bin`), Kokoro y YuNet son ONNX, Parakeet es ONNX
  (sherpa-onnx), Gemma es GGUF (Ollama) y Wan 2.2 se baja en SafeTensors (Diffusers). Ninguno es *pickle*.

## Motores y bibliotecas

| Pieza | Licencia | Cómo la usa Geeper |
|---|---|---|
| MoneyPrinterTurbo 1.3.10 | MIT | API HTTP en `127.0.0.1:8080` |
| Hyperframes 0.9.27 (fijado) | Apache 2.0 | CLI (`npx hyperframes@0.9.27`), telemetría apagada |
| GSAP 3.15 | Licencia estándar de GSAP (sin costo, también comercial) | Lo carga la composición de Hyperframes |
| ffmpeg 6.1 (Ubuntu) | LGPL/GPL según build | Binario aparte (`~/.local/bin/ffmpeg`) |
| OpenMontage | AGPLv3 | Sólo M5, como proceso aparte por CLI; Geeper no importa su código |
| Next.js, React, Prisma, Zod, better-sqlite3 | MIT / Apache 2.0 | Dependencias de la app |
| `@modelcontextprotocol/server` 2.4.0 (SDK v2, revisión 2026-07-28) | Apache 2.0 | Servidor MCP de Geeper por stdio (`mcp/servidor.ts`); `@modelcontextprotocol/client` sólo en pruebas |
| `@playwright/mcp` 0.0.84 | Apache 2.0 | Sólo desarrollo: lo lanza `.mcp.json` con `npx`, no es dependencia de la app |
| `@cyclonedx/cyclonedx-library` 10.4.0, `packageurl-js`, `ajv` (+ formatos) | Apache 2.0 / MIT | Sólo desarrollo: arman y validan el SBOM (`pnpm run sbom`) |
| OpenTelemetry (`@opentelemetry/api` 1.10, `sdk-trace` 3.0, `context-async-hooks` 3.0, `exporter-trace-otlp-http` 0.300) | Apache 2.0 | Trazas de trabajos, pasos, GPU y modelo local (`src/lib/trazas.ts`) |
| Phoenix (Arize), opcional | Elastic 2.0 (uso interno permitido) | Sólo si se quiere mirar las trazas en una UI: no se instala por defecto |
| Promptfoo 0.125.1 (fijado, por `npx`) | MIT | Sólo desarrollo: `pnpm run evals` compara modelos y prompts; telemetría, actualizaciones y «compartir» apagados |
| cosign v3.1.4 (Sigstore), opcional | Apache 2.0 | Binario en `~/.local/bin`: firma local de la procedencia de cada render, sin Rekor |
| c2patool 0.27.23 (C2PA), sólo evaluado | Apache 2.0 / MIT | Binario en `~/.local/bin`; no lo usa la app (DECISIONES §33) |

## Material

| Material | Licencia | Nota |
|---|---|---|
| Música de `MoneyPrinterTurbo/resource/songs` | **Desconocida** | El README de MPT dice que viene de videos de YouTube («si infringe, bórrala»). La plantilla «GTA VI Shorts» la usa para no cambiar el canal; el QC avisa en cada render. Ver `docs/DECISIONES.md`. |
| Tipografías Archivo Black, Montserrat, Inter | SIL Open Font License | Las resuelve Hyperframes |
| Clips subidos por la persona | «propia» | La persona responde por ellos |

**Nada de material de Rockstar** (logos, personajes, capturas, música) en ninguna plantilla.

## Comparativa de modelos locales (2026-11-18)

Criterio: el mejor resultado que corre en la RTX 5080 (16 GB), US$0 y con licencia comercial.
Pruebas y scripts en `~/dev/video-tools/pruebas/modelos-2026-11/`.

| Etapa | Elegido | Frente a | Medido |
|---|---|---|---|
| Guion | **gemma4:26b** | gemma4:12b | Mismo prompt que MPT, 5 temas. Evaluación a ciegas (Claude y Nemotron Ultra por separado): 26b gana 4–1; el 12b inventó un «faro de la isla de Somme» y escribe frases largas para TTS. 26b: 10–25 s por guion; 12b: ~5 s. El servidor de imágenes descarga Ollama antes de pintar (`unload_ollama`), así que caben en turnos. |
| Tiempos por palabra | **whisper medium** (sin cambio) | Parakeet v3, whisper large-v3 | Error al arrancar cada palabra tras un silencio real (mediana): medium 15–43 ms, Parakeet ~82 ms, large-v3 113–137 ms. large-v3-turbo no está en Hyperframes 0.9.27. Parakeet queda para los directos por velocidad (2–6 s frente a 25–32 s). |
| Imágenes | Z-Image-Turbo (sin cambio por ahora) | FLUX.2 klein 4B (Apache 2.0) | Pendiente la comparación lado a lado: la GPU quedó sin CUDA en WSL tras la actualización del driver 621.24. |
| Voz | Kokoro `ef_dora` (sin cambio por ahora) | Qwen3-TTS 1.7B VoiceDesign (Apache 2.0, habla español) | Pendiente (misma causa). Descartados: XTTS-v2 (licencia CPML), Fish Audio S2 (licencia de investigación), Magpie (licencia «other» sin revisar). |
| Video | Wan 2.2 TI2V-5B | LTX-2 | Medido el 2026-11-09 (ver ESTUDIO.md): techo práctico 576×1024. LTX-2 tiene licencia condicionada a ingresos. |
