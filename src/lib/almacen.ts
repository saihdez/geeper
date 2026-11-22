/** Leer y guardar proyectos: geeper.json en disco + una Version por guardado + índice de assets. */
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { escribirAtomico, sha256Archivo, sha256Texto } from "./archivos";
import { validarProyecto, type Asset, type Proyecto } from "./esquema";
import { probar } from "./media";
import { dirProyecto } from "./rutas";
import { esSvg, revisarSvg } from "./svg";

export function rutaGeeperJson(slug: string): string {
  return path.join(dirProyecto(slug), "geeper.json");
}

export async function crearCarpetas(slug: string): Promise<string> {
  const dir = dirProyecto(slug);
  for (const sub of ["assets", "renders", "manifiestos", "logs", "build"]) {
    await fs.mkdir(path.join(dir, sub), { recursive: true });
  }
  return dir;
}

export async function leerProyecto(slug: string): Promise<Proyecto | null> {
  try {
    return validarProyecto(JSON.parse(await fs.readFile(rutaGeeperJson(slug), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Valida, guarda geeper.json (atómico) y crea la Version siguiente. Devuelve el número.
 *
 * La transacción empieza ESCRIBIENDO (SEG-04): en SQLite con WAL, una que empieza leyendo y después
 * escribe falla al instante si otro proceso escribió entretanto, aunque haya busy_timeout. Empezando por
 * el `update`, la base espera su turno. El geeper.json se escribe dentro, con la base tomada: así el
 * archivo y `versionActual` quedan en el mismo orden aunque la web y el worker guarden a la vez.
 */
export async function guardarProyecto(proyectoId: string, datos: Proyecto, nota: string): Promise<number> {
  const p = validarProyecto(datos);
  return conReintentos(() =>
    db.$transaction(
      async (tx) => {
        const fila = await tx.proyecto.update({
          where: { id: proyectoId },
          data: { versionActual: { increment: 1 }, formato: p.formato, plantilla: p.plantilla, nombre: p.nombre },
          select: { slug: true, versionActual: true },
        });
        return cerrarGuardado(tx, proyectoId, fila, p, nota);
      },
      // La espera por la base (busy_timeout, 10 s) tiene que caber en la transacción.
      { maxWait: 30_000, timeout: 30_000 },
    ),
  );
}

/**
 * Guarda aplicando un cambio sobre la versión que hay AHORA, no sobre una copia leída antes (SEG-05).
 * Para los trabajos largos (animar, presentador, voz nueva): leen al empezar, generan durante minutos y,
 * si guardaran esa copia, borrarían lo que la persona editó mientras tanto. Con esto, al terminar se
 * relee geeper.json con la base ya tomada y `aplicar` pone encima sólo lo generado (como `efectoGenerar`).
 * Si `aplicar` lanza (la escena ya no existe, cambió su texto), no se guarda nada.
 */
export async function guardarEncima(proyectoId: string, nota: string, aplicar: (actual: Proyecto) => Proyecto): Promise<number> {
  return conReintentos(() =>
    db.$transaction(
      async (tx) => {
        // Empieza escribiendo (SEG-04): desde aquí nadie más guarda hasta que esto termine.
        const fila = await tx.proyecto.update({
          where: { id: proyectoId },
          data: { versionActual: { increment: 1 } },
          select: { slug: true, versionActual: true },
        });
        const actual = await leerProyecto(fila.slug);
        if (!actual) throw new Error("El proyecto ya no tiene geeper.json: no hay sobre qué guardar.");
        const p = validarProyecto(aplicar(structuredClone(actual)));
        await tx.proyecto.update({ where: { id: proyectoId }, data: { formato: p.formato, plantilla: p.plantilla, nombre: p.nombre } });
        return cerrarGuardado(tx, proyectoId, fila, p, nota);
      },
      { maxWait: 30_000, timeout: 30_000 },
    ),
  );
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Número de versión, fila Version y geeper.json (con la base tomada por la transacción). */
async function cerrarGuardado(tx: Tx, proyectoId: string, fila: { slug: string; versionActual: number }, p: Proyecto, nota: string): Promise<number> {
  const json = JSON.stringify(p, null, 2) + "\n";
  let n = fila.versionActual;
  // Por si la tabla tiene una versión más alta que versionActual (datos viejos): nunca repetir número.
  const ultima = await tx.version.findFirst({ where: { proyectoId }, orderBy: { numero: "desc" }, select: { numero: true } });
  if (ultima && ultima.numero >= n) {
    n = ultima.numero + 1;
    await tx.proyecto.update({ where: { id: proyectoId }, data: { versionActual: n } });
  }
  await tx.version.create({ data: { proyectoId, numero: n, nota, hash: sha256Texto(json), json } });
  await escribirAtomico(rutaGeeperJson(fila.slug), json);
  return n;
}

/** ¿La base respondió ocupada o venció la espera? Entonces vale la pena reintentar. */
export function esOcupada(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message} ${String((e as { code?: unknown }).code ?? "")}` : String(e);
  return /SQLITE_BUSY|database is locked|timed out|P2028|P1008|SocketTimeout/i.test(m);
}

/** Reintenta 2 veces (con una pausa corta) si la base está ocupada. */
export async function conReintentos<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= intentos || !esOcupada(e)) throw e;
      await new Promise((r) => setTimeout(r, 150 * i + Math.random() * 150));
    }
  }
}

/**
 * Índice de assets en la tabla Asset: APAGADO (SRV-03). Nadie lee esa tabla y su clave (`id` global)
 * mezclaba proyectos: `clip-01` o `musica` de un proyecto le quitaba la fila al anterior. Cada guardado
 * hacía de 2 a 10 escrituras sueltas para nada. Se deja la función para no tocar a quienes la llaman.
 * Si algún día la usa la biblioteca de assets (docs/BRECHAS.md), cambiar antes la clave a proyecto + id
 * y escribir todo en una sola transacción.
 */
export async function registrarAssetsEnDb(proyectoId: string, p: Proyecto): Promise<void> {
  void proyectoId;
  void p;
}

/** Describe un archivo ya copiado dentro del proyecto como Asset de geeper.json. */
export async function describirAsset(
  dirProy: string,
  ruta: string,
  base: Pick<Asset, "id" | "tipo" | "source" | "licencia"> & { regenerar?: Record<string, unknown> },
): Promise<Asset> {
  const abs = path.join(dirProy, ruta);
  // ffprobe no sabe el tamaño de un SVG: sale de su width/height o viewBox (y se revisa que sea seguro).
  const info = esSvg(ruta)
    ? { duracion: undefined, ...revisarSvg(await fs.readFile(abs, "utf8")) }
    : await probar(abs).catch(() => ({ duracion: undefined, ancho: undefined, alto: undefined }));
  return {
    ...base,
    ruta,
    hash: await sha256Archivo(abs),
    duracion: info.duracion || undefined,
    ancho: info.ancho,
    alto: info.alto,
    regenerar: base.regenerar ?? {},
  };
}
