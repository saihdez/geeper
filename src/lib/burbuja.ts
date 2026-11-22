/**
 * Dónde queda la burbuja del presentador cuando va en una esquina de abajo: los subtítulos se corren a su
 * lado (`OpcionesFormato.burbuja`). La esquina «auto» se resuelve igual que en el compilador (con las caras
 * de las escenas), así que el lugar de los subtítulos y el de la burbuja salen de la misma cuenta.
 *
 * Sólo servidor (las zonas de caras salen de caras-zonas.ts).
 */
import { zonasDelVideo } from "./caras-zonas";
import { pistasLibres, type Proyecto } from "./esquema";
import { metricas, type Caja, type OpcionesFormato } from "./formatos";
import { cajaMarco } from "./marco";
import { resolverMarco } from "./marco-auto";

/** La caja de la burbuja si va abajo (en píxeles del cuadro); si va arriba o no hay, nada. */
export function burbujaAbajo(p: Pick<Proyecto, "formato" | "plataformas" | "pistas" | "assets" | "escenas">, o: OpcionesFormato): Caja | undefined {
  const marco = pistasLibres(p).flatMap((pi) => pi.clips).find((c) => c.marco)?.marco;
  if (!marco) return undefined;
  const m = metricas(p.formato, { plataformas: o.plataformas });
  const r = resolverMarco(marco, m, marco.esquina === "auto" ? zonasDelVideo(p as Proyecto, m.W, m.H) : []);
  return r.esquina.startsWith("abajo") ? cajaMarco(r, m) : undefined;
}
