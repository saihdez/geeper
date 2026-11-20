/**
 * Servidor MCP de Geeper por stdio. Lo registra `.mcp.json` (`npx tsx mcp/servidor.ts`).
 * Las herramientas están en src/lib/mcp.ts. Nada se escribe en stdout fuera del protocolo.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { crearServidor } from "../src/lib/mcp";

const conexion = serveStdio(crearServidor);

const cerrar = () => {
  void conexion.close().finally(() => process.exit(0));
};
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
