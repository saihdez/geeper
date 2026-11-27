"""Efectos de sonido desde una descripción con MOSS-SoundEffect v2.0 (Apache-2.0, OpenMOSS).

Corre con el venv propio del modelo (numpy 1.26, transformers 4.57, torch 2.9) y, desde Geeper, dentro
de gpu-solo (necesita ~11 GB de VRAM). Lee por stdin una lista de pedidos y escribe un WAV por pedido:
  [{"prompt": "…en inglés…", "segundos": 3, "semilla": 0, "salida": "/ruta/x.wav"}]
Los efectos de hasta 10 s se generan en una ventana de 10 s (no de 30): menos VRAM y menos tiempo.
Responde por stdout una línea JSON por pedido terminado y una final con el pico de VRAM.
"""
import json
import os
import sys
import time

os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")  # torch.compile tarda minutos la primera vez

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from moss_soundeffect_v2 import MossSoundEffectPipeline  # noqa: E402

MODELO = os.environ.get("GEEPER_MOSS_SFX", "OpenMOSS-Team/MOSS-SoundEffect-v2.0")
REVISION = "e35df4d82fbe87fcd5d14e5d100e349c0c3c076d"


def main() -> int:
    pedidos = json.load(sys.stdin)
    t0 = time.time()
    torch.cuda.reset_peak_memory_stats()
    if os.path.isdir(MODELO):
        ruta = MODELO
    else:
        from huggingface_hub import snapshot_download

        ruta = snapshot_download(MODELO, revision=REVISION)
    pipe = MossSoundEffectPipeline.from_pretrained(ruta, torch_dtype=torch.bfloat16, device="cuda")
    print(json.dumps({"cargado_s": round(time.time() - t0, 1)}), flush=True)
    for p in pedidos:
        segundos = float(min(30.0, max(1.0, p["segundos"])))
        t = time.time()
        # El pipeline genera siempre un bloque de `max_inference_seconds` (30 s) y recorta: con 16 GB eso
        # roza el tope. Un efecto corto se genera en una ventana de 10 s (medido en DECISIONES §25).
        ventana = 10 if segundos <= 10 else 30
        audio = pipe(prompt=p["prompt"], seconds=segundos, num_inference_steps=int(p.get("pasos", 100)), cfg_scale=4.0, seed=int(p.get("semilla", 0)), max_inference_seconds=ventana)
        datos = audio[0].detach().float().cpu().numpy()
        datos = datos.T if datos.ndim == 2 else datos[:, None]
        datos = np.clip(datos, -1.0, 1.0)
        sf.write(p["salida"], datos, pipe.sample_rate, subtype="PCM_16")
        print(json.dumps({"salida": p["salida"], "segundos": round(len(datos) / pipe.sample_rate, 2), "generar_s": round(time.time() - t, 1)}), flush=True)
    print(json.dumps({"vram_pico_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2), "total_s": round(time.time() - t0, 1)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
