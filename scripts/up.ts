/**
 * pnpm run up — Geeper para usarlo a diario: la web en modo producción (mucho más liviana que `dev:up`)
 * y el worker, en una sola terminal. Ctrl+C apaga los dos.
 *
 * - Si el código cambió desde la última preparación (o no hay ninguna), primero corre `next build`.
 * - La web escucha sólo en 127.0.0.1 (esta PC). Puerto: PORT o 3300.
 * - Si el worker muere solo, se vuelve a lanzar (hasta 5 veces en 10 min), igual que en dev:up.
 *
 * Opciones: `--build` reconstruye siempre; `--sin-build` no reconstruye aunque haya cambios.
 * Para programar sigue estando `pnpm run dev:up` (recarga sola al guardar).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { necesitaBuild, puedeReiniciar, puertoOcupado } from "./arranque";

const raiz = process.cwd();
const puerto = Number(process.env.PORT ?? 3300);
const host = "127.0.0.1";
const args = new Set(process.argv.slice(2));
const conShell = process.platform === "win32";

const hijos: { nombre: string; p: ChildProcess }[] = [];
const reinicios: number[] = [];
let apagando = false;

function lanzar(nombre: string, color: string, cmd: string[]) {
  const p = spawn("pnpm", cmd, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "1" }, shell: conShell });
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
    // Al arrancar, el worker marca «interrumpido» lo que corría; nada de GPU se reintenta solo.
    if (nombre === "worker" && puedeReiniciar(reinicios, Date.now())) {
      process.stdout.write(`${pref}se reinicia en 3 s (${reinicios.length}/5 en 10 min)\n`);
      setTimeout(() => !apagando && lanzar(nombre, color, cmd), 3000);
    } else apagar();
  });
  hijos.push({ nombre, p });
}

function apagar() {
  if (apagando) return;
  apagando = true;
  for (const h of hijos) h.p.kill("SIGINT");
  setTimeout(() => process.exit(0), 6000).unref();
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);

async function main() {
  // Antes de reconstruir: `next build` pisaría el .next de una web que ya esté abierta.
  if (await puertoOcupado(puerto, host)) {
    console.error(`Ya hay algo abierto en el puerto ${puerto} (¿Geeper en otra terminal?). Ciérralo primero o usa otro puerto: PORT=3301 pnpm run up`);
    process.exit(1);
  }
  const b = args.has("--build") ? { si: true, motivo: "lo pediste con --build" } : necesitaBuild(raiz);
  if (b.si && !args.has("--sin-build")) {
    console.log(`Preparando Geeper (${b.motivo}). Tarda alrededor de un minuto…`);
    const r = spawnSync("pnpm", ["exec", "next", "build"], { stdio: "inherit", shell: conShell });
    if (r.status !== 0) {
      console.error("No se pudo preparar la web (next build falló; el error está arriba).");
      process.exit(r.status ?? 1);
    }
  }
  lanzar("web", "36", ["exec", "next", "start", "--port", String(puerto), "--hostname", host]);
  lanzar("worker", "35", ["exec", "tsx", "worker/index.ts"]);
  console.log(`Geeper: http://localhost:${puerto}  (Ctrl+C para apagar web y worker)`);
}

void main();
