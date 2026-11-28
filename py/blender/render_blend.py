"""Vuelve a dibujar un .blend de Geeper que la persona abrió y cambió en Blender («Abrir en Blender»).

    blender -b escena.blend --python render_blend.py -- pedido.json

Respeta todo lo del archivo (motor, cámara, luces, cuadros, tamaño); sólo pone dónde se guardan los cuadros
(PNG), la tarjeta de video y, para pruebas, la escala. Pedido: {"cuadros", "dispositivo", "imagen"?, "escala"?}.
Con "imagen": true dibuja sólo el cuadro en el que quedó el archivo. Imprime «GEEPER_CUADRO n total».
"""
import json
import os
import sys

import bpy


def elegir_dispositivo(preferido):
    escena = bpy.context.scene
    if escena.render.engine != "CYCLES":
        return escena.render.engine
    if preferido != "gpu":
        escena.cycles.device = "CPU"
        return "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for tipo in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = tipo
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == tipo for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == tipo
            escena.cycles.device = "GPU"
            return tipo
    escena.cycles.device = "CPU"
    return "CPU"


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    with open(argv[0], encoding="utf-8") as f:
        p = json.load(f)
    s = bpy.context.scene
    r = s.render
    if p.get("escala"):
        r.resolution_percentage = int(p["escala"])
    print(f"GEEPER_DISPOSITIVO {elegir_dispositivo(p.get('dispositivo', 'gpu'))}", flush=True)
    im = r.image_settings
    if hasattr(im, "media_type"):
        im.media_type = "IMAGE"
    im.file_format = "PNG"
    im.color_mode = "RGBA" if r.film_transparent else "RGB"
    im.color_depth = "8"
    os.makedirs(p["cuadros"], exist_ok=True)
    r.filepath = os.path.join(p["cuadros"], "c_")
    r.use_file_extension = True
    total = 1 if p.get("imagen") else s.frame_end - s.frame_start + 1
    hechos = [0]

    def al_guardar(*_):
        hechos[0] += 1
        print(f"GEEPER_CUADRO {hechos[0]} {total}", flush=True)

    bpy.app.handlers.render_write.append(al_guardar)
    if p.get("imagen"):
        r.filepath = os.path.join(p["cuadros"], f"c_{s.frame_current:04d}.png")
        bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)
    print("GEEPER_LISTO", flush=True)


try:
    main()
except Exception as x:  # noqa: BLE001
    import traceback

    traceback.print_exc()
    print(f"GEEPER_ERROR No se pudo dibujar tu archivo de Blender ({type(x).__name__}: {x}).", flush=True)
    os._exit(4)
