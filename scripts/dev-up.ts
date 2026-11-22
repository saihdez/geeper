/** pnpm run dev:up — la web (:3300) y el worker en una sola terminal. Ctrl+C apaga los dos. */
import { spawn, type ChildProcess } from "node:child_process";

const hijos: { nombre: string; color: string; p: ChildProcess }[] = [];

function lanzar(nombre: string, color: string, args: string[]) {
  const p = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" } });
  const pref = `\x1b[${color}m[${nombre}]\x1b[0m `;
  for (const s of [p.stdout, p.stderr]) {
    let resto = "";
    s?.on("data", (d: Buffer) => {
      resto += d.toString();
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const l of lineas) process.stdout.write(pref + l + "\n");
    });
  }
  p.on("exit", (c, senal) => {
    process.stdout.write(`${pref}terminó (${c ?? senal ?? "?"})\n`);
    if (apagando) return;
    // Si el worker muere solo, se vuelve a lanzar (al arrancar marca «interrumpido» lo que corría;
    // nada de GPU se reintenta solo). Si muere la web, se apaga todo.
    const ahora = Date.now();
    reinicios.splice(0, reinicios.length, ...reinicios.filter((t) => ahora - t < 10 * 60_000));
    if (nombre === "worker" && reinicios.length < 5) {
      reinicios.push(ahora);
      process.stdout.write(`${pref}se reinicia en 3 s (${reinicios.length}/5 en 10 min)\n`);
      setTimeout(() => !apagando && lanzar(nombre, color, args), 3000);
    } else apagar();
  });
  hijos.push({ nombre, color, p });
}

const reinicios: number[] = [];

let apagando = false;
function apagar() {
  if (apagando) return;
  apagando = true;
  for (const h of hijos) h.p.kill("SIGINT");
  setTimeout(() => process.exit(0), 6000).unref();
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

lanzar("web", "36", ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3300"]);
lanzar("worker", "35", ["exec", "tsx", "worker/index.ts"]);
console.log("Geeper: http://localhost:3300  (Ctrl+C para apagar web y worker)");
