"""Voz con VoxCPM2 (openbmb, Apache-2.0: código y pesos). Corre con su venv propio
(~/dev/video-tools/venvs/voxcpm, torch cu128) y, desde Geeper, con el gpu-lock tomado (~6 GB de VRAM).

Lee un pedido JSON por stdin:
  {"modo": "disenar", "descripcion": "…", "texto": "…", "tomas": 3, "salida": "/dir"}
      → /dir/toma-1.wav … (cada toma es una voz distinta que cumple la descripción)
  {"modo": "decir", "referencia": "/x/referencia.wav", "texto_referencia": "…", "texto": "…", "salida": "/x/voz.wav"}
      → la misma voz que la referencia (clonación con su transcripción: el timbre no cambia entre escenas)
  {"modo": "decir", "referencia": "…", "texto_referencia": "…", "frases": [{"texto": "…", "salida": "/x/e01.wav"}, …]}
      → varias frases con una sola carga del modelo (GPU-07: rehacer varias escenas no carga el modelo
        cada vez; la carga en frío son 60–95 s)
Responde una línea JSON por archivo escrito y una final con el pico de VRAM.

torch.compile (inductor) falla con «CUDA error: unknown error» en esta RTX 5080 bajo WSL: se apaga.

El modelo va fijado a una revisión (TER-07): sin eso, una versión nueva en Hugging Face cambiaría
sola el timbre de las voces guardadas. Si esa revisión ya está en la caché se usa sin ir a internet.
"""
import json
import os
import sys
import time

os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")

REPO = "openbmb/VoxCPM2"
# Revisión probada de openbmb/VoxCPM2 (la que ya está en la caché del estudio).
REVISION = os.environ.get("GEEPER_VOXCPM_REVISION", "7936080b41163874f38610f46f438e2c0757f9fd")


def ruta_modelo(modelo: "str | None" = None, revision: str = REVISION) -> str:
    """Carpeta local del modelo.

    GEEPER_VOXCPM (la ruta que pasa el instalador de la app, <herramientas>/modelos/VoxCPM2) se usa tal
    cual: sin revisión ni red. Si no, una carpeta se usa tal cual y un nombre de Hugging Face va a la
    revisión fijada, primero desde la caché y sólo si falta, por internet.
    """
    if modelo is None:
        propio = os.environ.get("GEEPER_VOXCPM")
        if propio:
            return propio
        modelo = REPO
    if os.path.isdir(modelo):
        return modelo
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(repo_id=modelo, revision=revision, local_files_only=True)
    except Exception:  # noqa: BLE001 — no está en la caché: se baja esa misma revisión
        return snapshot_download(repo_id=modelo, revision=revision)


def frases_de(pedido: dict) -> list:
    """Las frases a decir: la lista `frases` o, como antes, un solo `texto` con su `salida`."""
    if pedido.get("frases"):
        return [{"texto": f["texto"].strip(), "salida": f["salida"]} for f in pedido["frases"] if f.get("texto", "").strip()]
    return [{"texto": pedido["texto"].strip(), "salida": pedido["salida"]}]


def main() -> int:
    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    pedido = json.load(sys.stdin)
    t0 = time.time()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    modelo = VoxCPM.from_pretrained(ruta_modelo(), load_denoiser=False)
    sr = modelo.tts_model.sample_rate
    print(json.dumps({"cargado_s": round(time.time() - t0, 1), "sample_rate": sr}), flush=True)
    if pedido["modo"] == "disenar":
        texto = pedido["texto"].strip()
        os.makedirs(pedido["salida"], exist_ok=True)
        for i in range(int(pedido.get("tomas", 3))):
            t = time.time()
            wav = modelo.generate(text=f"({pedido['descripcion'].strip()}){texto}", cfg_value=2.0, inference_timesteps=10)
            ruta = os.path.join(pedido["salida"], f"toma-{i + 1}.wav")
            sf.write(ruta, wav, sr)
            print(json.dumps({"archivo": ruta, "duracion_s": round(len(wav) / sr, 2), "generar_s": round(time.time() - t, 1)}), flush=True)
    elif pedido["modo"] == "decir":
        for frase in frases_de(pedido):
            t = time.time()
            wav = modelo.generate(
                text=frase["texto"],
                prompt_wav_path=pedido["referencia"],
                prompt_text=pedido["texto_referencia"].strip(),
                cfg_value=2.0,
                inference_timesteps=10,
            )
            sf.write(frase["salida"], wav, sr)
            print(json.dumps({"archivo": frase["salida"], "duracion_s": round(len(wav) / sr, 2), "generar_s": round(time.time() - t, 1)}), flush=True)
    else:
        raise SystemExit(f"Modo desconocido: {pedido['modo']}")
    vram = torch.cuda.max_memory_allocated() / 1e9 if torch.cuda.is_available() else 0
    print(json.dumps({"vram_pico_gb": round(vram, 2), "total_s": round(time.time() - t0, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
