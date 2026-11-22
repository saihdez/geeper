/** Proceso hijo para pruebas de concurrencia (SEG-04): toma la base escribiendo, avisa «listo», espera y suelta. */
import Database from "better-sqlite3";

const [ruta, ms] = [process.argv[2]!, Number(process.argv[3] ?? 500)];
const con = new Database(ruta);
con.pragma("busy_timeout = 10000");
con.exec("BEGIN IMMEDIATE");
con.prepare(`INSERT OR REPLACE INTO "Sistema" ("clave", "valor", "actualizado") VALUES ('prueba.otro', ?, ?)`).run(new Date().toISOString(), Date.now());
process.stdout.write("listo\n");
setTimeout(() => {
  con.exec("COMMIT");
  con.close();
  process.exit(0);
}, ms);
