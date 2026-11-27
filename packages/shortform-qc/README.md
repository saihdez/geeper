# shortform-qc

[![npm](https://img.shields.io/npm/v/shortform-qc)](https://www.npmjs.com/package/shortform-qc) [![CI](https://github.com/saihdez/geeper/actions/workflows/shortform-qc.yml/badge.svg)](https://github.com/saihdez/geeper/actions/workflows/shortform-qc.yml) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Pre-publish quality checks for short-form video (Shorts, Reels, TikTok). Point it at a rendered file
and it tells you, rule by rule, whether it's ready to publish and what to fix if it isn't.

```
$ npx shortform-qc final.mp4 --format 9:16 --duration 57 --srt final.srt --platform tiktok,youtube
PASS  Integrated loudness: -14.1 (target -14 ± 1 LUFS)
FAIL  True peak: -0.6 (target ≤ -1 dBTP)
PASS  Rec.709, limited range: {...}
PASS  Resolution: 1080x1920 (target 1080x1920)
PASS  Frame rate: 30/1 (target 30 fps)
PASS  Duration (video and audio): {"video":57,"audio":57.01} (target 57.000 s; ...)
PASS  Frame count (dropped or extra): 1710 (target 1710 ± 2)
PASS  Duplicated frames and freezes: {"ratio":0.03,"freezes":[]} (...)
FAIL  Readable subtitles: {"worstCharsPerLine":48,...}
      "this line is much too long for a phone screen" at 12.40 s: 1 lines, 48 chars/line, 15.2 chars/s

Not ready: fix the FAIL lines above.
```

It is the QC gate of [Geeper](https://github.com/saihdez/geeper), a local video studio, extracted so
any pipeline (ffmpeg scripts, Remotion, HyperFrames, MoneyPrinterTurbo, an editor export) can use it.

## What it checks

| Rule | Default target | Why |
|---|---|---|
| Integrated loudness | −14 ± 1 LUFS | What YouTube, TikTok and Instagram normalize to; quieter videos sound weak next to others |
| True peak | ≤ −1 dBTP | AAC encoding overshoots; above −1 dBTP it clips on phones |
| Color | Rec.709, limited (`tv`) range, yuv420p | Untagged files get guessed and look washed out or crushed |
| Resolution / frame rate | from `--format` / `--fps` | Catches a wrong export preset |
| Duration and A/V sync | expected ± 2 frames; audio within 0.15 s | Truncated renders and drifting audio |
| Frame count | expected ± 2 | Dropped or duplicated frames from a broken render |
| Duplicates and freezes | ≤ 10 % duplicated, no still ≥ 1 s | Stalled renders (stops at `--outro-start` so a static end card is fine) |
| Subtitles | ≤ 42 chars/line, ≤ 2 lines, ≤ 17 chars/s | Common broadcast caption limits; unreadable captions lose viewers |
| Safe zone | inside the platform UI-free area | Text under TikTok's buttons or the Shorts caption is invisible |
| Licenses | every asset allows commercial use | Warns by default; fails when the project is commercial |

Rules whose inputs you don't give are skipped, not guessed. Measurements use ffmpeg's `loudnorm`
(EBU R128), `ffprobe`, `freezedetect` and `mpdecimate`, on the CPU.

## Install

Needs Node 20+ and ffmpeg/ffprobe on `PATH` (or set `FFMPEG` / `FFPROBE`).

```bash
npm install shortform-qc     # library
npx shortform-qc --help      # CLI
```

Exit codes: `0` ready (warnings allowed), `1` a rule failed, `2` usage error. Use `--json` in CI, `--junit report.xml` for a JUnit report (one test case per rule), or `--markdown` for a summary to post as a PR comment or to `$GITHUB_STEP_SUMMARY`.

## Library

```ts
import { checkVideo, evaluate, measure, parseSrt } from "shortform-qc";
import { readFile } from "node:fs/promises";

const report = await checkVideo("final.mp4", {
  format: "9:16",
  duration: 57,
  platforms: ["tiktok", "youtube"],
  subtitles: parseSrt(await readFile("final.srt", "utf8")),
  boxes: [{ name: "title", x: 130, y: 300, w: 700, h: 200 }],
  assets: [{ name: "music.mp3", license: "CC-BY-4.0" }],
  commercial: true,
  outroStart: 54,
});
if (!report.passed) console.table(report.rules.filter((r) => !r.ok));
```

`measure()` and `evaluate()` are separate, so you can measure once and evaluate against several
targets, or evaluate numbers you got elsewhere without running ffmpeg. Override any default with
`targets`, e.g. `{ targets: { lufs: -16, maxCps: 20 } }`.

Helpers: `safeZone(format, platforms)`, `platformZone()`, `parseSrt()`, `reviewCues()`,
`commercialUse(licenseText)`.

## Credits

Platform UI margins for 9:16 adapted from [vincentsch/explainroo](https://github.com/vincentsch/explainroo)
(MIT); Snapchat Spotlight and Pinterest margins come from the platforms' published specs and
template measurements (sources in `src/safe-zones.ts`).

## License

Apache-2.0
