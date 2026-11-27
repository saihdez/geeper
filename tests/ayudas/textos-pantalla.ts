/**
 * Los textos que se ven en una pantalla .tsx, sacados del código sin pintarla: el texto entre etiquetas
 * JSX y las cadenas con espacios que no son listas de clases. Sirve para buscar jerga (A11-06).
 */
const CLASES = /^[a-z0-9:/\-[\].%!#()_=,>+&*]+$/;
const esClases = (s: string) => s.trim().split(/\s+/).every((t) => CLASES.test(t) && /[-:]/.test(t)) || /^(boton|tarjeta|campo|etiqueta|opcion)\b/.test(s.trim());

export function textosDePantalla(fuente: string): string[] {
  const sinComentarios = fuente
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of sinComentarios.matchAll(/>([^<>{}]+)</g)) {
    const t = m[1]!.replace(/\s+/g, " ").trim();
    if (/\p{L}{2}/u.test(t) && !/=>|&&|\|\||===|\w\(|=\{|\w=$|\?\?|\bconst\b|: string\b|: unknown\b|\burl\(/.test(t)) out.push(t);
  }
  // Las cadenas se leen en orden: la de className= se consume entera para no empezar en su comilla final.
  for (const m of sinComentarios.matchAll(/(className=)?(["'`])((?:\\.|(?!\2)[^\\\n])*)\2/g)) {
    if (m[1]) continue;
    const t = m[3]!.replace(/\$\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
    if (!/\s/.test(t) || !/\p{L}{2}/u.test(t) || esClases(t) || /^[/@.]|^https?:|\burl\(/.test(t)) continue;
    out.push(t);
  }
  return out;
}
