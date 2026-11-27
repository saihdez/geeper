"""Personajes 3D de Geeper que hablan (plantilla «personaje» de escena3d.py).

Personajes propios hechos con código (sin modelos bajados): «bolita» (una mascota redonda) y «robot».
La boca sigue la voz con las formas de Rhubarb Lip Sync (A–H y X, `boca` en el pedido), y el cuerpo se
mueve con el volumen de la voz (`audio`, WAV): asiente al hablar, respira en los silencios, parpadea y
mueve los brazos en los golpes de voz.

Formas de boca de Rhubarb (https://github.com/DanielSWolf/rhubarb-lip-sync#mouth-shapes):
A cerrada (M, B, P) · B apenas abierta, dientes · C abierta (E) · D bien abierta (A) · E redonda (O)
F fruncida (U, W) · G dientes sobre el labio (F, V) · H lengua arriba (L) · X en reposo.
"""
import math
import random
import wave

import bpy

# Ayudas de escena3d.py (clave, lineal, ErrorEscena, FPS): las pone escena3d antes de usar este módulo.
H = None

# (ancho, alto) de la boca por forma, y si se ven los dientes / la lengua.
FORMAS = {
    "X": (0.26, 0.03, False, False),
    "A": (0.24, 0.035, False, False),
    "B": (0.30, 0.10, True, False),
    "C": (0.32, 0.18, True, False),
    "D": (0.36, 0.30, False, True),
    "E": (0.22, 0.22, False, True),
    "F": (0.14, 0.13, False, False),
    "G": (0.30, 0.09, True, False),
    "H": (0.30, 0.20, False, True),
}

PERSONAJES = ("bolita", "robot")


def envolvente(ruta, fps, total):
    """Volumen de la voz por cuadro (0–1, suavizado). Sin audio: todo en 0."""
    import numpy as np

    if not ruta:
        return [0.0] * total
    try:
        with wave.open(ruta, "rb") as w:
            sr, canales, ancho = w.getframerate(), w.getnchannels(), w.getsampwidth()
            crudo = w.readframes(w.getnframes())
    except (OSError, wave.Error):
        return [0.0] * total
    tipo = {1: np.int8, 2: np.int16, 4: np.int32}.get(ancho, np.int16)
    x = np.frombuffer(crudo, dtype=tipo).astype(np.float32)
    if canales > 1:
        x = x.reshape(-1, canales).mean(axis=1)
    x /= float(np.iinfo(tipo).max)
    por = max(1, int(sr / fps))
    rms = []
    for i in range(total):
        tramo = x[i * por:(i + 1) * por]
        rms.append(float(np.sqrt(np.mean(tramo * tramo))) if len(tramo) else 0.0)
    tope = max(np.percentile(rms, 95), 1e-4) if rms else 1.0
    salida, prev = [], 0.0
    for v in rms:
        v = min(1.0, v / tope)
        prev = prev + (v - prev) * (0.55 if v > prev else 0.2)  # sube rápido, baja lento
        salida.append(prev)
    return salida


def mat(nombre, color, rugosidad=0.45, capa=0.0, emision=0.0, sss=0.0):
    lineal = H.lineal
    m = bpy.data.materials.new(nombre)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lineal(color), 1)
    b.inputs["Roughness"].default_value = rugosidad
    if capa:
        b.inputs["Coat Weight"].default_value = capa
        b.inputs["Coat Roughness"].default_value = 0.08
    if emision:
        b.inputs["Emission Color"].default_value = (*lineal(color), 1)
        b.inputs["Emission Strength"].default_value = emision
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.4, 0.2, 0.15)
        b.inputs["Subsurface Scale"].default_value = 0.08
    return m


def esfera(nombre, radio, loc, material, escala=(1, 1, 1), padre=None, suave=True, seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radio, location=loc, segments=seg, ring_count=seg // 2)
    o = bpy.context.object
    o.name = nombre
    o.scale = escala
    if suave:
        bpy.ops.object.shade_smooth()
    o.data.materials.append(material)
    if padre:
        o.parent = padre
        o.matrix_parent_inverse = padre.matrix_world.inverted()
    return o


def caja(nombre, tam, loc, material, padre=None, bisel=0.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = nombre
    o.scale = tam
    bpy.ops.object.transform_apply(scale=True)
    if bisel:
        b = o.modifiers.new("bisel", "BEVEL")
        b.width = bisel
        b.segments = 6
        bpy.ops.object.shade_smooth()
        o.modifiers.new("normales", "WEIGHTED_NORMAL")
    o.data.materials.append(material)
    if padre:
        o.parent = padre
        o.matrix_parent_inverse = padre.matrix_world.inverted()
    return o


class Personaje:
    """Arma el personaje centrado en x=0, con los pies en z=0, mirando a -Y. Deja referencias a las partes
    que se animan: cuerpo (raíz), cabeza, ojos (para parpadear), pupilas, boca, dientes, lengua, brazos."""

    def __init__(self, e, tipo):
        self.e = e
        self.tipo = tipo if tipo in PERSONAJES else "bolita"
        self.raiz = bpy.data.objects.new("Personaje", None)
        e.s.collection.objects.link(self.raiz)
        self.ojos, self.pupilas, self.brazos = [], [], []
        getattr(self, f"armar_{self.tipo}")()

    # ------------------------------------------------------------ bolita
    def armar_bolita(self):
        e = self.e
        piel = mat("Piel", e.principal, 0.5, capa=0.25, sss=0.15)
        r = 1.0
        self.cabeza = esfera("Cuerpo", r, (0, 0, r * 1.02), piel, escala=(1.0, 0.92, 1.04), padre=self.raiz)
        frente = -r * 0.92
        blanco = mat("Ojo", "#ffffff", 0.2, capa=0.6)
        negro = mat("Pupila", "#101014", 0.15, capa=0.8)
        brillo = mat("Brillo", "#ffffff", emision=4.0)
        for lado in (-1, 1):
            ojo = esfera(f"Ojo{lado}", 0.2, (0.33 * lado, frente * 0.86, r * 1.3), blanco, escala=(1, 0.55, 1.15), padre=self.cabeza)
            pup = esfera(f"Pupila{lado}", 0.11, (0.33 * lado, frente * 0.86 - 0.075, r * 1.27), negro, escala=(1, 0.5, 1.15), padre=ojo)
            esfera(f"Brillo{lado}", 0.032, (0.33 * lado + 0.04, frente * 0.86 - 0.13, r * 1.33), brillo, padre=pup, seg=16)
            self.ojos.append(ojo)
            self.pupilas.append(pup)
            # Cachetes.
            mej = esfera(f"Cachete{lado}", 0.12, (0.55 * lado, frente * 0.8, r * 1.02), mat(f"Cachete{lado}", "#ff7a9a", 0.6, emision=0.15), escala=(1, 0.3, 0.6), padre=self.cabeza, seg=24)
            mej.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.55
            # Brazos (bracitos redondeados a los lados) y pies.
            hombro = bpy.data.objects.new(f"Hombro{lado}", None)
            e.s.collection.objects.link(hombro)
            hombro.location = (0.9 * lado, -0.05, r * 0.9)
            hombro.parent = self.cabeza
            hombro.matrix_parent_inverse = self.cabeza.matrix_world.inverted()
            esfera(f"Brazo{lado}", 0.15, (1.12 * lado, -0.05, r * 0.62), piel, escala=(0.9, 0.9, 1.9), padre=hombro, seg=24)
            self.brazos.append((hombro, lado))
            esfera(f"Pie{lado}", 0.22, (0.4 * lado, -0.12, 0.08), mat(f"Pie{lado}", e.acento if e.acento.lower() not in ("#ffffff", "#000000") else "#333344", 0.5, capa=0.3), escala=(1, 1.3, 0.55), padre=self.raiz, seg=24)
        self.boca_en(frente * 0.97, r * 0.82, 1.0)

    # ------------------------------------------------------------ robot
    def armar_robot(self):
        e = self.e
        chapa = mat("Chapa", e.principal, 0.3, capa=0.5)
        oscuro = mat("Pantalla", "#0b0f14", 0.15, capa=1.0)
        luz = "#4cf2ff" if e.acento.lower() in ("#ffffff", "#000000") else e.acento
        led = mat("Led", luz, emision=2.2)
        self.cabeza = caja("Cabeza", (1.5, 1.1, 1.15), (0, 0, 1.95), chapa, padre=self.raiz, bisel=0.22)
        caja("Pantalla", (1.25, 0.1, 0.85), (0, -0.53, 1.95), oscuro, padre=self.cabeza, bisel=0.12)
        cuerpo = caja("Torso", (1.1, 0.8, 0.9), (0, 0, 0.75), chapa, padre=self.raiz, bisel=0.18)
        caja("Cuello", (0.3, 0.3, 0.3), (0, 0, 1.33), oscuro, padre=cuerpo, bisel=0.05)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.4, location=(0, 0, 2.7))
        antena = bpy.context.object
        antena.data.materials.append(oscuro)
        antena.parent = self.cabeza
        antena.matrix_parent_inverse = self.cabeza.matrix_world.inverted()
        esfera("Punta", 0.09, (0, 0, 2.92), led, padre=antena, seg=24)
        for lado in (-1, 1):
            ojo = caja(f"Ojo{lado}", (0.24, 0.05, 0.24), (0.3 * lado, -0.6, 2.08), led, padre=self.cabeza, bisel=0.1)
            self.ojos.append(ojo)
            self.pupilas.append(ojo)
            hombro = bpy.data.objects.new(f"Hombro{lado}", None)
            e.s.collection.objects.link(hombro)
            hombro.location = (0.62 * lado, 0, 1.05)
            hombro.parent = cuerpo
            hombro.matrix_parent_inverse = cuerpo.matrix_world.inverted()
            caja(f"Brazo{lado}", (0.22, 0.22, 0.7), (0.72 * lado, 0, 0.72), chapa, padre=hombro, bisel=0.1)
            esfera(f"Mano{lado}", 0.15, (0.72 * lado, 0, 0.32), oscuro, padre=hombro, seg=24)
            self.brazos.append((hombro, lado))
            caja(f"Pie{lado}", (0.36, 0.5, 0.2), (0.3 * lado, -0.05, 0.1), oscuro, padre=self.raiz, bisel=0.08)
        self.boca_en(-0.6, 1.78, 1.0, led=led)

    # ------------------------------------------------------------ boca
    def boca_en(self, y, z, escala, led=None):
        """Una boca que cambia de ancho y alto (las formas de FORMAS), con dientes arriba y lengua abajo
        colgados de ella (escalan con la boca y se esconden según la forma)."""
        hueco = led or mat("Boca", "#3a0d16", 0.6)
        self.boca = esfera("Boca", 1.0, (0, y, z), hueco, escala=(0.26, 0.05, 0.03), padre=self.cabeza, seg=32)
        if led:
            self.dientes = self.lengua = None
            return
        dientes = esfera("Dientes", 1.0, (0, y - 0.035, z + 0.02), mat("Dientes", "#fbfbf7", 0.3), padre=self.cabeza, seg=24)
        lengua = esfera("Lengua", 1.0, (0, y - 0.03, z - 0.02), mat("Lengua", "#e0566b", 0.5, sss=0.2), padre=self.cabeza, seg=24)
        self.dientes, self.lengua = dientes, lengua
        self.base_boca = (y, z)

    def forma(self, cuadro, letra, interp="LINEAR"):
        clave = H.clave
        w, h, dientes, lengua = FORMAS.get(letra, FORMAS["X"])
        clave(self.boca, "scale", cuadro, (w, 0.05, h), interp)
        if self.dientes is None:
            return
        y, z = self.base_boca
        # Dientes: una franja arriba; lengua: abajo. Con escala casi 0 cuando no se ven.
        clave(self.dientes, "scale", cuadro, (w * 0.78, 0.03, h * 0.28) if dientes else (0.001, 0.001, 0.001), interp)
        clave(self.dientes, "location", cuadro, (0, y - 0.035, z + h * 0.62), interp)
        clave(self.lengua, "scale", cuadro, (w * 0.55, 0.03, h * 0.38) if lengua else (0.001, 0.001, 0.001), interp)
        clave(self.lengua, "location", cuadro, (0, y - 0.03, z - h * 0.5), interp)


def animar(e, p, boca, audio):
    """Boca con las formas de Rhubarb, cuerpo con el volumen, parpadeo y miradas."""
    FPS, clave = H.FPS, H.clave
    total = e.total
    rnd = random.Random(int(e.p.get("semilla") or 5))
    # 1. Boca: cada forma entra en 2 cuadros desde la anterior.
    p.forma(1, "X")
    for c in boca:
        f = 1 + round(float(c.get("start", 0)) * FPS)
        if f > total:
            break
        letra = str(c.get("value", "X"))
        p.forma(max(1, f - 1), letra)
    # 2. Volumen → asentir, estirarse y respirar.
    env = envolvente(audio, FPS, total)
    cab = p.cabeza
    base_rot = tuple(cab.rotation_euler)
    base_esc = tuple(cab.scale)
    for f in range(1, total + 1, 2):
        v = env[f - 1]
        t = f / FPS
        respira = 0.012 * math.sin(2 * math.pi * t / 3.2)
        clave(cab, "rotation_euler", f, (base_rot[0] + math.radians(5) * v * math.sin(2 * math.pi * t * 1.7), base_rot[1] + math.radians(2.5) * math.sin(2 * math.pi * t / 4.1), base_rot[2] + math.radians(6) * math.sin(2 * math.pi * t / 5.3)), "LINEAR")
        clave(cab, "scale", f, (base_esc[0] * (1 - 0.02 * v), base_esc[1], base_esc[2] * (1 + respira + 0.035 * v)), "LINEAR")
    # 3. Brazos: suben en los golpes de voz (picos), si no, cuelgan con un vaivén suave.
    picos = [i for i in range(3, total - 3) if env[i] > 0.75 and env[i] >= max(env[i - 3:i + 4])]
    usados = []
    for i in picos:
        if usados and i - usados[-1] < FPS * 1.2:
            continue
        usados.append(i)
    for hombro, lado in p.brazos:
        clave(hombro, "rotation_euler", 1, (0, 0, 0))
        for i in usados:
            if rnd.random() < 0.5 and lado == 1 or rnd.random() < 0.35:
                sube = math.radians(rnd.uniform(35, 70)) * lado
                clave(hombro, "rotation_euler", max(1, i - 4), (0, 0, 0), "BEZIER")
                clave(hombro, "rotation_euler", i + 3, (0, sube * 0.15, sube), "BEZIER")
                clave(hombro, "rotation_euler", min(total, i + 16), (0, 0, 0), "BEZIER")
    # 4. Parpadeo cada 2–4,5 s y miradas cortas.
    f = round(FPS * rnd.uniform(0.6, 1.6))
    while f < total - 6:
        for ojo in p.ojos:
            s = tuple(ojo.scale)
            clave(ojo, "scale", f - 1, s, "LINEAR")
            clave(ojo, "scale", f + 1, (s[0], s[1], s[2] * 0.08), "LINEAR")
            clave(ojo, "scale", f + 4, s, "LINEAR")
        f += round(FPS * rnd.uniform(2.0, 4.5))
    if p.tipo == "bolita":
        f = round(FPS * rnd.uniform(1.0, 2.5))
        while f < total - 10:
            dx, dz = rnd.uniform(-0.04, 0.04), rnd.uniform(-0.025, 0.025)
            for pup in p.pupilas:
                loc = pup.location.copy()
                clave(pup, "location", f, loc, "BEZIER")
                clave(pup, "location", f + 4, (loc.x + dx, loc.y, loc.z + dz), "BEZIER")
                clave(pup, "location", min(total, f + round(FPS * 1.2)), (loc.x + dx, loc.y, loc.z + dz), "BEZIER")
                clave(pup, "location", min(total, f + round(FPS * 1.2) + 5), loc, "BEZIER")
            f += round(FPS * rnd.uniform(2.5, 5.0))


def plantilla_personaje(e):
    p = Personaje(e, e.p.get("personaje") or "bolita")
    bpy.context.view_layer.update()
    alto = 2.25 if p.tipo == "bolita" else 3.05
    # Encuadre: plano medio-largo; en vertical el personaje queda en la mitad de abajo y deja aire arriba.
    vertical = e.ry > e.rx
    ancho_vis = alto * ((1.4 if p.tipo == "bolita" else 1.0) if vertical else 2.4)
    alto_vis = ancho_vis * e.ry / e.rx
    centro_z = alto * 0.5 + (alto_vis * 0.12 if vertical else alto * 0.05)
    d = e.distancia_para(ancho_vis, alto_vis, margen=1.0)
    e.camara((0, -d, centro_z + d * 0.06), objetivo=(0, 0, centro_z))
    e.luces(centro=(0, 0, alto * 0.6), escala=max(1.0, d / 10))
    e.suelo_sombra(0.0)
    boca = e.p.get("boca") or []
    audio = e.p.get("audio")
    if not boca and not audio:
        raise H.ErrorEscena("Falta la voz del personaje.")
    animar(e, p, boca, audio)
    # Entra con un saltito.
    clave = H.clave
    clave(p.raiz, "location", 1, (0, 0, -0.4), "BACK")
    clave(p.raiz, "location", e.seg(0.45), (0, 0, 0))
