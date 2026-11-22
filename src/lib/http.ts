import { z, ZodError } from "zod";
import { ErrorDeComando } from "./proceso";

// SRV-02: los mensajes de validación, en español (sólo en el servidor: este módulo no llega a la UI).
z.config(z.locales.es());

export function json(datos: unknown, status = 200) {
  return Response.json(datos, { status });
}

/** Rutas absolutas dentro de un mensaje (/home/…, C:\…): a la persona le basta el nombre del archivo. */
const RUTA_ABSOLUTA = /(?<![\w:/.])(?:[A-Za-z]:\\|\/)(?:[^\s"'«»:;,()]+[\\/])+([^\s"'«»:;,()\\/]*)/g;

export function sinRutas(msg: string): string {
  return msg.replace(RUTA_ABSOLUTA, (_m, nombre: string) => (nombre ? `«${nombre}»` : "una carpeta"));
}

function esNoEncontradoDePrisma(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025";
}

function esErrorDePrisma(e: unknown): boolean {
  return e instanceof Error && /^PrismaClient/.test(e.name);
}

/** Traduce un error a lo que ve la persona: qué pasó, sin rutas, comandos ni inglés. */
export function respuestaDeError(e: unknown): { status: number; error: string } {
  if (e instanceof ZodError) return { status: 400, error: e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") };
  if (esNoEncontradoDePrisma(e)) return { status: 404, error: "Ese video ya no existe (quizá se borró). Vuelve a la lista y ábrelo de nuevo." };
  if (e instanceof ErrorDeComando) return { status: 500, error: "Un programa de apoyo falló al hacer este paso. Prueba otra vez; si se repite, el detalle quedó en el registro." };
  if (esErrorDePrisma(e)) return { status: 500, error: "No pude leer o guardar en la base de datos. Prueba otra vez en unos segundos." };
  if (e instanceof Error && e.message.trim()) return { status: 400, error: sinRutas(e.message) };
  return { status: 500, error: "Algo salió mal. Prueba otra vez; si se repite, el detalle quedó en el registro." };
}

/** Convierte errores en respuestas legibles para la UI y deja el error real en el registro del servidor. */
export async function manejar(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const { status, error } = respuestaDeError(e);
    // La validación es un error de quien llama: no ensucia el registro.
    if (!(e instanceof ZodError)) console.error("[api]", e);
    return json({ error }, status);
  }
}
