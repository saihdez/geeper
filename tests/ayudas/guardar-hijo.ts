/** Proceso hijo para la prueba de guardados a la vez (SEG-04): guarda N veces el mismo proyecto. */
import { guardarProyecto } from "../../src/lib/almacen";
import { proyectoDePrueba } from "../fixtures";

async function main() {
  const [proyectoId, cuantos, quien] = [process.argv[2]!, Number(process.argv[3] ?? 10), process.argv[4] ?? "hijo"];
  const p = proyectoDePrueba();
  let fallos = 0;
  const errores: string[] = [];
  for (let i = 0; i < cuantos; i++) {
    try {
      await guardarProyecto(proyectoId, { ...p, nombre: `${quien} ${i}` }, `${quien} ${i}`);
    } catch (e) {
      fallos++;
      errores.push(e instanceof Error ? e.message.split("\n").slice(-1)[0]! : String(e));
    }
  }
  process.stdout.write(JSON.stringify({ fallos, errores: [...new Set(errores)] }));
  process.exit(0);
}
void main();
