/**
 * Render de entrega de una versión: mezcla → compilar → hyperframes check → render → loudnorm
 * (corrige) → QC (mide). Cada tramo es un paso con manifiesto: si se corta, al relanzar se saltan
 * los terminados.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sha256Archivo } from "./archivos";
import { db } from "./db";
import { compilar, escribirProyectoHf, VERSION_COMPILADOR } from "./compilador";
import { conColor, prepararColor } from "./looks";
import { ampliaciones } from "./nitidez";
import { resumirConfianza } from "./confianza";
import { pistasLibres, validarProyecto, type Proyecto } from "./esquema";
import { metricas } from "./formatos";
import { tomarGpu } from "./gpu";
import { aSrt, duracionEscenas, escenasEnLinea, opcionesDe } from "./linea";
import { huellaFfmpeg, probar } from "./media";
import { mezclar } from "./mezcla";
import { paso, pasoQueEnvuelve, type Contexto } from "./pasos";
import { entradasCaptura } from "./render-entradas";
import { obtenerPlantilla } from "./plantillas";
import { cortesDe, medirRitmo, type Ritmo } from "./pulsos";
import { asegurarPicoReal, correrQc, duplicadosEsperados, ENTREGA, normalizarAudio, TOPES_PICO, type InformeQc } from "./qc";
import { HYPERFRAMES_VERSION, dirProyecto } from "./rutas";
import { correrHf } from "./hyperframes";
import { banderasRender, hayNvidia, renderConRespaldo } from "./render-gpu";
import { SISTEMA } from "./plataforma";
import { origenClip, reglaClip } from "./clips";

const ENV_HF = { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" };

/** Cortes en pulso según los marcadores de pulso (ya en tiempo de la línea final); null sin pulsos. */
export function ritmoDe(p: Proyecto): Ritmo | null {
  const pulsos = p.marcadores.filter((m) => m.tipo === "pulso").map((m) => m.tiempo).sort((a, b) => a - b);
  if (!pulsos.length) return null;
  return medirRitmo(cortesDe(p), pulsos, 0);
}

export interface ResultadoRender {
  renderId: string;
  ruta: string;
  aprobado: boolean;
  gpu: boolean;
  segundos: number;
}

interface ResumenCheck {
  ok: boolean;
  errores: number;
  avisos: number;
  resumen: string;
}

function contarHallazgos(v: unknown, acc: { errores: string[]; avisos: number }) {
  if (Array.isArray(v)) v.forEach((x) => contarHallazgos(x, acc));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.severity === "error") acc.errores.push(`${String(o.code ?? "")}: ${String(o.message ?? "")}`.slice(0, 300));
    else if (o.severity === "warning") acc.avisos++;
    Object.values(o).forEach((x) => contarHallazgos(x, acc));
  }
}

export async function versionDeProyecto(proyectoId: string, numero?: number): Promise<{ numero: number; p: Proyecto }> {
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const n = numero ?? fila.versionActual;
  const v = await db.version.findUniqueOrThrow({ where: { proyectoId_numero: { proyectoId, numero: n } } });
  return { numero: n, p: validarProyecto(JSON.parse(v.json)) };
}

export async function renderEntregar(
  ctx: Contexto & { etapa: (e: string, progreso: number) => Promise<void>; signal?: AbortSignal },
  proyectoId: string,
  trabajoId: string,
  numeroVersion?: number,
): Promise<ResultadoRender> {
  const t0 = Date.now();
  const fila = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const dir = dirProyecto(fila.slug);
  const { numero, p } = await versionDeProyecto(proyectoId, numeroVersion);
  const plantilla = await obtenerPlantilla(p.plantilla);
  const m = metricas(p.formato, opcionesDe(p));
  const huella = `${await huellaFfmpeg()}|hyperframes@${HYPERFRAMES_VERSION}|${VERSION_COMPILADOR}`;
  const total = duracionEscenas(p) + plantilla.datos.tarjetaFinal.duracion;
  const assetsUsados = [...new Set(p.pistas.flatMap((x) => x.clips.map((c) => c.asset)))];
  const archivosAssets = assetsUsados.map((id) => path.join(dir, p.assets[id]!.ruta));

  // 1. Mezcla de audio.
  await ctx.etapa("Mezclando audio", 0.05);
  const rutaMezcla = path.join(dir, "build", "mezcla.wav");
  const musica = p.pistas.find((x) => x.id === "musica");
  await paso(
    ctx,
    "audio.mezcla",
    {
      archivos: archivosAssets.filter((a) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(a)),
      params: {
        // Lo que suena de cada escena (ya sin los recortes de la edición por texto).
        voz: escenasEnLinea(p).map((e) => ({ asset: e.voz.asset, tramos: e.tramos.map((t) => [t.inicio, t.fin]) })),
        efectos: pistasLibres(p).filter((x) => x.tipo === "audio"),
        musica: musica ?? null,
        total,
        ducking: plantilla.datos.musica.ducking,
      },
      motor: `${huella}|mezcla-v2`,
    },
    [rutaMezcla],
    async ([tmp]) => {
      await mezclar(p, dir, total, plantilla.datos.musica.ducking, tmp!, ctx.log);
      return { total };
    },
  );

  // 2. Compilar a Hyperframes (siempre: es barato y determinista).
  await ctx.etapa("Compilando a Hyperframes", 0.1);
  // El look de color del canal y la mejora automática se hornean en copias de los clips (src/lib/looks.ts).
  if (conColor(plantilla.datos.color)) await ctx.etapa("Aplicando el color del canal", 0.12);
  const sustitutos = await prepararColor(p, dir, plantilla.datos.color, ctx.log);
  const comp = compilar(p, plantilla.datos, rutaMezcla, dir, sustitutos);
  const dirBuild = path.join(dir, "build", `hf-${p.formato.replace(":", "x")}`);
  await escribirProyectoHf(dirBuild, comp);
  const indexHtml = path.join(dirBuild, "index.html");
  const fuera = comp.cajas.filter((c) => !c.dentro);
  if (fuera.length) ctx.log(`Aviso: fuera de la banda segura: ${fuera.map((c) => c.nombre).join(", ")}`);

  // 3 a 5. check + render + entrega, envueltos en «entrega.final» (REN-08): volver a una versión que
  // ya se entregó reutiliza su MP4 aunque el crudo se haya sobrescrito con otro render.
  const base = `v${numero}-${m.perfil}`;
  const final = path.join(dir, "renders", `${base}.mp4`);
  const crudo = path.join(dir, "build", `crudo-${m.perfil}.mp4`);
  const archivosComp = [indexHtml, ...Object.values(comp.archivos)];
  const { resultado: entregado } = await pasoQueEnvuelve(
    ctx,
    "entrega.final",
    {
      archivos: archivosComp,
      params: { formato: p.formato, perfil: m.perfil, calidad: "delivery", fps: p.fps, lufs: -14, tp: -2, entrega: ENTREGA, pico: TOPES_PICO },
      motor: `${huella}|entrega-final-v1`,
    },
    final,
    async () => {
      const check = await revisarHf(ctx, dir, dirBuild, p.formato, archivosComp, huella);
      const gpu = await renderCrudo(ctx, fila.slug, dirBuild, crudo, p.fps, entradasCaptura(archivosComp, rutaMezcla), huella);
      // 5. Entrega: loudnorm en dos pasadas y, en la misma pasada, la codificación liviana del video (ENTREGA).
      // El sonido sale de la mezcla en WAV, no del crudo (REN-07).
      await ctx.etapa("Normalizando sonoridad", 0.8);
      await paso(ctx, "entrega.loudnorm", { archivos: [crudo, rutaMezcla], params: { lufs: -14, tp: -2, entrega: ENTREGA, fps: p.fps, pico: TOPES_PICO, audio: "mezcla" }, motor: huella }, [final], async ([tmp]) => {
        const medido = await normalizarAudio(crudo, tmp!, ctx.log, p.fps, rutaMezcla);
        // El AAC sube el pico real: si pasa de −1 dBTP, limitador a 192 kHz y otra vez (hasta 4).
        const pico = await asegurarPicoReal(tmp!, ctx.log);
        return { antes: medido, pico };
      });
      return { check, gpu };
    },
  );
  const { check, gpu } = entregado;

  // 5 bis. Máster de archivo (si el proyecto lo pide): el mismo proyecto Hyperframes en MOV, calidad alta.
  let master: string | undefined;
  if (p.entrega.master) {
    await ctx.etapa("Máster de archivo", 0.85);
    master = path.join(dir, "renders", `${base}-master.mov`);
    await paso(
      ctx,
      "hyperframes.master",
      { archivos: [indexHtml, ...Object.values(comp.archivos)], params: { formato: "mov", calidad: "high", fps: p.fps }, motor: huella },
      [master],
      async ([tmp]) => {
        // Sin GPU: el máster nunca compite con una generación ni la espera.
        const salida = `${tmp!}.mov`;
        const b = banderasRender(false, SISTEMA);
        await correrHf(["render", "--output", salida, "--format", "mov", "--quality", "high", "--fps", String(p.fps), "--quiet", ...b.args], {
          cwd: dirBuild, env: { ...ENV_HF, ...b.env }, log: ctx.log, signal: ctx.signal, timeout: 60 * 60_000,
        });
        await fs.rename(salida, tmp!);
        const info = await probar(tmp!);
        ctx.log(`máster: ${info.video?.codec_name ?? "?"} ${info.video?.pix_fmt ?? ""}`);
        return { codec: info.video?.codec_name ?? null };
      },
    );
  }

  // 6. QC (mide el archivo entregado).
  await ctx.etapa("Control de calidad", 0.9);
  const momentos = [
    ...escenasEnLinea(p).map((e) => ({ t: e.inicio + e.duracion / 2, nota: `Escena ${e.indice + 1}` })),
    { t: comp.inicioTarjeta + Math.min(1.2, plantilla.datos.tarjetaFinal.duracion - 0.3), nota: "Tarjeta final" },
  ];
  const informe: InformeQc = await correrQc(
    final,
    {
      formato: p.formato,
      fps: p.fps,
      plataformas: p.plataformas,
      total: comp.total,
      inicioTarjeta: comp.inicioTarjeta,
      grupos: comp.grupos,
      cajas: comp.cajas,
      momentos,
      licencias: assetsUsados.map((id) => ({ asset: id, licencia: p.assets[id]!.licencia })),
      comercial: p.comercial,
      confianza: resumirConfianza(escenasEnLinea(p).map((e) => ({ id: e.escena.id, palabras: e.escena.palabras }))),
      ritmo: ritmoDe(p),
      ampliaciones: ampliaciones(p, m.W, m.H),
      check,
      extras: [reglaClip(p, comp.inicioTarjeta)].filter((r) => r !== null),
      ritmoSubtitulosAviso: origenClip(p) !== null,
      duplicadosAviso: origenClip(p) !== null,
      duplicadosEsperados: await repetidosDelMaterial(p, dir),
    },
    path.join(dir, "renders", `${base}-hoja`),
    ctx.log,
  );
  await fs.writeFile(path.join(dir, "renders", `${base}.srt`), aSrt(comp.grupos, comp.inicioTarjeta));
  const rel = (x: string) => path.relative(dir, x);
  const informeRel = {
    ...informe,
    archivo: rel(informe.archivo),
    hojaContacto: informe.hojaContacto && rel(informe.hojaContacto),
    fotogramas: informe.fotogramas.map((f) => ({ ...f, ruta: rel(f.ruta) })),
    master: master && rel(master),
  };
  await fs.writeFile(path.join(dir, "renders", `${base}.qc.json`), JSON.stringify(informeRel, null, 2));
  for (const r of informe.reglas) ctx.log(`QC ${r.ok ? "✓" : r.aviso ? "!" : "✗"} ${r.nombre}: ${JSON.stringify(r.medido).slice(0, 160)}`);

  const segundos = (Date.now() - t0) / 1000;
  const render = await db.render.create({
    data: {
      proyectoId,
      versionNumero: numero,
      perfil: m.perfil,
      ruta: rel(final),
      estado: informe.aprobado ? "aprobado" : "rechazado",
      informeQc: informeRel as object,
      // Se publica sólo si el MP4 sigue siendo el que aprobó el QC (PUBLICAR.md §9).
      hash: informe.aprobado ? await sha256Archivo(final) : null,
      duracion: comp.total,
      segundos,
      trabajoId,
    },
  });
  await db.proyecto.update({ where: { id: proyectoId }, data: { estado: informe.aprobado ? "entregado" : "qc" } });
  ctx.log(`Render ${informe.aprobado ? "APROBADO" : "RECHAZADO por QC"}: ${final} (${segundos.toFixed(1)} s)`);
  return { renderId: render.id, ruta: final, aprobado: informe.aprobado, gpu, segundos };
}

type CtxRender = Contexto & { etapa: (e: string, progreso: number) => Promise<void>; signal?: AbortSignal };

/** 3. hyperframes check; lanza si encuentra errores. */
async function revisarHf(ctx: CtxRender, dir: string, dirBuild: string, formato: string, archivos: string[], huella: string): Promise<ResumenCheck> {
  await ctx.etapa("hyperframes check", 0.15);
  const rutaCheck = path.join(dir, "build", `check-${formato.replace(":", "x")}.json`);
  const { resultado: check } = await paso<ResumenCheck>(
    ctx,
    "hyperframes.check",
    { archivos, params: { formato }, motor: huella },
    [rutaCheck],
    async ([tmp]) => {
      const r = await correrHf(["check", "--json", "--no-cache", "--no-craft"], {
        cwd: dirBuild, env: ENV_HF, permitirFallo: true, signal: ctx.signal, timeout: 15 * 60_000,
      });
      await fs.writeFile(tmp!, r.stdout || "{}");
      let j: { ok?: boolean } = {};
      try {
        j = JSON.parse(r.stdout) as { ok?: boolean };
      } catch {
        /* salida no JSON */
      }
      const acc = { errores: [] as string[], avisos: 0 };
      contarHallazgos(j, acc);
      const res = { ok: j.ok === true, errores: acc.errores.length, avisos: acc.avisos, resumen: acc.errores.slice(0, 5).join("\n") };
      ctx.log(`check: ${res.ok ? "ok" : "con problemas"}, ${res.errores} errores, ${res.avisos} avisos`);
      return res;
    },
  );
  if (check.errores > 0) throw new Error(`hyperframes check encontró ${check.errores} errores:\n${check.resumen}`);
  return check;
}

/** 4. Render del crudo (NVENC si la GPU está libre; si no, CPU para no esperar). Devuelve si usó la GPU. */
async function renderCrudo(ctx: CtxRender, slug: string, dirBuild: string, crudo: string, fps: number, archivos: string[], huella: string): Promise<boolean> {
  await ctx.etapa("Renderizando", 0.2);
  const rr = await paso(
    ctx,
    "hyperframes.render",
    { archivos, params: { calidad: "delivery", fps, audio: "aparte" }, motor: huella },
    [crudo],
    async ([tmp]) => {
      // NVENC sólo con NVIDIA: en macOS el render va por CPU (VideoToolbox queda para cuando se pruebe en un Mac).
      // Con GEEPER_RENDER_DETECTAR_NVIDIA=1 (REN-03) tampoco se pide en un equipo sin NVIDIA (render-gpu.ts).
      const nvidia = await hayNvidia(SISTEMA);
      const candado = !nvidia ? null : await tomarGpu(`render ${slug}`, { esperar: false, signal: ctx.signal });
      let gpu = candado !== null;
      ctx.log(gpu ? "GPU libre: render con NVENC (gpu-lock tomado)" : SISTEMA === "mac" ? "macOS: render con CPU (libx264)" : !nvidia ? "Sin tarjeta NVIDIA: render con CPU (libx264)" : "GPU ocupada: render con CPU (libx264), sin esperar");
      try {
        gpu = await renderConRespaldo(gpu, async (conGpu) => {
          const b = banderasRender(conGpu, SISTEMA);
          const args = ["render", "--output", tmp!, "--quality", "delivery", "--fps", String(fps), "--quiet", ...b.args];
          await correrHf(args, { cwd: dirBuild, env: { ...ENV_HF, ...b.env }, log: ctx.log, signal: ctx.signal, timeout: 60 * 60_000 });
        }, ctx.log, process.env, ctx.signal);
      } finally {
        candado?.liberar();
      }
      return { gpu };
    },
  );
  return rr.resultado.gpu;
}

/** Fotogramas repetidos que ya trae el material (fuentes de pocos fps, imágenes fijas): ver `duplicadosEsperados`. */
async function repetidosDelMaterial(p: Proyecto, dir: string): Promise<number> {
  const fpsDe = new Map<string, number | undefined>();
  const escenas = [];
  for (const e of escenasEnLinea(p)) {
    const a = p.assets[e.visual.asset];
    if (!a) continue;
    if (a.tipo === "imagen") {
      escenas.push({ dur: e.duracion, fija: !e.visual.movimiento });
      continue;
    }
    if (!fpsDe.has(a.id)) {
      const info = await probar(path.join(dir, a.ruta)).catch(() => null);
      const prom = info?.video?.avg_frame_rate?.split("/").map(Number);
      const avg = prom && prom[1] ? prom[0]! / prom[1] : undefined;
      fpsDe.set(a.id, [info?.fps, avg].filter((x): x is number => !!x && Number.isFinite(x)).reduce<number | undefined>((m, x) => (m === undefined ? x : Math.min(m, x)), undefined));
    }
    escenas.push({ dur: e.duracion, fpsFuente: fpsDe.get(a.id) });
  }
  return duplicadosEsperados(escenas, p.fps);
}
