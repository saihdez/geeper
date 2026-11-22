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
| VoxCPM2 (2B, bf16) | Voces diseñadas desde una descripción y dichas clonando su muestra (`src/lib/voces.ts`, `py/voz_voxcpm.py`) | GPU, ~6 GB, venv `venvs/voxcpm` (torch 2.11 cu128, sin `torch.compile`) | [openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) | Apache 2.0 (código y pesos) | Sí |
| MOSS-SoundEffect v2.0 (1,3B DiT, bf16) | Efectos de sonido desde una descripción en inglés (`src/lib/efectos-sonido.ts`, `py/efecto_sonido.py`) | GPU, pico 15,95 GB con `gpu-solo`, venv `venvs/moss-sfx` (torch 2.9 cu128) | [OpenMOSS-Team/MOSS-SoundEffect-v2.0](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0) @ `e35df4d` | Apache 2.0 (código y pesos) | Sí |
| whisper `medium` (ggml) | Tiempos por palabra y probabilidad por palabra (whisper-cli directo, `src/lib/whisper.ts`; si falta, `hyperframes transcribe`), whisper.cpp sin CUDA | CPU | OpenAI Whisper / whisper.cpp | MIT | Sí |
| Silero VAD v5.1.2 (ggml, 885 KB) | Que whisper sólo decodifique donde hay voz (sin palabras inventadas sobre música o silencio) | CPU (whisper.cpp `--vad`) | [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad), tamaño y SHA-256 comprobados | MIT | Sí |
| Parakeet TDT 0.6B v3 (int8) | Transcripción rápida (6–12× whisper) para directos; instalado con `hyperframes models install parakeet` | CPU (sherpa-onnx) | [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC-BY-4.0 | Sí, citando a NVIDIA |
| faster-whisper `large-v3` | Subtítulos internos de MPT (Geeper no los usa) | CPU, Docker | OpenAI Whisper / SYSTRAN | MIT | Sí |
| YuNet 2023mar (232 KB) | Dónde está la cara, para reencuadrar (`src/lib/caras.ts`) | CPU (OpenCV del venv `geeper-clips`) | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), URL fijada a un commit y SHA-256 comprobado | MIT (pesos); entrenado con WIDER FACE, cuyos términos no cubre esa licencia | Sí (los pesos); detecta, no identifica |
| FastWan 2.2 TI2V-5B (LoRA de FastVideo) | «Animar esta escena», opción Rápido (3 pasos, vía Wan2GP) | GPU | [FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers](https://huggingface.co/FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers) | Apache 2.0 (verificado en Hugging Face, 2026-11-20) | Sí |
| Wan 2.2 TI2V-5B | Plano generativo (M5, opcional) | GPU | [Wan-AI/Wan2.2-TI2V-5B-Diffusers](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers) | Apache 2.0 (verificado en la ficha descargada, ver ESTUDIO.md) | Sí |
| Z-Image Turbo 6B (vía Wan2GP, `z_image`) | Retratos de avatar desde una descripción (`src/lib/avatares.ts`) | GPU (Wan2GP) | [Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) | Apache 2.0 | Sí |
| Qwen Image Edit Plus 2511 20B + Lightning 4 pasos (vía Wan2GP) | Avatar desde una foto y retoques que conservan la cara | GPU (Wan2GP) | [Qwen/Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511), [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning) | Apache 2.0 (ambos, verificado en Hugging Face 2026-11-21) | Sí |
| InfiniteTalk (Wan 2.1 I2V 14B 480P) + lightx2v 4 pasos + wav2vec2 (vía Wan2GP) | Presentador: el avatar habla con la voz del video (`src/lib/presentador.ts`) | GPU (Wan2GP) | [MeiGen-AI/InfiniteTalk](https://huggingface.co/MeiGen-AI/InfiniteTalk), [Wan-AI/Wan2.1-I2V-14B-480P](https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P), [lightx2v/…-StepDistill-CfgDistill-Lightx2v](https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v), [TencentGameMate/chinese-wav2vec2-base](https://huggingface.co/TencentGameMate/chinese-wav2vec2-base) | Apache 2.0 (wav2vec2: MIT), verificado 2026-11-21 | Sí |
| Wan2.2 Animate 14B + lightx2v 4 pasos (vía Wan2GP) | «Cambiar la persona» de una escena por un avatar (`src/lib/rehacer.ts`) | GPU (Wan2GP) | [Wan-AI/Wan2.2-Animate-14B](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) | Apache 2.0 (verificado 2026-11-21) | Sí |
| SAM 3.1 (vía Wan2GP, `preprocessing/sam3`) | Máscara de la persona para «Cambiar la persona» (`py/mascara_persona.py`) | GPU (Wan2GP) | [facebook/sam3.1](https://huggingface.co/facebook/sam3.1) | SAM License de Meta: uso comercial sin regalías; acompañar la licencia si se redistribuye | Sí |
| ReCamMaster 1.3B (Wan 2.1, vía Wan2GP) | «Mover la cámara» de una escena (`src/lib/rehacer.ts`) | GPU (Wan2GP) | [KlingTeam/ReCamMaster-Wan2.1](https://huggingface.co/KlingTeam/ReCamMaster-Wan2.1) | Apache 2.0 (código: MIT), verificado 2026-11-21 | Sí |
| MiniMax H3 (Reshoot, Openjutsu) | Sólo experimental, sin integrar | — | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) | **revisar**: MiniMax H3 Community License | Por revisar |

## Motores y bibliotecas

| Pieza | Licencia | Cómo la usa Geeper |
|---|---|---|
| MoneyPrinterTurbo 1.3.10 | MIT | API HTTP en `127.0.0.1:8080` |
| Hyperframes 0.9.27 (fijado) | Apache 2.0 | CLI (`npx hyperframes@0.9.27`), telemetría apagada |
| GSAP 3.15 | Licencia estándar de GSAP (sin costo, también comercial) | Lo carga la composición de Hyperframes |
| ffmpeg 6.1 (Ubuntu) | LGPL/GPL según build | Binario aparte (`~/.local/bin/ffmpeg`) |
| OpenMontage | AGPLv3 | Sólo M5, como proceso aparte por CLI; Geeper no importa su código |
| ComfyUI 0.46.0 (opcional; se instala con un clic desde Workflows, commit fijado) | GPL-3.0 | Proceso aparte (`main.py`, API HTTP en 127.0.0.1); su editor se usa en un Chrome sin ventana para convertir workflows. No viaja dentro del instalador de Geeper. Cada workflow baja sus modelos con la licencia de cada uno (revisarla en su ficha) |
| Wan2GP (opcional; se instala con un clic desde Sistema, en el commit fijado) | WanGP Community License 2.0: uso gratis también en empresa y venta de lo generado (citando a WanGP); prohíbe venderlo, embeberlo en un producto pago u ofrecerlo como servicio | Proceso aparte (`wgp.py --process`) para «Animar esta escena» (`src/lib/wan2gp.ts`); se descarga de su repo al instalarlo, no viaja dentro del instalador de Geeper. Los pesos (Wan 2.2 TI2V-5B e I2V-A14B: Apache 2.0; LTX-2.3: licencia de Lightricks, «revisar») tienen la suya |
| Next.js, React, Prisma, Zod, better-sqlite3 | MIT / Apache 2.0 | Dependencias de la app |

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
| Voz | Kokoro `ef_dora` por defecto; **VoxCPM2** para voces diseñadas (la persona elige escuchando) | Qwen3-TTS 1.7B VoiceDesign, VoxCPM2 | Medido el 2026-11-20 con el mismo párrafo (248 car.), en scratch: whisper entiende las 6 tomas (WER 0–2,3 %). Generar: Kokoro ~5 s en CPU; Qwen3 29–64 s (RTF 1,7–3,0, 4,9 GB, habla lento: 11,7 car./s); VoxCPM2 ~11 s (RTF 0,75, 6 GB, 48 kHz, habla rápido: 17–18 car./s, se baja con `atempo`). A ciegas con Nemotron Omni: Qwen3 narradora 9/10, Kokoro narrador 8, VoxCPM2 6–7, Kokoro `ef_dora` 4 (juez inconsistente: por eso decide el oído de la persona). VoxCPM2 gana para Geeper porque diseña **y** clona con un solo modelo: la voz se diseña una vez y cada frase se dice clonando esa muestra (misma voz, similitud 9/10). Pocket TTS (CPU) queda pendiente: sus pesos piden aceptar términos en Hugging Face. Descartados: XTTS-v2 (CPML), Fish Audio S2 (investigación), Magpie («other»), OmniVoice (pesos CC-BY-NC). |
| Video | Wan 2.2 TI2V-5B | LTX-2 | Medido el 2026-11-09 (ver ESTUDIO.md): techo práctico 576×1024. LTX-2 tiene licencia condicionada a ingresos. |
