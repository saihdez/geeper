"""Profundidad de una foto con Depth Anything V2 Small (Apache-2.0) en CPU, para la cámara 3D (camara3d.ts).

    python -I profundidad.py modelo.onnx foto.png salida.png

Escribe un PNG de 16 bits del tamaño de la foto: blanco = cerca, negro = lejos, ya suavizado en los bordes
para que la malla 3D no se rasgue. Imprime un JSON con el punto más cercano grande (donde enfocar) y cuánta
profundidad útil tiene la foto (0 = plana, como una pantalla o un texto).
"""
import json
import sys

import cv2
import numpy as np
import onnxruntime as ort

LADO = 518  # lo que espera el modelo (múltiplo de 14)
MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DESVIO = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def main():
    modelo, foto, salida = sys.argv[1:4]
    img = cv2.imread(foto, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"No pude leer la foto {foto}")
    h, w = img.shape[:2]
    x = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), (LADO, LADO), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    x = ((x - MEDIA) / DESVIO).transpose(2, 0, 1)[None]
    opciones = ort.SessionOptions()
    opciones.intra_op_num_threads = 0
    sesion = ort.InferenceSession(modelo, opciones, providers=["CPUExecutionProvider"])
    d = sesion.run(None, {sesion.get_inputs()[0].name: x})[0].squeeze().astype(np.float32)
    # Recorte de valores extremos (cielo, reflejos) y normalizado 0..1 (1 = cerca).
    bajo, alto = np.percentile(d, 1), np.percentile(d, 99.5)
    d = np.clip((d - bajo) / max(alto - bajo, 1e-6), 0, 1)
    d = cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)
    # Suavizado que respeta bordes y luego un poco de desenfoque: menos rasgado en los cortes de profundidad.
    d = cv2.bilateralFilter(d, 9, 0.1, 9)
    d = cv2.GaussianBlur(d, (0, 0), max(1.0, w / 600))
    d = np.clip(d, 0, 1)
    cv2.imwrite(salida, (d * 65535).astype(np.uint16))
    # Dónde enfocar: el centro de lo más cercano y grande (el 15 % más cercano, ponderado al centro).
    yy, xx = np.mgrid[0:h, 0:w]
    centro = np.exp(-(((xx / w - 0.5) ** 2) + ((yy / h - 0.45) ** 2)) / 0.08)
    cerca = d >= np.percentile(d, 85)
    peso = cerca * centro
    fx, fy = (float((xx * peso).sum() / peso.sum() / w), float((yy * peso).sum() / peso.sum() / h)) if peso.sum() > 0 else (0.5, 0.45)
    print(json.dumps({
        "ancho": w, "alto": h,
        "foco": {"x": round(fx, 4), "y": round(fy, 4), "profundidad": round(float(np.median(d[cerca])), 4)},
        "relieve": round(float(np.percentile(d, 95) - np.percentile(d, 5)), 4),
    }))


if __name__ == "__main__":
    main()
