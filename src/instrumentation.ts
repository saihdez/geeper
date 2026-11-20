/**
 * Next.js llama a `register()` una vez al arrancar el servidor. Prepara las trazas de la web (las
 * llamadas al modelo local desde la UI: ganchos, títulos, ideas). Ver src/lib/trazas.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { iniciarTrazas } = await import("./lib/trazas");
  iniciarTrazas("geeper-web");
}
