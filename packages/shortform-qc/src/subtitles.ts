import type { Cue, Targets } from "./types.js";

const TIME = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;

function seconds(t: string): number {
  const m = TIME.exec(t);
  if (!m) throw new Error(`invalid SRT timestamp: ${t}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, "0")) / 1000;
}

/** Parses SRT (or WebVTT cue blocks). Cues keep their line breaks. */
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i]!.split("-->");
    const body = lines.slice(i + 1).join("\n").trim();
    if (!body) continue;
    cues.push({ start: seconds(a!.trim()), end: seconds(b!.trim().split(/\s+/)[0]!), text: body });
  }
  return cues;
}

/** Counts code points, so accented letters and emoji count as one character. */
export function charCount(s: string): number {
  return [...s].length;
}

/**
 * Strips WebVTT/SRT formatting tags (`<i>`, `<font ...>`, `<c.class>`,
 * `{\\an8}` ...) so they don't count as characters. Only tag-like
 * sequences and `{\...}` override blocks are stripped, so plain text
 * like `3 < 5` or `{name}` still counts. Only the counting ignores the
 * tags; the cue text itself is unchanged.
 */
export function stripFormatting(s: string): string {
  return s
    .replace(/<\/?(?:[a-z][\w.-]*(?:\s[^<>]*)?|\d{1,2}:\d{2}(?::\d{2})?\.\d{3})>/gi, "")
    .replace(/\{\\[^}]*\}/g, "");
}

export interface CueProblem {
  cue: Cue;
  lines: number;
  longestLine: number;
  cps: number;
  /** Too many lines or a line too long (as opposed to only too fast). */
  shape: boolean;
  speed: boolean;
}

export function reviewCues(cues: readonly Cue[], t: Targets) {
  let worstLine = 0;
  let worstLines = 0;
  let worstCps = 0;
  const problems: CueProblem[] = [];
  for (const cue of cues) {
    const lines = cue.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const counted = lines.map(stripFormatting);
    const longestLine = Math.max(0, ...counted.map(charCount));
    const dur = cue.end - cue.start;
    const cps = dur > 0 ? charCount(counted.join(" ")) / dur : Infinity;
    worstLine = Math.max(worstLine, longestLine);
    worstLines = Math.max(worstLines, lines.length);
    worstCps = Math.max(worstCps, cps);
    const shape = longestLine > t.maxCharsPerLine || lines.length > t.maxLines;
    const speed = cps > t.maxCps;
    if (shape || speed) problems.push({ cue, lines: lines.length, longestLine, cps, shape, speed });
  }
  return { worstLine, worstLines, worstCps: Number(worstCps.toFixed(2)), problems, cues: cues.length };
}

export function describeProblem(p: CueProblem): string {
  const text = p.cue.text.replace(/\n/g, " / ");
  return `"${text}" at ${p.cue.start.toFixed(2)} s: ${p.lines} lines, ${p.longestLine} chars/line, ${p.cps.toFixed(1)} chars/s`;
}
