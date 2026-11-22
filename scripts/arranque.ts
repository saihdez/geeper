/** Piezas puras de `pnpm run up` (scripts/up.ts), aparte para poder probarlas sin lanzar nada. */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** Lo que, si cambia, obliga a reconstruir la web. El worker corre con tsx y no hace falta. */
export const ENTRADAS_BUILD = ["src", "public", "prisma/schema.prisma", "next.config.ts", "package.json", "pnpm-lock.yaml", "postcss.config.mjs", "tsconfig.json"];

/** Fecha de modificación más nueva dentro de `ruta` (archivo o carpeta), 0 si no existe. */
export function masNuevo(ruta: string): number {
  let st: fs.Stats;
  try {
    st = fs.statSync(ruta);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const e of fs.readdirSync(ruta, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".next")) continue;
    max = Math.max(max, masNuevo(path.join(ruta, e.name)));
  }
  return max;
}

/** ¿Hace falta `next build`? Sí si no hay build o si algo de ENTRADAS_BUILD es más nuevo que él. */
export function necesitaBuild(raiz: string): { si: boolean; motivo: string } {
  let build: number;
  try {
    build = fs.statSync(path.join(raiz, ".next", "BUILD_ID")).mtimeMs;
  } catch {
    return { si: true, motivo: "todavía no hay una versión preparada" };
  }
  for (const e of ENTRADAS_BUILD) {
    if (masNuevo(path.join(raiz, e)) > build) return { si: true, motivo: `cambió ${e} desde la última vez` };
  }
  return { si: false, motivo: "la versión preparada está al día" };
}

/** ¿Hay algo escuchando ya en ese puerto? (otra copia de Geeper, o `next dev`). */
export function puertoOcupado(puerto: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(true));
    s.once("listening", () => s.close(() => ok(false)));
    s.listen(puerto, host);
  });
}

/** Reinicios del worker: como mucho `max` en `ventanaMs`; devuelve si se puede reiniciar otra vez. */
export function puedeReiniciar(reinicios: number[], ahora: number, max = 5, ventanaMs = 10 * 60_000): boolean {
  const recientes = reinicios.filter((t) => ahora - t < ventanaMs);
  reinicios.splice(0, reinicios.length, ...recientes);
  if (recientes.length >= max) return false;
  reinicios.push(ahora);
  return true;
}
