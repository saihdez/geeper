/**
 * Arranca un proceso hijo de la app de escritorio (el servidor o el worker) y lo apaga en orden cuando la
 * carcasa le cierra la entrada estándar: al salir de Geeper o si la carcasa se cae. Así, en Windows (donde
 * no hay SIGINT entre procesos) el worker marca lo que corría como interrumpido en vez de morir en seco, y
 * en macOS una caída no deja el servidor viejo ocupando el puerto 3300.
 *
 *   node vigia.mjs <script> [args…]
 *
 * Apagar en orden = lo mismo que Ctrl+C: si el script atiende SIGINT, se le avisa y él decide cuándo salir
 * (con 5 s de tope); si no, sale ya.
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

let apagando = false;
function apagar() {
  if (apagando) return;
  apagando = true;
  console.log("--- la app pidió cerrar ---");
  setTimeout(() => process.exit(0), 5000).unref();
  if (process.listenerCount("SIGINT") > 0) process.emit("SIGINT", "SIGINT");
  else process.exit(0);
}
process.stdin.on("end", apagar);
process.stdin.on("close", apagar);
process.stdin.on("error", apagar);
process.stdin.resume();

await import(pathToFileURL(path.resolve(destino)).href);
