/** Diagnóstico de solo lectura: verifica lo que Geeper necesita y dice cómo arreglar lo que falle. */
import fs from "node:fs/promises";
import path from "node:path";
import { correr } from "./proceso";
import { apiViva } from "./mpt";
import { ESTUDIO, FFMPEG, GPU_LOCK_BIN, GPU_LOCK_FILE, HYPERFRAMES_VERSION, MPT_API, PHOTOCRAFT_CLI, PHOTOCRAFT_VERSION, PYTHON_VOZ, RAIZ_REPO, VECTORCRAFT_CLI, VECTORCRAFT_VERSION, dirDatos } from "./rutas";
import { versionPhotocraft } from "./photocraft";
import { versionVectorcraft } from "./vectorcraft";
import { existe } from "./archivos";
import { PYTHON_CLIPS } from "./fuentes";
import { db } from "./db";
import { existeClave, rutaClave } from "./redes/cifrado";
import { ErrorArchivoPrivado } from "./redes/archivo-privado";
import { leerConfig, rutaRedes, urlCallback, type ConfigRedes } from "./redes/config";
import { revisarPrivados } from "./redes/privados";
import { obtenerRed } from "./redes/index";
import { juzgar, leerAjustes, salidaActual, verificarSalida } from "./redes/salida";
import { REDES_IDS } from "./redes/tipos";
import { PYTHON_CARAS, YUNET } from "./caras";
import { CONTENEDORES_MPT } from "./imagenes";
import { chequeoAuditoria, chequeoFirma, chequeoImagenes, chequeoSbom } from "./doctor-evidencia";

export interface Chequeo {
  nombre: string;
  ok: boolean;
  /** Aviso: no impide trabajar. */
  aviso?: boolean;
  detalle: string;
  arreglo?: string;
}


async function intento(cmd: string, args: string[], timeout = 20_000) {
  try {
    return await correr(cmd, args, { permitirFallo: true, timeout });
  } catch (e) {
    return { codigo: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}

export async function diagnosticar(): Promise<Chequeo[]> {
  const c: Chequeo[] = [];

  // Docker.
  const docker = await intento("docker", ["ps", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"]);
  if (docker.codigo !== 0) {
    const npipe = /dockerDesktopLinuxEngine|npipe/.test(docker.stderr);
    c.push({
      nombre: "Docker", ok: false, detalle: docker.stderr.trim().split("\n")[0] ?? "docker no responde",
      arreglo: npipe ? "Abre Docker Desktop en Windows y espera a que diga «Engine running»." : "Verifica que Docker Desktop esté instalado y con la integración WSL activa.",
    });
  } else {
    c.push({ nombre: "Docker", ok: true, detalle: "responde" });
    const filas = new Map(docker.stdout.trim().split("\n").filter(Boolean).map((l) => {
      const [n, estado, status] = l.split("\t");
      return [n!, { estado, status }];
    }));
    for (const n of CONTENEDORES_MPT) {
      const f = filas.get(n);
      c.push({
        nombre: `Contenedor ${n}`, ok: f?.estado === "running", detalle: f ? `${f.estado} (${f.status})` : "no existe o está detenido",
        arreglo: f?.estado === "running" ? undefined : "cd ~/dev/MoneyPrinterTurbo && docker compose up -d   (nunca `down -v` ni `prune`)",
      });
    }
    const farol = [...filas.keys()].filter((n) => n.startsWith("supabase_") || n === "farol-dev-redis");
    c.push({ nombre: "Contenedores de Farol", ok: true, aviso: true, detalle: `${farol.length} corriendo; Geeper no los toca` });
  }

  // API de MPT.
  const api = await apiViva();
  c.push({
    nombre: `API de MPT (${MPT_API})`, ok: api, detalle: api ? "responde" : "no responde",
    arreglo: api ? undefined : "docker restart moneyprinterturbo-api   y revisa `docker logs --tail 50 moneyprinterturbo-api`",
  });

  // Hyperframes.
  const hf = await intento("npx", ["--yes", `hyperframes@${HYPERFRAMES_VERSION}`, "--version"], 120_000);
  const vhf = hf.stdout.trim().split("\n").pop() ?? "";
  c.push({
    nombre: `Hyperframes ${HYPERFRAMES_VERSION}`, ok: hf.codigo === 0 && vhf.includes(HYPERFRAMES_VERSION), detalle: vhf || hf.stderr.slice(0, 200),
    arreglo: hf.codigo === 0 ? undefined : `npx --yes hyperframes@${HYPERFRAMES_VERSION} browser ensure   (necesita internet la primera vez)`,
  });
  // PhotoCraft (portadas): opcional, sólo avisa.
  const pc = await versionPhotocraft();
  c.push({
    nombre: `PhotoCraft ${PHOTOCRAFT_VERSION} (portadas)`, ok: !!pc?.includes(PHOTOCRAFT_VERSION), aviso: !pc?.includes(PHOTOCRAFT_VERSION),
    detalle: pc ?? `no está ${PHOTOCRAFT_CLI}`,
    arreglo: pc?.includes(PHOTOCRAFT_VERSION) ? undefined : "Botón «Instalar con un clic» aquí abajo (o a mano: docs/PHOTOCRAFT.md §3). Sin ella no hay portadas ni looks de color.",
  });
  // VectorCraft (logos .ai/.pdf/.eps → SVG, vectorizar): opcional, sólo avisa.
  const vc = await versionVectorcraft();
  c.push({
    nombre: `VectorCraft ${VECTORCRAFT_VERSION} (logos vectoriales)`, ok: !!vc?.includes(VECTORCRAFT_VERSION), aviso: !vc?.includes(VECTORCRAFT_VERSION),
    detalle: vc ?? `no está ${VECTORCRAFT_CLI}`,
    arreglo: vc?.includes(VECTORCRAFT_VERSION) ? undefined : "Botón «Instalar con un clic» aquí abajo. Sin ella, los logos se suben como SVG o PNG (no .ai, .pdf ni .eps).",
  });
  const whisper = await existe(`${process.env.HOME}/.cache/hyperframes/whisper/models/ggml-medium.bin`);
  c.push({
    nombre: "whisper medium (Hyperframes)", ok: whisper, detalle: whisper ? "modelo en caché" : "falta el modelo",
    arreglo: whisper ? undefined : "Se descarga solo en el primer `hyperframes transcribe --model medium` (~1,5 GB).",
  });

  // Clips de material largo (opcional): venv con OpenCV + yt-dlp y el modelo YuNet verificado.
  const ping = await intento(PYTHON_CLIPS, ["-I", "-c", "import cv2, numpy, yt_dlp; print(yt_dlp.version.__version__)"]);
  const yuNet = ping.codigo === 0
    ? await correr(PYTHON_CLIPS, ["-I", path.join(RAIZ_REPO, "py", "reencuadre.py")], { entrada: '{"op":"ping"}', permitirFallo: true }).catch(() => null)
    : null;
  const yuOk = Boolean(yuNet && /"ok": true/.test(yuNet.stdout));
  c.push({
    nombre: "Clips: OpenCV, yt-dlp y YuNet", ok: ping.codigo === 0 && yuOk, aviso: true,
    detalle: ping.codigo !== 0 ? `falta el venv ${PYTHON_CLIPS}` : yuOk ? `yt-dlp ${ping.stdout.trim()} (actualízalo cada semana), modelo YuNet verificado` : (yuNet?.stdout || "falta el modelo YuNet").slice(0, 200),
    arreglo: ping.codigo !== 0
      ? 'uv venv ~/dev/video-tools/venvs/geeper-clips && uv pip install --python ~/dev/video-tools/venvs/geeper-clips/bin/python "numpy>=1.26,<3" "opencv-python-headless>=4.9,<5" "yt-dlp[default]>=2026.10"'
      : yuOk ? undefined
      // URL fijada a un commit y sha256 comprobado (MODELOS.md, «Formatos y descargas»).
      : `mkdir -p ~/.cache/geeper/modelos && curl -L -o ~/.cache/geeper/modelos/${YUNET.archivo} ${YUNET.url} && echo "${YUNET.sha256}  ~/.cache/geeper/modelos/${YUNET.archivo}" | sha256sum -c`,
  });

  // ffmpeg con NVENC.
  const ff = await intento(FFMPEG, ["-hide_banner", "-encoders"]);
  const nvenc = /h264_nvenc/.test(ff.stdout);
  c.push({
    nombre: `ffmpeg (${FFMPEG})`, ok: ff.codigo === 0 && nvenc, detalle: ff.codigo !== 0 ? "no se pudo ejecutar" : nvenc ? "con h264_nvenc" : "sin h264_nvenc",
    arreglo: ff.codigo === 0 && nvenc ? undefined : "Ver «Instalación» en ~/dev/video-tools/ESTUDIO.md (ffmpeg de Ubuntu extraído en ~/.local).",
  });

  // venv del estudio.
  const venv = PYTHON_VOZ;
  const py = await intento(venv, ["-c", "import torch, kokoro_onnx; print(torch.__version__, torch.cuda.is_available())"], 60_000);
  c.push({
    nombre: "venv del estudio (Kokoro para regenerar voz)", ok: py.codigo === 0,
    detalle: py.codigo === 0 ? `kokoro-onnx ok, torch ${py.stdout.trim()}` : "no responde: regenerar la voz no funcionará",
    arreglo: py.codigo === 0 ? undefined : "source ~/dev/video-tools/estudio.sh  (ver ESTUDIO.md)",
  });

  // Reencuadre por cara: OpenCV con FaceDetectorYN (YuNet se descarga solo, 232 KB).
  const cv = await intento(PYTHON_CARAS, ["-I", "-c", "import cv2; cv2.FaceDetectorYN; print(cv2.__version__)"], 30_000);
  c.push({
    nombre: "OpenCV para el reencuadre por cara", ok: cv.codigo === 0, aviso: cv.codigo !== 0,
    detalle: cv.codigo === 0 ? `opencv ${cv.stdout.trim()} (${PYTHON_CARAS})` : `no responde: los clips se encuadran como antes (${PYTHON_CARAS})`,
    arreglo: cv.codigo === 0 ? undefined : "uv pip install --python ~/dev/video-tools/venvs/geeper-clips/bin/python opencv-python-headless  (o GEEPER_CARAS_PYTHON=<python con cv2>)",
  });

  // GPU y VRAM.
  const smi = await intento("nvidia-smi", ["--query-gpu=name,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"]);
  if (smi.codigo === 0) {
    const [nombre, usada, total, temp] = smi.stdout.trim().split(",").map((s) => s.trim());
    const libre = Number(total) - Number(usada);
    c.push({
      nombre: "GPU", ok: true, aviso: libre < 6000, detalle: `${nombre}: ${libre} MiB libres de ${total} (${temp} °C)`,
      arreglo: libre < 6000 ? "Poca VRAM libre: cierra apps con aceleración por hardware en Windows (ver ESTUDIO.md)." : undefined,
    });
  } else c.push({ nombre: "GPU", ok: false, detalle: "nvidia-smi no responde", arreglo: "Revisa el driver de NVIDIA en Windows (WSL usa el de Windows)." });

  // gpu-lock.
  const bin = await existe(GPU_LOCK_BIN);
  let dueno = "";
  try {
    dueno = (await fs.readFile(`${GPU_LOCK_FILE}.owner`, "utf8")).trim();
  } catch {
    /* libre */
  }
  c.push({
    nombre: "gpu-lock", ok: bin, detalle: !bin ? `falta ${GPU_LOCK_BIN}` : dueno ? `ocupado: ${dueno}` : "libre",
    arreglo: bin ? undefined : "Restaura ~/dev/video-tools/bin/gpu-lock (ver ESTUDIO.md).",
  });

  // Datos.
  const datos = dirDatos();
  try {
    await fs.access(datos, fs.constants.W_OK);
    c.push({ nombre: "Carpeta de datos", ok: true, detalle: datos });
  } catch {
    c.push({ nombre: "Carpeta de datos", ok: false, detalle: `${datos} no existe o no se puede escribir`, arreglo: `mkdir -p ${datos} && pnpm run setup` });
  }
  const py3 = await intento("python3", ["-c", "import sys; sys.path.insert(0, '" + ESTUDIO + "/bin'); import mpt_acabado; print('ok')"]);
  c.push({
    nombre: "mpt_acabado.py (alineación)", ok: py3.stdout.includes("ok"), detalle: py3.stdout.includes("ok") ? "se importa" : py3.stderr.slice(0, 200),
    arreglo: py3.stdout.includes("ok") ? undefined : "Restaura ~/dev/video-tools/bin/mpt_acabado.py",
  });

  // Evidencia: SBOM al día, vulnerabilidades conocidas y cambios en las imágenes de MPT (avisos).
  const [sbom, auditoria, imagenes, firma] = await Promise.all([chequeoSbom(), chequeoAuditoria(), chequeoImagenes(), chequeoFirma()]);
  c.push(sbom, auditoria, imagenes, firma);

  c.push(...(await diagnosticarRedes()));
  return c;
}

/** Publicar en redes (PUBLICAR.md §6, §8): credenciales presentes, clave, VPN y cuentas. Nunca muestra secretos. */
async function diagnosticarRedes(): Promise<Chequeo[]> {
  const c: Chequeo[] = [];
  const ruta = rutaRedes();
  let config: ConfigRedes = {};
  try {
    config = leerConfig();
  } catch (e) {
    // Los permisos inseguros se informan abajo, en lenguaje simple y con su arreglo.
    // El mensaje de leerConfig sólo nombra los campos con problema, no sus valores.
    if (!(e instanceof ErrorArchivoPrivado)) {
      c.push({ nombre: "Credenciales de redes", ok: false, detalle: e instanceof Error ? e.message : String(e), arreglo: `Corrige ${ruta} (formato en src/lib/redes/config.ts)` });
    }
  }
  const privados = revisarPrivados();
  const bloquean = privados.some((a) => a.problema);
  for (const id of REDES_IDS) {
    let nombre: string = id;
    try {
      nombre = obtenerRed(id).nombre;
    } catch {
      /* adaptador sin cargar: se usa el id */
    }
    const presente = !!config[id];
    if (bloquean) continue; // no es que falten: están sin proteger (ver abajo)
    c.push({
      nombre: `Credenciales de ${nombre}`, ok: presente, aviso: !presente,
      detalle: presente ? `presentes en ${ruta}` : "faltan: no se pueden conectar cuentas de esta red",
      arreglo: presente ? undefined : `Agrega "${id}" a ${ruta} (chmod 600) y registra el redirect URI ${urlCallback(id)}`,
    });
  }
  for (const a of privados.filter((x) => x.problema)) {
    c.push({
      nombre: a.nombre, ok: false, detalle: `${a.mensaje} (${a.ruta}${a.modo ? `, permisos ${a.modo}` : ""})`,
      arreglo: a.arreglable
        ? `Pulsa «Protegerlos ahora» en Sistema o en Cuentas (o: chmod 600 ${a.ruta})`
        : `Revísalo a mano: debe ser un archivo normal tuyo con permisos 600 (${a.ruta})`,
    });
  }

  const clave = existeClave();
  c.push({
    nombre: "Clave de cifrado de tokens", ok: clave, aviso: !clave,
    detalle: clave ? rutaClave() : `todavía no existe ${rutaClave()}`,
    arreglo: clave ? undefined : "Se crea sola al conectar la primera cuenta (o con `pnpm run setup`).",
  });

  try {
    const ajustes = await leerAjustes();
    // Con el VPN apagado verificarSalida no mide; aquí se mide igual para mostrar la IP de salida.
    const v = ajustes.vpn === "apagado" ? juzgar(ajustes, await salidaActual(true)) : await verificarSalida(true);
    const ok = v.estado === "activo" || v.estado === "apagado";
    c.push({
      nombre: "VPN (salida a las redes)", ok, aviso: v.estado === "sin_dato", detalle: v.detalle,
      arreglo: ok ? undefined
        : v.estado === "sin_dato" ? "Revisa la conexión a internet; si sigue, mide de nuevo en Cuentas."
        : v.estado === "sin_configurar" ? "Configura la IP o el país esperados en Cuentas → Ajustes del VPN."
        : "Enciende el túnel WireGuard en Windows (con «Block untunneled traffic») o corrige la IP o el país esperados en Cuentas.",
    });
  } catch (e) {
    c.push({ nombre: "VPN (salida a las redes)", ok: false, aviso: true, detalle: `no se pudo revisar: ${e instanceof Error ? e.message : String(e)}` });
  }

  try {
    const n = await db.cuenta.count({ where: { estado: "reconectar" } });
    if (n > 0) {
      c.push({ nombre: "Cuentas conectadas", ok: false, aviso: true, detalle: `${n} ${n === 1 ? "cuenta necesita" : "cuentas necesitan"} reconectarse`, arreglo: "Página Cuentas → «Reconectar»." });
    }
  } catch (e) {
    c.push({ nombre: "Cuentas conectadas", ok: false, aviso: true, detalle: `no se pudo leer la base: ${e instanceof Error ? e.message : String(e)}` });
  }
  return c;
}
