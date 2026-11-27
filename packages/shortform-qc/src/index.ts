import { evaluate } from "./evaluate.js";
import { measure, type Tools } from "./measure.js";
import type { Expectations, Report } from "./types.js";

export * from "./types.js";
export { DEFAULT_TARGETS, resolveTargets } from "./targets.js";
export { CANVAS, PLATFORM_UI_9X16, inside, intersect, platformZone, safeZone } from "./safe-zones.js";
export { charCount, parseSrt, reviewCues } from "./subtitles.js";
export { commercialUse, type CommercialUse } from "./licenses.js";
export { evaluate, parseRate } from "./evaluate.js";
export { toJUnit, toMarkdown } from "./reporters.js";
export { countFrames, detectFreezes, duplicateRatio, measure, measureLoudness, parseFreezes, probe, type MeasureOptions, type Tools } from "./measure.js";

/** Measures a rendered video with ffmpeg and checks it against the expectations. */
export async function checkVideo(file: string, expectations: Expectations = {}, tools: Tools = {}): Promise<Report> {
  const m = await measure(file, { ...tools, fps: expectations.fps, outroStart: expectations.outroStart });
  return evaluate(m, expectations, file);
}
