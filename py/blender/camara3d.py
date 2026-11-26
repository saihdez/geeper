"""Cámara 3D sobre una foto (camara3d.ts): la foto se vuelve una malla con relieve según su profundidad y una
cámara de verdad se mueve delante, con paralaje, desenfoque de lente y de movimiento.

    blender -b --factory-startup --python camara3d.py -- pedido.json

El pedido trae: imagen, profundidad (PNG 16 bits, blanco = cerca), formato, duracion, movimiento, foco
{x, y, profundidad} (0..1), intensidad, calidad, dispositivo y cuadros (carpeta de salida).
La foto se ve con sus colores exactos (emisión, sin luces): sólo cambia la cámara.
Imprime «GEEPER_CUADRO n total» por cuadro y «GEEPER_ERROR mensaje» si falla.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

FORMATOS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
FPS = 30
LENTE = 50.0
SENSOR = 36.0
MUESTRAS = {"rapida": 16, "normal": 32, "alta": 64}
MOVIMIENTOS = ("acercar", "alejar", "lateral", "orbitar", "subir")


class ErrorCamara(Exception):
    pass


def elegir_dispositivo(preferido):
    escena = bpy.context.scene
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


def clave(obj, ruta, cuadro, valor, interp="BEZIER"):
    bpy.context.preferences.edit.keyframe_new_interpolation_type = interp
    setattr(obj, ruta, valor)
    obj.keyframe_insert(ruta, frame=cuadro)


def reproyectar(malla, prof, ancho, alto, relieve, camara):
    """Sube cada vértice según la profundidad y lo corre hacia la cámara para que se vea en el mismo lugar."""
    import numpy as np

    pw, ph = prof.size
    px = np.empty(pw * ph * prof.channels, dtype=np.float32)
    prof.pixels.foreach_get(px)
    dep = px.reshape(ph, pw, prof.channels)[:, :, 0]
    n = len(malla.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    malla.data.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    u = np.clip(co[:, 0] / ancho + 0.5, 0, 1)
    v = np.clip(co[:, 1] / alto + 0.5, 0, 1)
    z = dep[np.round(v * (ph - 1)).astype(int), np.round(u * (pw - 1)).astype(int)] * relieve
    f = (camara.z - z) / camara.z
    co[:, 0] = camara.x + (co[:, 0] - camara.x) * f
    co[:, 1] = camara.y + (co[:, 1] - camara.y) * f
    co[:, 2] = z
    malla.data.vertices.foreach_set("co", co.ravel())
    malla.data.update()


def armar(p):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    rx, ry = FORMATOS.get(p.get("formato"), FORMATOS["9:16"])
    s.render.resolution_x, s.render.resolution_y = rx, ry
    s.render.resolution_percentage = int(p.get("escala") or 100)
    s.render.fps, s.render.fps_base = FPS, 1
    total = max(2, round(float(p["duracion"]) * FPS))
    s.frame_start, s.frame_end = 1, total
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    w = bpy.data.worlds.new("Mundo")
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    s.world = w

    foto = bpy.data.images.load(p["imagen"])
    iw, ih = foto.size
    if not iw or not ih:
        raise ErrorCamara("No pude leer la foto de la escena.")
    prof = bpy.data.images.load(p["profundidad"])
    prof.colorspace_settings.name = "Non-Color"

    # La foto mide 2 de alto; el ancho según su forma.
    alto = 2.0
    ancho = alto * iw / ih
    nx = max(64, min(640, round(360 * iw / ih)))
    ny = 360
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=nx, y_subdivisions=ny, size=1)
    malla = bpy.context.object
    malla.name = "Foto"
    malla.scale = (ancho, alto, 1)
    bpy.ops.object.transform_apply(scale=True)
    m = bpy.data.materials.new("Foto")
    nt = m.node_tree
    nt.nodes.clear()
    salida = nt.nodes.new("ShaderNodeOutputMaterial")
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = foto
    img.extension = "EXTEND"
    img.interpolation = "Cubic"
    emision = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(img.outputs["Color"], emision.inputs["Color"])
    nt.links.new(emision.outputs[0], salida.inputs["Surface"])
    malla.data.materials.append(m)

    # Cámara: la ventana que ve tiene la forma del video y entra en la foto con margen para moverse.
    margen = 0.2
    por_dist = SENSOR / LENTE  # ancho visible por unidad de distancia
    dist = min(ancho / (1 + margen) / por_dist, alto / (1 + margen) / (por_dist * ry / rx))
    vw = dist * por_dist
    vh = vw * ry / rx
    foco = p.get("foco") or {"x": 0.5, "y": 0.45, "profundidad": 0.6}
    # Centro de la ventana hacia el sujeto, sin salirse de la foto.
    libre_x = max(0.0, (ancho - vw * (1 + margen * 0.5)) / 2)
    libre_y = max(0.0, (alto - vh * (1 + margen * 0.5)) / 2)
    cx = max(-libre_x, min(libre_x, (foco["x"] - 0.5) * ancho))
    cy = max(-libre_y, min(libre_y, (0.5 - foco["y"]) * alto))

    # Relieve proporcional a la distancia (paralaje visible sin deformar) y malla reproyectada: desde la
    # posición inicial de la cámara cada punto cae justo donde estaba en la foto, así el primer cuadro es la
    # foto tal cual y el relieve sólo se nota cuando la cámara se mueve.
    relieve = float(p.get("intensidad", 1.0)) * 0.22 * dist
    zf = foco["profundidad"] * relieve
    reproyectar(malla, prof, ancho, alto, relieve, Vector((cx, cy, dist)))
    punto = Vector(((foco["x"] - 0.5) * ancho, (0.5 - foco["y"]) * alto, 0.0))
    punto = Vector((cx, cy, 0)) + (punto - Vector((cx, cy, 0))) * ((dist - zf) / dist)
    punto.z = zf

    cd = bpy.data.cameras.new("Camara")
    cd.lens = LENTE
    cd.sensor_width = SENSOR
    cd.sensor_fit = "HORIZONTAL"
    cd.clip_start = 0.01
    cam = bpy.data.objects.new("Camara", cd)
    s.collection.objects.link(cam)
    s.camera = cam
    objetivo = bpy.data.objects.new("Foco", None)
    objetivo.location = punto
    s.collection.objects.link(objetivo)
    cd.dof.use_dof = True
    cd.dof.focus_object = objetivo
    cd.dof.aperture_fstop = float(p.get("apertura", 2.8))

    mov = p.get("movimiento") if p.get("movimiento") in MOVIMIENTOS else "acercar"
    # Cuánto puede correrse la cámara sin que asome el borde de la foto (con 20 % de resguardo).
    sobra_x = max(0.0, (ancho - vw) / 2 - abs(cx)) * 0.8
    sobra_y = max(0.0, (alto - vh) / 2 - abs(cy)) * 0.8
    if mov in ("lateral", "orbitar") and sobra_x < 0.02 * vw:
        mov = "acercar"
    if mov == "subir" and sobra_y < 0.02 * vh:
        mov = "acercar"
    print(f"GEEPER_MOVIMIENTO {mov}", flush=True)
    lado = 1 if p.get("sentido", 1) >= 0 else -1
    base = Vector((cx, cy, dist))
    if mov == "orbitar":
        # Gira alrededor del sujeto: la cámara se desplaza y gira para seguir mirándolo.
        mira = Vector((cx, cy, zf))
        a = min(0.09 * vw, sobra_x)
        for cuadro, pos in ((1, base + Vector((-a * lado, 0, 0))), (total, base + Vector((a * lado, 0, -0.04 * dist)))):
            clave(cam, "location", cuadro, pos)
            clave(cam, "rotation_euler", cuadro, (0.0, math.atan2(pos.x - mira.x, pos.z - mira.z), 0.0))
    else:
        cam.rotation_euler = (0, 0, 0)
        if mov == "acercar":
            clave(cam, "location", 1, base)
            clave(cam, "location", total, base + Vector((0, 0, -0.16 * dist)))
        elif mov == "alejar":
            clave(cam, "location", 1, base + Vector((0, 0, -0.16 * dist)))
            clave(cam, "location", total, base)
        elif mov == "lateral":
            a = min(0.07 * vw, sobra_x)
            clave(cam, "location", 1, base + Vector((-a * lado, 0, 0)))
            clave(cam, "location", total, base + Vector((a * lado, 0, -0.05 * dist)))
        elif mov == "subir":
            a = min(0.05 * vh, sobra_y)
            clave(cam, "location", 1, base + Vector((0, -a * lado, 0)))
            clave(cam, "location", total, base + Vector((0, a * lado, -0.05 * dist)))
    return s, total


def render(p, s, total):
    s.render.engine = "CYCLES"
    cy = s.cycles
    cy.samples = int(p.get("muestras") or MUESTRAS.get(p.get("calidad"), 32))
    cy.use_denoising = False  # el denoiser borra la textura fina de la foto
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.max_bounces = 0
    if hasattr(cy, "filter_width"):
        cy.filter_width = 1.2
    s.render.use_motion_blur = True
    s.render.motion_blur_shutter = 0.5
    s.render.use_persistent_data = True
    print(f"GEEPER_DISPOSITIVO {elegir_dispositivo(p.get('dispositivo', 'gpu'))}", flush=True)
    im = s.render.image_settings
    if hasattr(im, "media_type"):
        im.media_type = "IMAGE"
    im.file_format = "PNG"
    im.color_mode = "RGB"
    im.color_depth = "8"
    os.makedirs(p["cuadros"], exist_ok=True)
    s.render.filepath = os.path.join(p["cuadros"], "c_")

    def al_guardar(escena, *_):
        print(f"GEEPER_CUADRO {escena.frame_current} {total}", flush=True)

    bpy.app.handlers.render_write.append(al_guardar)
    sueltos = p.get("solo_cuadros")
    if sueltos:
        for f in sueltos:
            s.frame_set(int(f))
            s.render.filepath = os.path.join(p["cuadros"], f"c_{int(f):04d}.png")
            bpy.ops.render.render(write_still=True)
        return
    bpy.ops.render.render(animation=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise ErrorCamara("Falta el pedido.")
    with open(argv[0], encoding="utf-8") as f:
        p = json.load(f)
    for k in ("imagen", "profundidad"):
        if not os.path.exists(p.get(k) or ""):
            raise ErrorCamara(f"Falta el archivo de {k}.")
    s, total = armar(p)
    render(p, s, total)
    print("GEEPER_LISTO", flush=True)


try:
    main()
except ErrorCamara as x:
    print(f"GEEPER_ERROR {x}", flush=True)
    os._exit(3)
except Exception as x:  # noqa: BLE001
    import traceback

    traceback.print_exc()
    print(f"GEEPER_ERROR No se pudo mover la cámara ({type(x).__name__}: {x}).", flush=True)
    os._exit(4)
