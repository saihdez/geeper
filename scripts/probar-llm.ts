/**
 * Prueba cada esquema de salida del modelo local contra Ollama de verdad (A3 de docs/STACK-AGENTICO.md):
 * ¿el esquema entra en la gramática y lo que sale pasa Zod? Usa la GPU (toma gpu-lock y espera).
 *
 *   pnpm tsx scripts/probar-llm.ts [modelo]      (por defecto gemma4:12b)
 *
 * Imprime una tabla Markdown para anotar en docs/DECISIONES.md.
 */
import { z } from "zod";
import { RespuestaLlm as RespuestaIdeas } from "../src/lib/anuncios/ideas";
import { Director } from "../src/lib/director";
import { promptGanchos, RespuestaGanchos } from "../src/lib/ganchos";
import { ErrorLlm, pedirJson } from "../src/lib/llm-local";
import { promptTitulos, RespuestaTitulos } from "../src/lib/titulos";

const modelo = process.argv[2] ?? "gemma4:12b";
const texto = "Los faros de la costa siguen encendidos aunque los barcos ya usan GPS. Un farero cuenta que en invierno sube 120 escalones cada noche.";

const casos: { nombre: string; esquema: z.ZodType; prompt: string }[] = [
  { nombre: "ganchos", esquema: RespuestaGanchos, prompt: promptGanchos({ texto, canal: null, idioma: "es", react: false }) },
  { nombre: "titulos", esquema: RespuestaTitulos, prompt: promptTitulos({ tema: "faros", guion: texto, formato: "9:16" }) },
  {
    nombre: "ideas-anuncio",
    esquema: RespuestaIdeas,
    prompt: "Propón 2 conceptos de anuncio en español para una app de mareas. Cada uno con nombre, gancho y guion de 3 frases. Sin cifras inventadas.",
  },
  {
    nombre: "director",
    esquema: Director,
    prompt: `Eres director de videos cortos. Propón un storyboard de 30 s en 9:16 sobre este tema, con 4 escenas (ids e01…e04), narración en español, plano pedido y marcas de ritmo (índice de palabra dentro de la narración).\nTema: ${texto}`,
  },
];

async function main() {
  console.log(`| Esquema | Con esquema en format | Sólo json | Tiempo | Tokens salida |\n|---|---|---|---|---|`);
  for (const c of casos) {
    const fila: string[] = [c.nombre];
    let tiempo = "";
    let tokens = "";
    for (const formato of ["esquema", "json"] as const) {
      try {
        const r = await pedirJson(modelo, c.prompt, c.esquema, { tarea: `probar-llm ${c.nombre}`, esperarGpu: true, formato, temperatura: 0.4 });
        fila.push("pasa Zod");
        if (formato === "esquema") {
          tiempo = `${(r.duracionMs / 1000).toFixed(1)} s`;
          tokens = String(r.tokensSalida ?? "?");
        }
      } catch (e) {
        fila.push(e instanceof ErrorLlm ? `${e.causa}: ${e.detalle.slice(0, 80)}` : String(e).slice(0, 80));
      }
    }
    console.log(`| ${[...fila, tiempo, tokens].join(" | ")} |`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
