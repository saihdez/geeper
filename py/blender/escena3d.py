"""Escenas 3D de Geeper: arma una plantilla en Blender y renderiza la animación a PNG.

    blender -b --factory-startup --python escena3d.py -- pedido.json

El pedido (lo escribe escenas3d.ts, ya validado) dice la plantilla, los textos, colores, imágenes,
formato, duración y calidad. Todo se construye con código: sin modelos bajados de internet (la única
descarga opcional es el HDRI de estudio CC0 de Poly Haven para los reflejos).

Imprime «GEEPER_CUADRO n total» por cada cuadro guardado y «GEEPER_ERROR mensaje» si algo falla.
Plantillas: texto, logo, producto, fondo, caja, datos.

Salidas: video (todos los cuadros) o imagen (un cuadro, `salida: "imagen"`), con el fondo de color, con
una foto de fondo (`fondo_imagen`, a cubrir el cuadro: portadas y títulos sobre una escena) o
transparente (`transparente: true`, PNG con alfa: elementos para poner encima de otro video).
"""
import json
import math
import os
import random
import sys

import bpy

FORMATOS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
MUESTRAS = {"rapida": 24, "normal": 64, "alta": 160}
FPS = 30
LENTE = 50.0
SENSOR = 36.0


class ErrorEscena(Exception):
    pass


# ---------------------------------------------------------------- utilidades


def lineal(hex_color):
    """#RRGGBB (sRGB) → RGB lineal, que es lo que usan los nodos."""
    h = (hex_color or "#ffffff").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    except ValueError:
        rgb = [1.0, 1.0, 1.0]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


def luminancia(hex_color):
    r, g, b = lineal(hex_color)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def clave(obj, ruta, cuadro, valor, interp="BEZIER", indice=-1):
    """Pone un valor y su keyframe. La interpolación se elige antes de insertar (Blender 5 guarda las
    curvas en capas: así no hace falta tocar la acción)."""
    bpy.context.preferences.edit.keyframe_new_interpolation_type = interp
    if indice >= 0:
        getattr(obj, ruta)[indice] = valor
        obj.keyframe_insert(ruta, index=indice, frame=cuadro)
    else:
        setattr(obj, ruta, valor)
        obj.keyframe_insert(ruta, frame=cuadro)


def activar(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apuntar_a(obj, objetivo):
    c = obj.constraints.new("TRACK_TO")
    c.target = objetivo
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return c


def vacio(nombre, loc=(0, 0, 0)):
    e = bpy.data.objects.new(nombre, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


# ---------------------------------------------------------------- materiales


def material(nombre, color, estilo="brillante"):
    m = bpy.data.materials.new(nombre)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lineal(color), 1)
    if estilo == "metal":
        b.inputs["Metallic"].default_value = 1.0
        b.inputs["Roughness"].default_value = 0.24
    elif estilo == "mate":
        b.inputs["Roughness"].default_value = 0.62
    else:  # brillante
        b.inputs["Roughness"].default_value = 0.22
        b.inputs["Coat Weight"].default_value = 0.5
        b.inputs["Coat Roughness"].default_value = 0.05
    return m


def material_imagen(nombre, ruta, brillo=0.85):
    """Una foto o logo PNG tal cual se ve (emisión) con algo de brillo de estudio, y su transparencia."""
    img = bpy.data.images.load(ruta, check_existing=True)
    m = bpy.data.materials.new(nombre)
    nt = m.node_tree
    n = nt.nodes
    n.clear()
    salida = n.new("ShaderNodeOutputMaterial")
    tex = n.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "CLIP"
    bsdf = n.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.35
    emision = n.new("ShaderNodeEmission")
    emision.inputs["Strength"].default_value = 1.0
    mezcla = n.new("ShaderNodeMixShader")
    mezcla.inputs["Fac"].default_value = brillo
    transp = n.new("ShaderNodeBsdfTransparent")
    alfa = n.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], emision.inputs["Color"])
    nt.links.new(bsdf.outputs[0], mezcla.inputs[1])
    nt.links.new(emision.outputs[0], mezcla.inputs[2])
    nt.links.new(tex.outputs["Alpha"], alfa.inputs["Fac"])
    nt.links.new(transp.outputs[0], alfa.inputs[1])
    nt.links.new(mezcla.outputs[0], alfa.inputs[2])
    nt.links.new(alfa.outputs[0], salida.inputs["Surface"])
    return m, img


def recorte_transparente(img, umbral=0.04):
    """Caja (u0, v0, u1, v1) de lo no transparente de una imagen, con un 2 % de margen. Sin alfa: toda."""
    import numpy as np

    w, h = img.size
    if img.channels < 4:
        return 0.0, 0.0, 1.0, 1.0
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    alfa = px[3::4].reshape(h, w) > umbral
    if not alfa.any() or alfa.all():
        return 0.0, 0.0, 1.0, 1.0
    filas = np.where(alfa.any(axis=1))[0]
    cols = np.where(alfa.any(axis=0))[0]
    m = 0.02
    u0, u1 = max(0.0, cols[0] / w - m), min(1.0, (cols[-1] + 1) / w + m)
    v0, v1 = max(0.0, filas[0] / h - m), min(1.0, (filas[-1] + 1) / h + m)
    return u0, v0, u1, v1


def plano_imagen(nombre, ruta, alto, grosor=0.03):
    m, img = material_imagen(nombre, ruta)
    w, h = img.size
    if not w or not h:
        raise ErrorEscena("No pude leer la imagen (¿está dañada?).")
    u0, v0, u1, v1 = recorte_transparente(img)
    ancho = alto * (w * (u1 - u0)) / (h * (v1 - v0))
    bpy.ops.mesh.primitive_plane_add(size=1)
    p = bpy.context.object
    p.name = nombre
    p.scale = (ancho, alto, 1)
    bpy.ops.object.transform_apply(scale=True)
    # Sólo la parte visible de la foto: sin el aire transparente alrededor.
    for uv in p.data.uv_layers.active.data:
        uv.uv = (u0 + uv.uv[0] * (u1 - u0), v0 + uv.uv[1] * (v1 - v0))
    p.rotation_euler = (math.radians(90), 0, 0)
    p.data.materials.append(m)
    if grosor:
        s = p.modifiers.new("grosor", "SOLIDIFY")
        s.thickness = grosor
        s.offset = 0
    return p, ancho


# ---------------------------------------------------------------- escena base


class Escena:
    def __init__(self, pedido):
        self.p = pedido
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.s = bpy.context.scene
        self.rx, self.ry = FORMATOS.get(pedido.get("formato"), FORMATOS["9:16"])
        self.s.render.resolution_x = self.rx
        self.s.render.resolution_y = self.ry
        self.s.render.resolution_percentage = int(pedido.get("escala") or 100)
        self.s.render.fps = FPS
        self.s.render.fps_base = 1
        self.total = max(1, round(float(pedido.get("duracion", 5)) * FPS))
        self.s.frame_start = 1
        self.s.frame_end = self.total
        self.s.view_settings.view_transform = "Standard"
        self.s.view_settings.look = "None"
        c = pedido.get("colores") or {}
        self.fondo = c.get("fondo") or "#101418"
        self.fondo2 = c.get("fondo2")
        self.principal = c.get("principal") or "#f2aa4c"
        self.acento = c.get("acento") or "#ffffff"
        self.estilo = pedido.get("estilo") or "brillante"
        self.mundo()

    def seg(self, s):
        """Segundos → número de cuadro (1 es el primero)."""
        return 1 + round(s * FPS)

    # Mundo: la cámara ve el color (o degradado) de fondo exacto; la luz y los reflejos vienen del HDRI
    # de estudio (o de un gris suave si no está).
    def mundo(self):
        w = bpy.data.worlds.new("Mundo")
        self.s.world = w
        nt = w.node_tree
        n = nt.nodes
        n.clear()
        salida = n.new("ShaderNodeOutputWorld")
        visto = n.new("ShaderNodeBackground")
        foto = self.p.get("fondo_imagen")
        if foto and os.path.exists(foto):
            # La foto cubre el cuadro (como object-fit: cover), en coordenadas de ventana de la cámara.
            img = bpy.data.images.load(foto, check_existing=True)
            iw, ih = img.size
            if not iw or not ih:
                raise ErrorEscena("No pude leer la foto de fondo (¿está dañada?).")
            coord = n.new("ShaderNodeTexCoord")
            mapa = n.new("ShaderNodeMapping")
            a_cuadro, a_foto = self.rx / self.ry, iw / ih
            sx, sy = (a_cuadro / a_foto, 1.0) if a_foto > a_cuadro else (1.0, a_foto / a_cuadro)
            mapa.inputs["Scale"].default_value = (sx, sy, 1)
            mapa.inputs["Location"].default_value = (0.5 - 0.5 * sx, 0.5 - 0.5 * sy, 0)
            tex = n.new("ShaderNodeTexImage")
            tex.image = img
            tex.extension = "EXTEND"
            nt.links.new(coord.outputs["Window"], mapa.inputs["Vector"])
            nt.links.new(mapa.outputs["Vector"], tex.inputs["Vector"])
            # Un poco más oscura, para que lo 3D de delante se lea bien.
            oscura = n.new("ShaderNodeMix")
            oscura.data_type = "RGBA"
            oscura.inputs["Factor"].default_value = float(self.p.get("oscurecer_fondo", 0.3))
            oscura.inputs["B"].default_value = (0, 0, 0, 1)
            nt.links.new(tex.outputs["Color"], oscura.inputs["A"])
            nt.links.new(oscura.outputs["Result"], visto.inputs["Color"])
        elif self.fondo2:
            coord = n.new("ShaderNodeTexCoord")
            sep = n.new("ShaderNodeSeparateXYZ")
            rampa = n.new("ShaderNodeValToRGB")
            rampa.color_ramp.elements[0].color = (*lineal(self.fondo2), 1)
            rampa.color_ramp.elements[1].color = (*lineal(self.fondo), 1)
            nt.links.new(coord.outputs["Window"], sep.inputs[0])
            nt.links.new(sep.outputs["Y"], rampa.inputs["Fac"])
            nt.links.new(rampa.outputs["Color"], visto.inputs["Color"])
        else:
            visto.inputs["Color"].default_value = (*lineal(self.fondo), 1)
        luz = n.new("ShaderNodeBackground")
        hdri = self.p.get("hdri")
        if hdri and os.path.exists(hdri):
            env = n.new("ShaderNodeTexEnvironment")
            env.image = bpy.data.images.load(hdri, check_existing=True)
            nt.links.new(env.outputs["Color"], luz.inputs["Color"])
            luz.inputs["Strength"].default_value = 0.7
        else:
            luz.inputs["Color"].default_value = (0.75, 0.77, 0.8, 1)
            luz.inputs["Strength"].default_value = 0.45
        camino = n.new("ShaderNodeLightPath")
        mezcla = n.new("ShaderNodeMixShader")
        nt.links.new(camino.outputs["Is Camera Ray"], mezcla.inputs["Fac"])
        nt.links.new(luz.outputs[0], mezcla.inputs[1])
        nt.links.new(visto.outputs[0], mezcla.inputs[2])
        nt.links.new(mezcla.outputs[0], salida.inputs["Surface"])

    def luces(self, centro=(0, 0, 0), escala=1.0):
        objetivo = vacio("CentroLuz", centro)
        for nombre, loc, energia, tam in (
            ("Principal", (-4.5, -6, 5), 520, 5),
            ("Relleno", (5.5, -5, 1.5), 200, 6),
            ("Contra", (0.5, 6, 6), 450, 4),
        ):
            d = bpy.data.lights.new(nombre, "AREA")
            d.energy = energia * escala * escala
            d.size = tam * escala
            o = bpy.data.objects.new(nombre, d)
            o.location = tuple(v * escala + c for v, c in zip(loc, centro))
            self.s.collection.objects.link(o)
            apuntar_a(o, objetivo)

    def camara(self, loc, objetivo=(0, 0, 0)):
        d = bpy.data.cameras.new("Camara")
        d.lens = LENTE
        d.sensor_width = SENSOR
        d.sensor_fit = "HORIZONTAL"
        o = bpy.data.objects.new("Camara", d)
        o.location = loc
        self.s.collection.objects.link(o)
        self.s.camera = o
        self.objetivo = vacio("Mira", objetivo)
        apuntar_a(o, self.objetivo)
        self.cam = o
        return o

    def distancia_para(self, ancho, alto, margen=1.15):
        """Distancia a la que entra un contenido de ancho×alto (unidades) con margen."""
        vis_w = SENSOR / LENTE  # ancho visible por unidad de distancia
        vis_h = vis_w * self.ry / self.rx
        return margen * max(ancho / vis_w, alto / vis_h)

    def acercar(self, factor=0.94):
        """Un empujón lento de cámara durante todo el video (da vida sin marear)."""
        a = self.cam.location.copy()
        mira = self.objetivo.location
        b = mira + (a - mira) * factor
        clave(self.cam, "location", 1, a, "BEZIER")
        clave(self.cam, "location", self.total, b, "BEZIER")

    def suelo_sombra(self, z, tam=40):
        bpy.ops.mesh.primitive_plane_add(size=tam, location=(0, 0, z))
        p = bpy.context.object
        p.name = "SombraSuelo"
        p.is_shadow_catcher = True
        return p

    def pared_sombra(self, y, tam=40):
        bpy.ops.mesh.primitive_plane_add(size=tam, location=(0, y, 0), rotation=(math.radians(90), 0, 0))
        p = bpy.context.object
        p.name = "SombraPared"
        p.is_shadow_catcher = True
        return p

    def texto(self, cuerpo, color, estilo, extrusion=0.12, tam=1.0):
        c = bpy.data.curves.new("Texto", "FONT")
        c.body = cuerpo
        c.align_x = "CENTER"
        c.align_y = "CENTER"
        c.size = tam
        c.extrude = extrusion
        c.bevel_depth = 0.018
        c.bevel_resolution = 3
        c.space_line = 0.9
        fuente = self.p.get("fuente")
        if fuente and os.path.exists(fuente):
            c.font = bpy.data.fonts.load(fuente, check_existing=True)
        o = bpy.data.objects.new("Texto", c)
        self.s.collection.objects.link(o)
        o.data.materials.append(material("MatTexto", color, estilo))
        o.rotation_euler = (math.radians(90), 0, 0)
        return o

    def ajustar(self, obj, ancho, alto):
        """Escala el objeto para que entre en ancho×alto (unidades del mundo)."""
        bpy.context.view_layer.update()
        dx, dy = obj.dimensions.x, obj.dimensions.y
        if dx <= 0 or dy <= 0:
            return
        f = min(ancho / dx, alto / dy)
        obj.scale = tuple(v * f for v in obj.scale)

    def render(self, carpeta):
        r = self.s.render
        r.engine = "CYCLES"
        cy = self.s.cycles
        cy.samples = int(self.p.get("muestras") or MUESTRAS.get(self.p.get("calidad"), 64))
        cy.use_denoising = True
        cy.max_bounces = 6
        cy.transparent_max_bounces = 12
        cy.use_adaptive_sampling = True
        r.use_persistent_data = True
        r.use_motion_blur = self.p.get("calidad") == "alta"
        dispositivo = elegir_dispositivo(self.p.get("dispositivo", "gpu"))
        print(f"GEEPER_DISPOSITIVO {dispositivo}", flush=True)
        transparente = bool(self.p.get("transparente"))
        r.film_transparent = transparente
        s = r.image_settings
        if hasattr(s, "media_type"):
            s.media_type = "IMAGE"
        s.file_format = "PNG"
        s.color_mode = "RGBA" if transparente else "RGB"
        s.color_depth = "8"
        os.makedirs(carpeta, exist_ok=True)
        r.filepath = os.path.join(carpeta, "c_")
        r.use_file_extension = True
        total = self.total

        hechos = [0]

        def al_guardar(escena, *_):
            hechos[0] += 1
            print(f"GEEPER_CUADRO {hechos[0]} {total}", flush=True)

        bpy.app.handlers.render_write.append(al_guardar)
        sueltos = self.p.get("solo_cuadros")
        if self.p.get("salida") == "imagen":
            # Una imagen: el cuadro en que todo ya entró y está quieto (o el que se pida).
            sueltos = [int(self.p.get("cuadro_imagen") or cuadro_imagen(self.total))]
        if sueltos:
            total = len(sueltos)  # pruebas y portadas: sólo esos cuadros
            for f in sueltos:
                self.s.frame_set(int(f))
                r.filepath = os.path.join(carpeta, f"c_{int(f):04d}.png")
                bpy.ops.render.render(write_still=True)
            return
        bpy.ops.render.render(animation=True)


def cuadro_imagen(total):
    """Para una imagen fija: al 85 % de la animación ya entró todo (las entradas duran hasta ~1,5 s)."""
    return max(1, min(total, round(total * 0.85)))


def elegir_dispositivo(preferido):
    """GPU si se puede (OptiX → CUDA → HIP → Metal → oneAPI); si no, CPU."""
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


def partir_lineas(texto, max_car):
    """Corta en renglones de hasta max_car letras sin partir palabras (respeta los saltos puestos)."""
    salida = []
    for parrafo in texto.strip().split("\n"):
        linea = ""
        for palabra in parrafo.split():
            if linea and len(linea) + 1 + len(palabra) > max_car:
                salida.append(linea)
                linea = palabra
            else:
                linea = f"{linea} {palabra}".strip()
        salida.append(linea)
    return "\n".join(l for l in salida if l) or " "


# ---------------------------------------------------------------- plantillas


def plantilla_texto(e):
    vertical = e.ry > e.rx
    cuerpo = partir_lineas(e.p.get("texto") or "Tu título", 12 if vertical else 22)
    t = e.texto(cuerpo, e.principal, e.estilo)
    ancho, alto = 6.0, 6.0 * e.ry / e.rx
    e.ajustar(t, ancho * 0.74, alto * 0.4)
    d = e.distancia_para(ancho, alto, margen=1.0)
    e.camara((0, -d, 0))
    e.luces(escala=max(1.0, d / 10))
    e.pared_sombra(1.2)
    mov = e.p.get("movimiento") or "entra"
    fin = e.total
    escala = tuple(t.scale)
    if mov == "rebota":
        clave(t, "location", 1, (0, 0, alto * 0.75), "BOUNCE")
        clave(t, "location", e.seg(1.2), (0, 0, 0), "BEZIER")
        clave(t, "rotation_euler", e.seg(1.2), (math.radians(90), 0, math.radians(-6)))
        clave(t, "rotation_euler", fin, (math.radians(90), 0, math.radians(6)))
    elif mov == "gira":
        clave(t, "rotation_euler", 1, (math.radians(90), 0, math.radians(-28)))
        clave(t, "rotation_euler", fin // 2, (math.radians(90), 0, math.radians(28)))
        clave(t, "rotation_euler", fin, (math.radians(90), 0, math.radians(-10)))
        clave(t, "location", 1, (0, 0, -0.08), indice=-1)
        clave(t, "location", fin // 2, (0, 0, 0.08))
        clave(t, "location", fin, (0, 0, -0.04))
    else:  # entra
        clave(t, "scale", 1, tuple(v * 0.02 for v in escala), "BACK")
        clave(t, "scale", e.seg(0.9), escala)
        clave(t, "rotation_euler", 1, (math.radians(170), 0, math.radians(-20)), "BEZIER")
        clave(t, "rotation_euler", e.seg(0.9), (math.radians(90), 0, math.radians(-5)))
        clave(t, "rotation_euler", fin, (math.radians(90), 0, math.radians(5)))
    e.acercar(0.95)


def plantilla_logo(e):
    ruta = e.p.get("logo") or e.p.get("imagen")
    if not ruta or not os.path.exists(ruta):
        raise ErrorEscena("Falta el logo: sube un SVG o PNG.")
    ancho = 6.0
    alto = ancho * e.ry / e.rx
    if ruta.lower().endswith(".svg"):
        logo, lw, lh = importar_svg(e, ruta)
        k = min(ancho * 0.7 / lw, alto * 0.38 / lh)
        logo.scale = (k, k, k)
    else:
        logo, _ = plano_imagen("Logo", ruta, 1.0, grosor=0.04)
        e.ajustar(logo, ancho * 0.7, alto * 0.38)
    d = e.distancia_para(ancho, alto, margen=1.0)
    e.camara((0, -d, 0))
    e.luces(escala=max(1.0, d / 10))
    e.pared_sombra(1.2)
    fin = e.total
    esc = tuple(logo.scale)
    rx = logo.rotation_euler[0]
    clave(logo, "scale", 1, tuple(v * 0.2 for v in esc), "BEZIER")
    clave(logo, "scale", e.seg(1.3), esc)
    clave(logo, "rotation_euler", 1, (rx, 0, math.radians(-200)), "BEZIER")
    clave(logo, "rotation_euler", e.seg(1.3), (rx, 0, math.radians(-6)))
    clave(logo, "rotation_euler", fin, (rx, 0, math.radians(6)))
    # Un destello: una luz alargada que cruza por delante y se refleja en el logo.
    d_luz = bpy.data.lights.new("Destello", "AREA")
    d_luz.shape = "RECTANGLE"
    d_luz.size = 0.4
    d_luz.size_y = alto * 1.4
    d_luz.energy = 0.0
    luz = bpy.data.objects.new("Destello", d_luz)
    luz.rotation_euler = (math.radians(90), 0, 0)
    e.s.collection.objects.link(luz)
    clave(luz, "location", e.seg(1.3), (-ancho * 0.6, -2.5, 0))
    clave(luz, "location", min(fin, e.seg(2.6)), (ancho * 0.6, -2.5, 0))
    clave(d_luz, "energy", e.seg(1.3), 0.0)
    clave(d_luz, "energy", e.seg(1.6), 1500.0 * max(1.0, d / 10))
    clave(d_luz, "energy", min(fin, e.seg(2.6)), 0.0)
    e.acercar(0.95)


def importar_svg(e, ruta):
    """Importa el SVG con sus colores: cada forma queda como su propia curva (unirlas pierde los
    materiales), normalizada a 1 unidad de lado y colgada de un vacío «Logo» que es el que se anima.
    Devuelve (vacío, ancho, alto)."""
    import addon_utils

    addon_utils.enable("io_curve_svg", default_set=True)
    antes = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=ruta)
    curvas = [o for o in bpy.data.objects if o not in antes and o.type == "CURVE"]
    if not curvas:
        raise ErrorEscena("El SVG no trae formas que se puedan pasar a 3D.")
    bpy.context.view_layer.update()
    xs, ys = [], []
    for o in curvas:
        for v in o.bound_box:
            w = o.matrix_world @ __import__("mathutils").Vector(v)
            xs.append(w.x)
            ys.append(w.y)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    f = 1.0 / max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
    propios = e.p.get("colores_logo", "originales") == "originales"
    a_srgb = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    grupo = vacio("Logo")
    for i, o in enumerate(curvas):
        o.location = ((o.location.x - cx) * f, (o.location.y - cy) * f, 0)
        o.scale = (o.scale.x * f, o.scale.y * f, 1)
        activar(o)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # Aplicar la escala también agranda el radio de los puntos, y el bisel se multiplica por él.
        for sp in o.data.splines:
            for pt in list(sp.bezier_points) + list(sp.points):
                pt.radius = 1.0
        o.data.extrude = 0.05
        o.data.bevel_depth = 0.006
        o.data.bevel_resolution = 2
        color = e.principal
        viejo = o.material_slots[0].material if o.material_slots else None
        if propios and viejo is not None:
            color = "#%02x%02x%02x" % tuple(round(max(0, min(1, a_srgb(v))) * 255) for v in viejo.diffuse_color[:3])
        o.data.materials.clear()
        o.data.materials.append(material(f"MatLogo{i}", color, e.estilo))
        # Cada forma un pelito más adelante que la anterior: las superpuestas no parpadean.
        o.location.z = i * 0.002
        o.parent = grupo
    grupo.rotation_euler = (math.radians(90), 0, 0)
    return grupo, (max(xs) - min(xs)) * f, (max(ys) - min(ys)) * f


def plantilla_producto(e):
    ruta = e.p.get("imagen")
    if not ruta or not os.path.exists(ruta):
        raise ErrorEscena("Falta la foto del producto.")
    tarjeta, ancho_t = plano_imagen("Producto", ruta, 2.4, grosor=0.03)
    if ancho_t > 2.6:  # foto muy ancha: que no se salga del pedestal
        tarjeta.scale = (2.6 / ancho_t,) * 3
        ancho_t = 2.6
    alto_t = 2.4 * tarjeta.scale[0]
    radio = max(1.1, ancho_t * 0.55)
    bpy.ops.mesh.primitive_cylinder_add(radius=radio, depth=0.45, location=(0, 0, -alto_t / 2 - 0.25), vertices=96)
    ped = bpy.context.object
    ped.name = "Pedestal"
    bev = ped.modifiers.new("bisel", "BEVEL")
    bev.width = 0.04
    bev.segments = 4
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    ped.data.materials.append(material("MatPedestal", e.principal, e.estilo))
    bpy.ops.mesh.primitive_torus_add(major_radius=radio * 1.02, minor_radius=0.035, location=(0, 0, ped.location.z - 0.12))
    aro = bpy.context.object
    aro.data.materials.append(material("MatAro", e.acento, "metal"))
    e.suelo_sombra(ped.location.z - 0.225)
    centro_z = 0.0
    alto_total = alto_t + 0.9
    texto = (e.p.get("texto") or "").strip()
    if texto:
        t = e.texto(partir_lineas(texto, 16), e.acento if luminancia(e.acento) > 0.05 else "#ffffff", "brillante", extrusion=0.06)
        e.ajustar(t, max(2.6, ancho_t) * 1.1, 0.55)
        bpy.context.view_layer.update()
        t.location = (0, 0, alto_t / 2 + 0.25 + t.dimensions.y / 2)
        alto_total += t.dimensions.y + 0.3
        centro_z = t.dimensions.y / 2
    d = e.distancia_para(max(2 * radio, ancho_t) * 1.15, alto_total * 1.1, margen=1.3)
    e.camara((0, -d, 0.25), objetivo=(0, 0, centro_z - 0.1))
    e.luces(centro=(0, 0, 0), escala=max(1.0, d / 10))
    fin = e.total
    giro = math.radians(32)
    clave(tarjeta, "rotation_euler", 1, (math.radians(90), 0, -giro))
    clave(tarjeta, "rotation_euler", fin // 2, (math.radians(90), 0, giro))
    clave(tarjeta, "rotation_euler", fin, (math.radians(90), 0, -giro))
    clave(tarjeta, "location", 1, (0, 0, 0.0))
    clave(tarjeta, "location", fin // 4, (0, 0, 0.1))
    clave(tarjeta, "location", fin // 2, (0, 0, 0.0))
    clave(tarjeta, "location", 3 * fin // 4, (0, 0, 0.1))
    clave(tarjeta, "location", fin, (0, 0, 0.0))
    clave(ped, "rotation_euler", 1, (0, 0, 0), "LINEAR")
    clave(ped, "rotation_euler", fin, (0, 0, math.radians(90)), "LINEAR")
    e.acercar(0.93)


def plantilla_fondo(e):
    ancho = 10.0
    alto = ancho * e.ry / e.rx
    d = e.distancia_para(ancho, alto, margen=1.0)
    e.camara((0, -d, 0))
    e.luces(escala=max(1.0, d / 10))
    cam = e.cam.data
    cam.dof.use_dof = True
    cam.dof.focus_distance = d
    cam.dof.aperture_fstop = 2.2
    rnd = random.Random(int(e.p.get("semilla") or 7))
    fin = e.total
    paso = 3
    colores = [e.principal, e.acento]
    if (e.p.get("estilo_fondo") or "burbujas") == "particulas":
        mats = [material(f"MatParticula{i}", c, "brillante") for i, c in enumerate(colores)]
        for m in mats:
            b = m.node_tree.nodes["Principled BSDF"]
            b.inputs["Emission Color"].default_value = b.inputs["Base Color"].default_value
            b.inputs["Emission Strength"].default_value = 2.5
        for i in range(70):
            r = rnd.uniform(0.04, 0.16)
            x = rnd.uniform(-ancho / 2, ancho / 2)
            y = rnd.uniform(-3, 4)
            fase = rnd.random()
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, 0), segments=16, ring_count=8)
            o = bpy.context.object
            o.data.materials.append(mats[i % 2])
            bpy.ops.object.shade_smooth()
            alto_v = alto * 1.4 + 1
            vaiven = rnd.uniform(0.1, 0.4)
            for f in range(1, fin + 1, paso):
                t = (f - 1) / fin
                z = ((fase + t) % 1.0) * alto_v - alto_v / 2
                xx = x + vaiven * math.sin(2 * math.pi * (t + fase))
                # Al dar la vuelta salta de arriba abajo fuera de cuadro: sin interpolar ese salto.
                clave(o, "location", f, (xx, y, z), "CONSTANT" if ((fase + t + paso / fin) % 1.0) < ((fase + t) % 1.0) else "LINEAR")
    else:  # burbujas (metaballs, que se funden como una lámpara de lava)
        for k, color in enumerate(colores):
            mb = bpy.data.metaballs.new(f"Burbujas{k}")
            mb.resolution = 0.12
            mb.render_resolution = 0.06
            o = bpy.data.objects.new(f"Burbujas{k}", mb)
            e.s.collection.objects.link(o)
            m = material(f"MatBurbuja{k}", color, "brillante")
            b = m.node_tree.nodes["Principled BSDF"]
            b.inputs["Emission Color"].default_value = b.inputs["Base Color"].default_value
            b.inputs["Emission Strength"].default_value = 0.35
            mb.materials.append(m)
            for i in range(5):
                el = mb.elements.new()
                el.radius = rnd.uniform(1.0, 1.8) * ancho / 10
                cx, cz = rnd.uniform(-ancho / 3, ancho / 3), rnd.uniform(-alto / 3, alto / 3)
                ax, az = rnd.uniform(0.8, 1.6) * ancho / 10, rnd.uniform(1.0, 2.2) * ancho / 10
                fx, fz = rnd.random(), rnd.random()
                kx, kz = rnd.choice([1, 2]), rnd.choice([1, 2])
                for f in range(1, fin + 2, paso):
                    t = (f - 1) / fin
                    el.co = (cx + ax * math.sin(2 * math.pi * (kx * t + fx)), rnd.uniform(-0.01, 0.01), cz + az * math.cos(2 * math.pi * (kz * t + fz)))
                    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
                    el.keyframe_insert("co", frame=f)


def plantilla_caja(e):
    rnd = random.Random(int(e.p.get("semilla") or 11))
    caja_mat = material("MatCaja", e.principal, e.estilo)
    cinta_mat = material("MatCinta", e.acento, "brillante")
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    cuerpo = bpy.context.object
    cuerpo.scale = (1, 1, 0.8)
    cuerpo.modifiers.new("bisel", "BEVEL").width = 0.03
    cuerpo.data.materials.append(caja_mat)
    tapa = bpy.data.objects.new("Tapa", None)
    e.s.collection.objects.link(tapa)
    tapa.location = (0, 0, 0.8)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0.92))
    t_malla = bpy.context.object
    t_malla.scale = (1.07, 1.07, 0.13)
    t_malla.modifiers.new("bisel", "BEVEL").width = 0.03
    t_malla.data.materials.append(caja_mat)
    piezas = [(cuerpo, (0.18, 1.01, 0.805), (0, 0, 0)), (cuerpo, (1.01, 0.18, 0.805), (0, 0, 0)),
              (tapa, (0.19, 1.08, 0.14), (0, 0, 0.12)), (tapa, (1.08, 0.19, 0.14), (0, 0, 0.12))]
    for padre, esc, loc in piezas:
        bpy.ops.mesh.primitive_cube_add(size=2)
        c = bpy.context.object
        c.scale = esc
        c.data.materials.append(cinta_mat)
        c.parent = padre
        c.location = loc if padre is tapa else (0, 0, 0)
    t_malla.parent = tapa
    t_malla.location = (0, 0, 0.12)
    e.suelo_sombra(-0.8)
    # Lo que aparece: texto o imagen.
    texto = (e.p.get("texto") or "").strip()
    ruta = e.p.get("imagen")
    if ruta and os.path.exists(ruta):
        contenido, _ = plano_imagen("Sorpresa", ruta, 1.8, grosor=0.02)
    else:
        contenido = e.texto(partir_lineas(texto or "¡Sorpresa!", 12), e.acento if luminancia(e.acento) > 0.05 else "#ffffff", "brillante", extrusion=0.1)
        e.ajustar(contenido, 2.6, 1.4)
    bpy.context.view_layer.update()
    vertical = e.ry > e.rx
    d = e.distancia_para(3.6, 5.2 if vertical else 4.4)
    e.camara((d * 0.42, -d * 0.9, d * 0.32), objetivo=(0, 0, 0.9))
    contenido.rotation_euler = (math.radians(90), 0, math.atan2(e.cam.location.x, -e.cam.location.y))
    e.luces(centro=(0, 0, 0.5), escala=max(1.0, d / 10))
    fin = e.total
    abre = min(e.seg(1.0), fin)
    # Sacudidas antes de abrir.
    clave(cuerpo, "rotation_euler", 1, (0, 0, 0))
    for i, f in enumerate(range(e.seg(0.35), abre, 3)):
        clave(cuerpo, "rotation_euler", f, (0, 0, math.radians(5 if i % 2 else -5)), "LINEAR")
        clave(tapa, "rotation_euler", f, (0, 0, math.radians(5 if i % 2 else -5)), "LINEAR")
    clave(cuerpo, "rotation_euler", abre, (0, 0, 0))
    clave(tapa, "rotation_euler", abre, (0, 0, 0))
    clave(tapa, "location", abre, (0, 0, 0.8))
    clave(tapa, "location", min(fin, abre + e.seg(0.9)), (3.5, 6.0, 9.0))
    clave(tapa, "rotation_euler", min(fin, abre + e.seg(0.9)), (math.radians(-70), math.radians(25), math.radians(40)))
    esc = tuple(contenido.scale)
    clave(contenido, "location", abre, (0, 0, -0.2), "BACK")
    clave(contenido, "scale", abre, tuple(v * 0.1 for v in esc), "BACK")
    clave(contenido, "location", min(fin, abre + e.seg(0.8)), (0, 0, 2.1))
    clave(contenido, "scale", min(fin, abre + e.seg(0.8)), esc)
    clave(contenido, "location", fin, (0, 0, 2.25))
    # Confeti: trayectorias balísticas calculadas (siempre igual con la misma semilla).
    colores = [e.principal, e.acento, "#ffd166", "#ffffff"]
    mats = [material(f"MatConfeti{i}", c, "brillante") for i, c in enumerate(colores)]
    g = -9.0
    for i in range(80):
        bpy.ops.mesh.primitive_plane_add(size=0.12)
        p = bpy.context.object
        p.data.materials.append(mats[i % len(mats)])
        ang = rnd.uniform(0, 2 * math.pi)
        vel = rnd.uniform(1.5, 3.5)
        v = (math.cos(ang) * vel, math.sin(ang) * vel, rnd.uniform(5.0, 8.0))
        giro = [rnd.uniform(-12, 12) for _ in range(3)]
        p0 = (rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 0.85)
        largo = rnd.uniform(0.4, 0.8)
        clave(p, "scale", 1, (0, 0, 0), "CONSTANT")
        clave(p, "scale", abre, (1, largo, 1), "CONSTANT")
        for f in range(abre, fin + 1, 2):
            t = (f - abre) / FPS
            arrastre = 1 / (1 + 0.6 * t)
            loc = (p0[0] + v[0] * t * arrastre, p0[1] + v[1] * t * arrastre, max(-0.79, p0[2] + v[2] * t + 0.5 * g * t * t * 0.55))
            clave(p, "location", f, loc, "LINEAR")
            clave(p, "rotation_euler", f, tuple(w * t for w in giro), "LINEAR")
        clave(p, "location", 1, p0, "CONSTANT")
    e.acercar(0.95)



# ---------------------------------------------------------------- datos (gráficos)

PREFIJOS = ("$", "US$", "€", "£", "S/", "R$")


def numero_texto(v, unidad="", decimales=None):
    """12500 → «12,500»; 3.5 → «3.5»; con su unidad delante ($) o detrás (%, kg)."""
    if decimales is None:
        decimales = 0 if abs(v - round(v)) < 1e-9 else 1
    t = f"{v:,.{decimales}f}"
    u = (unidad or "").strip()
    if not u:
        return t
    if u in PREFIJOS:
        return f"{u}{t}"
    return f"{t}{u}" if u == "%" else f"{t} {u}"


def facil_salida(t):
    """0→1 que frena al final (cúbica)."""
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def facil_rebote(t):
    """0→1 que se pasa un poco y vuelve (back.out), para que las barras «lleguen»."""
    t = max(0.0, min(1.0, t))
    c = 1.70158
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def color_texto(fondo):
    return "#ffffff" if luminancia(fondo) < 0.35 else "#111111"


def colores_serie(e, n):
    base = [e.principal, e.acento, "#ffd166", "#06d6a0", "#4cc9f0", "#ef476f"]
    # Si el acento es blanco o negro (texto), que no sea una barra invisible contra el fondo.
    if abs(luminancia(e.acento) - luminancia(e.fondo)) < 0.08:
        base[1] = "#ffd166"
    return [base[i % len(base)] for i in range(n)]


def arco(e, nombre, radio, centro, grosor, y=0.0):
    """Un anillo abierto (polilínea de 129 puntos) de pie frente a la cámara, que empieza arriba y va en
    el sentido del reloj. Abierto porque en una curva cerrada Blender ignora bevel_factor (con él se anima
    cuánto del anillo se ve)."""
    c = bpy.data.curves.new(nombre, "CURVE")
    c.dimensions = "3D"
    sp = c.splines.new("POLY")
    n = 128
    sp.points.add(n)
    for i, pt in enumerate(sp.points):
        a = 2 * math.pi * i / n
        pt.co = (radio * math.sin(a), radio * math.cos(a), 0, 1)
    c.bevel_depth = grosor
    c.bevel_resolution = 6
    c.use_fill_caps = True
    c.bevel_factor_mapping_start = "SPLINE"
    c.bevel_factor_mapping_end = "SPLINE"
    o = bpy.data.objects.new(nombre, c)
    o.location = (0, y, centro)
    o.rotation_euler = (math.radians(90), 0, 0)
    e.s.collection.objects.link(o)
    return o


def contadores(e, items):
    """Textos que cambian en cada cuadro (los números que cuentan). items: [(curva, función(cuadro) → texto)]."""
    def al_cambiar(escena, *_):
        f = escena.frame_current
        for curva, fn in items:
            curva.body = fn(f)

    bpy.app.handlers.frame_change_pre.append(al_cambiar)
    al_cambiar(e.s)


def texto_plano(e, cuerpo, color, tam, estilo="brillante", extrusion=0.02):
    t = e.texto(cuerpo, color, estilo, extrusion=extrusion, tam=tam)
    t.data.bevel_depth = 0.004
    return t


def plantilla_datos(e):
    tipo = e.p.get("tipo_datos") or "barras"
    datos = []
    for d in (e.p.get("datos") or [])[:6]:
        try:
            datos.append((str(d.get("etiqueta") or "").strip()[:18], float(d.get("valor"))))
        except (TypeError, ValueError):
            continue
    if not datos:
        raise ErrorEscena("Faltan los datos: escribe al menos un número.")
    unidad = (e.p.get("unidad") or "").strip()[:12]
    titulo = (e.p.get("texto") or "").strip()
    vertical = e.ry > e.rx
    ancho = 6.0
    alto = ancho * e.ry / e.rx
    tinta = color_texto(e.fondo)
    fin = e.total
    entra = min(fin, e.seg(1.6))  # todo termina de crecer en 1,6 s
    items = []
    arriba = alto / 2 - (alto * 0.12 if vertical else alto * 0.1)
    if titulo:
        t = texto_plano(e, partir_lineas(titulo, 16 if vertical else 30), tinta, 1.0, extrusion=0.05)
        e.ajustar(t, ancho * 0.86, alto * (0.14 if vertical else 0.16))
        bpy.context.view_layer.update()
        t.location = (0, 0, arriba - t.dimensions.y / 2)
        esc = tuple(t.scale)
        clave(t, "scale", 1, tuple(v * 0.6 for v in esc), "BACK")
        clave(t, "scale", e.seg(0.6), esc)
        clave(t, "location", 1, (0, 0, t.location.z + 0.3), "BEZIER")
        clave(t, "location", e.seg(0.6), (0, 0, t.location.z))
        arriba = t.location.z - t.dimensions.y / 2 - 0.25

    if tipo == "numero":
        etiqueta, valor = datos[0]
        porciento = unidad == "%" and 0 <= valor <= 100
        n = texto_plano(e, numero_texto(valor, unidad), e.principal, 1.0, e.estilo, extrusion=0.12)
        n.data.bevel_depth = 0.012
        alto_num = min(alto * 0.22, (arriba + alto / 2) * 0.45)
        e.ajustar(n, ancho * (0.55 if porciento else 0.86), alto_num)
        escala_fija = tuple(n.scale)
        centro = (arriba + (-alto / 2 + alto * 0.08)) / 2
        n.location = (0, 0, centro)
        decimales = 0 if abs(valor - round(valor)) < 1e-9 else 1
        items.append((n.data, lambda f: numero_texto(valor * facil_salida((f - 1) / max(1, entra - 1)), unidad, decimales)))
        if porciento:
            radio = min(ancho * 0.38, alto_num * 1.15)
            for k, (fac, color, grosor) in enumerate(((1.0, e.acento if abs(luminancia(e.acento) - luminancia(e.fondo)) > 0.08 else "#888888", 0.05), (valor / 100, e.principal, 0.11))):
                aro = arco(e, f"Aro{k}", radio, centro, grosor, y=-0.05 * k)
                aro.data.materials.append(material(f"MatAro{k}", color, e.estilo if k else "mate"))
                if k == 0:
                    m = aro.data.materials[0]
                    m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.35
                else:
                    clave(aro.data, "bevel_factor_end", 1, 0.0, "LINEAR")
                    for f in range(1, entra + 1, 2):
                        clave(aro.data, "bevel_factor_end", f, max(0.001, fac * facil_salida((f - 1) / max(1, entra - 1))), "LINEAR")
                    clave(aro.data, "bevel_factor_end", entra, max(0.001, fac), "LINEAR")
        clave(n, "scale", 1, tuple(v * 0.3 for v in escala_fija), "BACK")
        clave(n, "scale", e.seg(0.8), escala_fija)
        if etiqueta:
            et = texto_plano(e, partir_lineas(etiqueta, 18), tinta, 1.0)
            e.ajustar(et, ancho * 0.8, alto * 0.06)
            bpy.context.view_layer.update()
            bajo = centro - (min(ancho * 0.38, alto_num * 1.15) if porciento else alto_num / 2) - 0.35
            et.location = (0, 0, bajo - et.dimensions.y / 2)
        e.camara((0, -e.distancia_para(ancho, alto, margen=1.0), 0), objetivo=(0, 0, 0))
        e.luces(escala=max(1.0, e.cam.location.length / 10))
        e.pared_sombra(0.6)

    elif tipo == "pastel":
        total_v = sum(max(0.0, v) for _, v in datos) or 1.0
        radio = min(ancho * 0.24, (arriba + alto / 2) * 0.26)
        centro = (arriba + (-alto / 2)) / 2 + (alto * 0.06 if vertical else 0)
        colores = colores_serie(e, len(datos))
        acum = 0.0
        for i, (etiqueta, v) in enumerate(datos):
            a, b = acum / total_v, (acum + max(0.0, v)) / total_v
            acum += max(0.0, v)
            seg = arco(e, f"Porcion{i}", radio, centro, radio * 0.32)
            seg.data.materials.append(material(f"MatPastel{i}", colores[i], e.estilo))
            for f in list(range(1, entra + 1, 2)) + [entra]:
                p = facil_salida((f - 1) / max(1, entra - 1))
                fin_seg = max(a + 0.0005, min(b, p))
                clave(seg.data, "bevel_factor_start", f, a, "LINEAR")
                clave(seg.data, "bevel_factor_end", f, fin_seg if p > a else a + 0.0005, "LINEAR")
            # Separa un poco cada porción hacia afuera al terminar.
            medio = (a + b) / 2 * 2 * math.pi
            dx, dz = math.sin(medio), math.cos(medio)
            clave(seg, "location", entra, (0, 0, centro))
            clave(seg, "location", min(fin, entra + e.seg(0.4)), (dx * radio * 0.05, 0, centro + dz * radio * 0.05))
            # La etiqueta con su porcentaje, afuera de la porción.
            pct = 100 * max(0.0, v) / total_v
            txt = f"{etiqueta}\n{pct:.0f}%" if etiqueta else f"{pct:.0f}%"
            et = texto_plano(e, txt, tinta, 1.0)
            e.ajustar(et, ancho * 0.24, alto * 0.05)
            bpy.context.view_layer.update()
            r_et = radio * 1.32 + max(et.dimensions.x * abs(dx), et.dimensions.y * abs(dz)) / 2 + 0.1
            lim = ancho / 2 * 0.88 - et.dimensions.x / 2
            et.location = (max(-lim, min(lim, dx * r_et)), -0.2, centro + dz * r_et)
            esc = tuple(et.scale)
            aparece = max(1, round(1 + (entra - 1) * min(1.0, b)))
            clave(et, "scale", 1, (0.0001,) * 3, "CONSTANT")
            clave(et, "scale", max(1, aparece - 6), (0.0001,) * 3, "BACK")
            clave(et, "scale", aparece + 4, esc)
        e.camara((0, -e.distancia_para(ancho, alto, margen=1.0), alto * 0.06), objetivo=(0, 0, 0))
        e.luces(escala=max(1.0, e.cam.location.length / 10))
        e.pared_sombra(radio * 0.6)

    else:  # barras
        n = len(datos)
        maximo = max(max(v for _, v in datos), 1e-6)
        ancho_graf = ancho * 0.84
        paso = ancho_graf / n
        grosor = paso * 0.62
        base_z = -alto / 2 + alto * (0.16 if vertical else 0.2)
        alto_graf = max(0.5, (arriba - base_z) * 0.78)
        colores = colores_serie(e, n) if n <= 3 else [e.principal] * n
        if n > 3:
            # Muchas barras: todas del color principal y la más alta con el acento.
            i_max = max(range(n), key=lambda i: datos[i][1])
            colores[i_max] = colores_serie(e, 2)[1]
        nombres = []
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, base_z - 0.03))
        linea = bpy.context.object
        linea.scale = (ancho_graf * 1.04, grosor * 1.3, 0.06)
        linea.data.materials.append(material("MatBase", tinta, "mate"))
        for i, (etiqueta, v) in enumerate(datos):
            x = -ancho_graf / 2 + paso * (i + 0.5)
            h = max(0.04, alto_graf * max(0.0, v) / maximo)
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, base_z))
            b = bpy.context.object
            b.name = f"Barra{i}"
            for vert in b.data.vertices:  # el origen abajo: crece hacia arriba
                vert.co.z += 0.5
            bev = b.modifiers.new("bisel", "BEVEL")
            bev.width = min(0.06, grosor * 0.12)
            bev.segments = 3
            b.data.materials.append(material(f"MatBarra{i}", colores[i], e.estilo))
            demora = (i / max(1, n)) * 0.35
            ini = 1 + round(demora * (entra - 1))
            for f in list(range(1, entra + 1, 2)) + [entra]:
                t = (f - ini) / max(1, entra - ini)
                k = facil_rebote(t) if f >= ini else 0.0
                clave(b, "scale", f, (grosor, grosor, max(0.001, h * k)), "LINEAR")
            # El valor arriba, contando y subiendo con la barra.
            val = texto_plano(e, numero_texto(v, unidad), tinta, 1.0, extrusion=0.03)
            e.ajustar(val, paso * 0.9, alto * (0.045 if vertical else 0.07))
            bpy.context.view_layer.update()
            alto_val = val.dimensions.y
            decimales = 0 if abs(v - round(v)) < 1e-9 else 1

            def cuenta(f, v=v, ini=ini, decimales=decimales):
                t = (f - ini) / max(1, entra - ini)
                return numero_texto(v * facil_salida(t) if f >= ini else 0.0, unidad, decimales)

            items.append((val.data, cuenta))
            for f in list(range(1, entra + 1, 2)) + [entra]:
                t = (f - ini) / max(1, entra - ini)
                k = facil_rebote(t) if f >= ini else 0.0
                clave(val, "location", f, (x, -grosor / 2 - 0.02, base_z + max(0.001, h * k) + 0.12 + alto_val / 2), "LINEAR")
            if etiqueta:
                et = texto_plano(e, partir_lineas(etiqueta, 10), tinta, 1.0)
                e.ajustar(et, paso * 0.92, alto * 0.05)
                nombres.append((et, x))
        # Todos los nombres del mismo tamaño (el del más largo) y colgando de la base.
        if nombres:
            k = min(et.scale[0] for et, _ in nombres)
            bpy.context.view_layer.update()
            for et, x in nombres:
                f = k / et.scale[0]
                alto_et = et.dimensions.y * f
                et.scale = (k, k, k)
                et.location = (x, -grosor * 0.65 - 0.05, base_z - 0.14 - alto_et / 2)
        d = e.distancia_para(ancho, alto, margen=1.0)
        e.camara((0, -d, alto * 0.08), objetivo=(0, 0, 0))
        e.luces(escala=max(1.0, d / 10))
        # Sin suelo que atrape sombras: taparía los nombres, que van debajo de la base.
        e.pared_sombra(grosor * 1.5)
    contadores(e, items)
    e.acercar(0.96)


PLANTILLAS = {"texto": plantilla_texto, "logo": plantilla_logo, "producto": plantilla_producto, "fondo": plantilla_fondo, "caja": plantilla_caja, "datos": plantilla_datos}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise ErrorEscena("Falta el pedido (archivo JSON).")
    with open(argv[0], encoding="utf-8") as f:
        pedido = json.load(f)
    fn = PLANTILLAS.get(pedido.get("plantilla"))
    if fn is None:
        raise ErrorEscena(f"No conozco la plantilla «{pedido.get('plantilla')}».")
    e = Escena(pedido)
    fn(e)
    if pedido.get("guardar_blend"):
        bpy.ops.wm.save_as_mainfile(filepath=pedido["guardar_blend"])
    if pedido.get("solo_armar"):
        print("GEEPER_ARMADA", flush=True)
        return
    e.render(pedido["cuadros"])
    print("GEEPER_LISTO", flush=True)


try:
    main()
except ErrorEscena as x:
    print(f"GEEPER_ERROR {x}", flush=True)
    os._exit(3)
except Exception as x:  # noqa: BLE001 - cualquier fallo de Blender sale con un mensaje legible
    import traceback

    traceback.print_exc()
    print(f"GEEPER_ERROR No se pudo armar la escena ({type(x).__name__}: {x}).", flush=True)
    os._exit(4)
