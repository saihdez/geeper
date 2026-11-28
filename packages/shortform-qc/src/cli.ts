#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkVideo } from "./index.js";
import { parseSrt } from "./subtitles.js";
import { toJUnit, toMarkdown } from "./reporters.js";
import type { Expectations, Format, Platform, Report } from "./types.js";

const HELP = `Usage: shortform-qc <video> [options]

Checks a rendered short-form video before you publish it: loudness (-14 LUFS, true peak <= -1 dBTP),
Rec.709 color tags, resolution, frame rate, duration, dropped/duplicated/frozen frames and,
if you pass an .srt, subtitle line length and reading speed.

Options:
  --format <9:16|16:9|1:1>    expected canvas (sets the resolution check)
  --fps <n>                   expected frame rate (default 30)
  --duration <seconds>        expected duration (enables duration and frame-count checks)
  --srt <file>                subtitles to check (max 42 chars/line, 2 lines, 17 chars/s)
  --platform <list>           comma-separated: tiktok,youtube,instagram,facebook,snapchat,pinterest
  --outro-start <seconds>     stop freeze/duplicate checks here (static end card)
  --no-rec709                 skip the color check
  --json                      print the full report as JSON (cannot be combined with --markdown)
  --junit <file>              write the report as JUnit XML (one test case per rule)
  --markdown                  print the report as Markdown (for PR comments / $GITHUB_STEP_SUMMARY; cannot be combined with --json)
  -h, --help                  show this help

Exit code: 0 when every rule passes (warnings allowed), 1 when one fails, 2 on usage errors.
Uses ffmpeg/ffprobe from PATH, or the FFMPEG / FFPROBE environment variables.`;

const FORMATS = new Set(["9:16", "16:9", "1:1"]);
const PLATFORMS = new Set(["tiktok", "youtube", "instagram", "facebook", "snapchat", "pinterest"]);

function fail(msg: string): never {
  process.stderr.write(`shortform-qc: ${msg}\n`);
  process.exit(2);
}

function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
  return n;
}

function print(r: Report) {
  for (const rule of r.rules) {
    const mark = rule.ok ? "PASS" : rule.warning ? "WARN" : "FAIL";
    const measured = typeof rule.measured === "object" ? JSON.stringify(rule.measured) : String(rule.measured);
    process.stdout.write(`${mark}  ${rule.name}: ${measured} (target ${rule.target})\n`);
    if (!rule.ok && rule.detail) process.stdout.write(rule.detail.replace(/^/gm, "      ") + "\n");
  }
  process.stdout.write(r.passed ? "\nReady to publish.\n" : "\nNot ready: fix the FAIL lines above.\n");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: "string" },
      fps: { type: "string" },
      duration: { type: "string" },
      srt: { type: "string" },
      platform: { type: "string" },
      "outro-start": { type: "string" },
      "no-rec709": { type: "boolean" },
      json: { type: "boolean" },
      junit: { type: "string" },
      markdown: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  const file = positionals[0];
  if (!file || positionals.length > 1) fail("expected exactly one video file (see --help)");
  if (values.format && !FORMATS.has(values.format)) fail(`unknown --format ${values.format}`);
  const platforms = values.platform?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  for (const p of platforms) if (!PLATFORMS.has(p)) fail(`unknown platform ${p}`);
  // --json and --markdown both choose the stdout format; silently preferring
  // one would hide the other, so reject the combination as a usage error
  // before any video work starts.
  if (values.json && values.markdown) fail("--json and --markdown cannot be used together");

  const exp: Expectations = {
    format: values.format as Format | undefined,
    fps: num(values.fps, "fps"),
    duration: num(values.duration, "duration"),
    platforms: platforms as Platform[],
    outroStart: num(values["outro-start"], "outro-start"),
    requireRec709: !values["no-rec709"],
    subtitles: values.srt ? parseSrt(await readFile(values.srt, "utf8")) : undefined,
  };
  const report = await checkVideo(file, exp);
  if (values.junit) await writeFile(values.junit, toJUnit(report), "utf8");
  if (values.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else if (values.markdown) process.stdout.write(toMarkdown(report));
  else print(report);
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
