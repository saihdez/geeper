/**
 * Arranca un proceso hijo de la app de escritorio (el servidor o el worker) y lo apaga en orden cuando la
 * carcasa le cierra la entrada estándar: al salir de Geeper o si la carcasa se cae. Así, en Windows (donde
 * no hay SIGINT entre procesos) el worker marca lo que corría como interrumpido en vez de morir en seco, y
 * en macOS una caída no deja el servidor viejo ocupando el puerto 3300.
 *
 *   node vigia.mjs <script> [args…]
 *
 * Apagar en orden = lo mismo que Ctrl+C: si el script atiende SIGINT, se le avisa y él decide cuándo salir
 * (con 13 s de tope, uno más que lo que el worker espera a sus trabajos y uno menos que lo que tarda la
 * carcasa en rematarlo: PLAZO_VIGIA_MS en escritorio/reglas.ts); si no, sale ya.
 * GEEPER_VIGIA_TOPE_MS cambia ese tope (sólo lo usan las pruebas).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const destino = process.argv[2];
if (!destino) {
  console.error("vigia: falta el script que hay que arrancar");
  process.exit(2);
}
// El script ve los argumentos como si lo hubieran lanzado directo.
process.argv.splice(1, 2, path.resolve(destino));

const TOPE_MS = Number(process.env.GEEPER_VIGIA_TOPE_MS) || 13_000;

let apagando = false;
function apagar() {
  if (apagando) return;
  apagando = true;
  console.log("--- la app pidió cerrar ---");
  setTimeout(() => process.exit(0), TOPE_MS).unref();
  if (process.listenerCount("SIGINT") > 0) process.emit("SIGINT", "SIGINT");
  else process.exit(0);
}
process.stdin.on("end", apagar);
process.stdin.on("close", apagar);
process.stdin.on("error", apagar);
process.stdin.resume();

await import(pathToFileURL(path.resolve(destino)).href);
