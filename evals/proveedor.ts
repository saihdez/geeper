/**
 * Proveedor `exec:` de Promptfoo: arma el prompt real de Geeper con las variables del caso y lo pide al
 * modelo local por `pedirJson` (la misma vía que la app: esquema en `format`, gpu-lock, keep_alive 0).
 *
 *   npx tsx proveedor.ts <modelo> <suite> <prompt> [opciones] [contexto]   (lo llama Promptfoo desde evals/)
 *
 * Promptfoo pasa el prompt, las opciones y el contexto (con las `vars` del caso). Con las `vars` se arma
 * el prompt real de Geeper. Suites: ganchos, titulos, anuncios, director y juez (para `llm-rubric`: ahí
 * el prompt de Promptfoo va tal cual).
 * Con GEEPER_EVALS_FALSO=1 responde sin modelo (para probar la tubería sin GPU).
 */
import { z } from "zod";
import { construirPrompt, RespuestaLlm as RespuestaIdeas } from "../src/lib/anuncios/ideas";
import { DatosCampana } from "../src/lib/anuncios/esquema";
import { Director, promptDirector } from "../src/lib/director";
import { promptGanchos, RespuestaGanchos } from "../src/lib/ganchos";
import { pedirJson } from "../src/lib/llm-local";
import { promptTitulos, RespuestaTitulos } from "../src/lib/titulos";

const Juicio = z.object({ reason: z.string(), pass: z.boolean(), score: z.number().min(0).max(1) });

type Vars = Record<string, unknown>;
const s = (v: unknown, d = "") => (typeof v === "string" ? v : d);

function pedido(suite: string, crudo: string, v: Vars): { esquema: z.ZodType; prompt: string; sistema?: string; temperatura?: number } {
  if (suite === "juez") return { esquema: Juicio, prompt: crudo, temperatura: 0 };
  switch (suite) {
    case "ganchos":
      return { esquema: RespuestaGanchos, prompt: promptGanchos({ texto: s(v.texto), canal: s(v.canal) || null, idioma: s(v.idioma, "es"), react: v.react === true }) };
    case "titulos":
      return { esquema: RespuestaTitulos, prompt: promptTitulos({ tema: s(v.tema), guion: s(v.guion), formato: s(v.formato, "9:16") }) };
    case "anuncios": {
      const datos = DatosCampana.parse({ brief: { marca: s(v.marca), producto: s(v.producto), audiencia: s(v.audiencia), oferta: s(v.oferta), afirmaciones: ((v.afirmaciones as string[] | undefined) ?? []).map((texto, i) => ({ id: `a${i + 1}`, texto, aprobada: true })) } });
      const { sistema, usuario } = construirPrompt(datos);
      return { esquema: RespuestaIdeas, prompt: usuario, sistema, temperatura: 0.8 };
    }
    case "director":
      return { esquema: Director, prompt: promptDirector({ tema: s(v.tema), duracion: Number(v.duracion ?? 30), formato: s(v.formato, "9:16") }), temperatura: 0.6 };
    default:
      throw new Error(`Suite desconocida: ${suite}`);
  }
}

const FALSOS: Record<string, unknown> = {
  ganchos: { ganchos: ["Nadie sube estos escalones por gusto", "Cuando el GPS falla, queda esto", "Así se apaga un faro"], titulo: "El último farero" },
  titulos: { titulos: ["Faros que siguen encendidos", "¿Para qué sirve hoy un faro?", "La noche más larga del farero"] },
  juez: { reason: "falso", pass: true, score: 1 },
};

async function main() {
  const [modelo, suite, crudo, , contexto] = process.argv.slice(2);
  if (!modelo || !suite || crudo === undefined) throw new Error("Uso: <modelo> <suite> <prompt> [opciones] [contexto]");
  const vars = contexto ? ((JSON.parse(contexto) as { vars?: Vars }).vars ?? {}) : {};
  const p = pedido(suite, crudo, vars);
  if (process.env.GEEPER_EVALS_FALSO === "1") {
    process.stdout.write(JSON.stringify(FALSOS[suite] ?? {}));
    return;
  }
  const r = await pedirJson(modelo, p.prompt, p.esquema, { tarea: `evals ${suite}`, sistema: p.sistema, temperatura: p.temperatura, esperarGpu: true, timeoutMs: 300_000 });
  process.stdout.write(JSON.stringify(r.datos));
}

main().catch((e) => {
  process.stderr.write(e instanceof Error ? `${e.message}${"detalle" in e ? ` (${String((e as { detalle: unknown }).detalle)})` : ""}` : String(e));
  process.exit(1);
});
