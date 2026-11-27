import { describe, expect, it } from "vitest";
import { commercialUse, evaluate, parseFreezes, parseRate, parseSrt, platformZone, reviewCues, safeZone, DEFAULT_TARGETS, type Measurements } from "../src/index.js";

const good: Measurements = {
  loudness: { integrated: -14.2, truePeak: -1.4, lra: 6 },
  video: {
    width: 1080, height: 1920, frameRate: "30/1", duration: 10,
    colorSpace: "bt709", colorTransfer: "bt709", colorPrimaries: "bt709", colorRange: "tv", pixFmt: "yuv420p",
  },
  audioDuration: 10.02,
  frameCount: 300,
  freezes: [],
  duplicateRatio: 0.02,
};

const byId = (r: ReturnType<typeof evaluate>, id: string) => r.rules.find((x) => x.id === id);

describe("evaluate", () => {
  it("passes a clean 9:16 delivery", () => {
    const r = evaluate(good, { format: "9:16", duration: 10 });
    expect(r.rules.map((x) => [x.id, x.ok])).toEqual([
      ["loudness", true], ["true-peak", true], ["color", true], ["resolution", true],
      ["fps", true], ["duration", true], ["frames", true], ["duplicates", true],
    ]);
    expect(r.passed).toBe(true);
  });

  it("fails loud audio and a hot true peak", () => {
    const r = evaluate({ ...good, loudness: { integrated: -9, truePeak: -0.2, lra: 4 } });
    expect(byId(r, "loudness")?.ok).toBe(false);
    expect(byId(r, "true-peak")?.ok).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("fails untagged color and explains how to fix it", () => {
    const r = evaluate({ ...good, video: { ...good.video!, colorSpace: undefined } });
    expect(byId(r, "color")?.ok).toBe(false);
    expect(byId(r, "color")?.detail).toMatch(/-colorspace bt709/);
    expect(byId(evaluate(good, { requireRec709: false }), "color")).toBeUndefined();
  });

  it("accepts NTSC rates numerically", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(byId(evaluate({ ...good, video: { ...good.video!, frameRate: "30000/1001" } }, { fps: 29.97 }), "fps")?.ok).toBe(true);
  });

  it("skips rules it has no inputs for", () => {
    const r = evaluate(good);
    expect(byId(r, "resolution")).toBeUndefined();
    expect(byId(r, "duration")).toBeUndefined();
    expect(byId(r, "subtitles")).toBeUndefined();
  });

  it("fails dropped frames and long freezes", () => {
    const r = evaluate({ ...good, frameCount: 290, freezes: [{ start: 3, duration: 1.4 }] }, { duration: 10 });
    expect(byId(r, "frames")?.ok).toBe(false);
    expect(byId(r, "duplicates")?.ok).toBe(false);
  });

  it("adds the source's own duplicates to the allowance", () => {
    const m = { ...good, duplicateRatio: 0.45 };
    expect(byId(evaluate(m), "duplicates")?.ok).toBe(false);
    expect(byId(evaluate(m, { expectedDuplicates: 0.5 }), "duplicates")?.ok).toBe(true);
  });

  it("flags text outside the platform safe zone", () => {
    // TikTok covers the left 11 % (119 px) and the right 20 % (from 864 px).
    const boxes = [{ name: "title", x: 130, y: 300, w: 700, h: 200 }, { name: "logo", x: 900, y: 1700, w: 150, h: 150 }];
    const r = evaluate(good, { format: "9:16", platforms: ["tiktok"], boxes });
    expect(byId(r, "safe-zone")?.ok).toBe(false);
    expect(byId(r, "safe-zone")?.detail).toBe("logo");
  });

  it("licenses warn by default and fail for commercial projects", () => {
    const assets = [{ name: "music.mp3", license: "CC BY-NC 4.0" }, { name: "voice", license: "Apache-2.0" }];
    const personal = evaluate(good, { assets });
    expect(byId(personal, "licenses")).toMatchObject({ ok: false, warning: true });
    expect(personal.passed).toBe(true);
    expect(evaluate(good, { assets, commercial: true }).passed).toBe(false);
  });
});

describe("subtitles", () => {
  const srt = `1
00:00:00,000 --> 00:00:02,000
Hello there

2
00:00:02,000 --> 00:00:02,500
This cue is far too fast to read comfortably

3
00:00:03,000 --> 00:00:06,000
one
two
three
`;

  it("parses SRT with CRLF, BOM and multi-line cues", () => {
    const cues = parseSrt("﻿" + srt.replace(/\n/g, "\r\n"));
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start: 0, end: 2, text: "Hello there" });
    expect(cues[2]!.text).toBe("one\ntwo\nthree");
  });

  it("separates shape problems from speed problems", () => {
    const r = reviewCues(parseSrt(srt), DEFAULT_TARGETS);
    expect(r.problems.map((p) => [p.shape, p.speed])).toEqual([[true, true], [true, false]]);
  });

  it("only warns about speed when the voice can't be slowed", () => {
    const cues = parseSrt("1\n00:00:00,000 --> 00:00:01,000\nA quick line of thirty chars\n");
    const r = evaluate(good, { subtitles: cues, subtitleSpeedWarnOnly: true });
    expect(byId(r, "subtitles")?.ok).toBe(true);
    expect(byId(r, "subtitle-speed")).toMatchObject({ ok: false, warning: true });
    expect(r.passed).toBe(true);
  });

  it("counts accented characters once", () => {
    const cues = [{ start: 0, end: 1, text: "é".repeat(42) }];
    expect(reviewCues(cues, DEFAULT_TARGETS).worstLine).toBe(42);
  });

  it("ignores WebVTT/SRT formatting tags when counting characters", () => {
    const cues = [
      { start: 0, end: 2, text: "<i>Hello</i>" },
      { start: 0, end: 2, text: "{\\an8}Hello" },
      { start: 0, end: 2, text: "<font color=\"#fff\">Hello</font> <c.red>world</c>" },
    ];
    const r = reviewCues(cues, DEFAULT_TARGETS);
    expect(r.worstLine).toBe(11); // "Hello world" — the tags add no characters
    expect(r.worstCps).toBeCloseTo(5.5, 2); // 11 chars over 2 s
    expect(r.problems).toEqual([]);
  });

  it("keeps plain text with <, > and braces when counting characters", () => {
    // `3 < 5` is not a tag and `{name}` is not an ASS override block.
    const cues = [{ start: 0, end: 2, text: "3 < 5 and {name} said hi" }];
    const r = reviewCues(cues, DEFAULT_TARGETS);
    expect(r.worstLine).toBe(24);
    expect(r.problems).toEqual([]);
  });

  it("does not flag a cue that only exceeds the limits because of its tags", () => {
    // 40 visible characters plus `<i></i>`: 47 raw characters would exceed
    // the 42 chars/line limit, but the tags are not visible text.
    // 3 s keeps it under the 17 chars/s reading-speed limit (40 / 3 ≈ 13.3).
    const cues = [{ start: 0, end: 3, text: "<i>" + "x".repeat(40) + "</i>" }];
    expect(reviewCues(cues, DEFAULT_TARGETS).problems).toEqual([]);
  });
});

describe("safe zones", () => {
  it("narrows 9:16 to what every platform leaves visible", () => {
    expect(safeZone("9:16")).toEqual({ x: 60, y: 168, w: 960, h: 1162 });
    const z = safeZone("9:16", ["tiktok", "youtube"]);
    expect(z.x).toBe(119); // TikTok's left 11 %
    expect(z.y).toBe(288); // YouTube's top 15 %
    expect(z.x + z.w).toBeLessThanOrEqual(1080 * 0.8);
  });

  it("adds Snapchat Spotlight and Pinterest zones", () => {
    // Snapchat: 150px top / 360px bottom, 65px left / 162px right on 1080x1920.
    const snap = platformZone("snapchat");
    expect(snap.x).toBeCloseTo(64.8, 2);
    expect(snap.y).toBeCloseTo(149.76, 2);
    expect(snap.w).toBeCloseTo(853.2, 2);
    expect(snap.h).toBeCloseTo(1409.28, 2);
    // Pinterest (organic video Pins): 270px top / 790px bottom, 65px left / 195px right.
    const pin = platformZone("pinterest");
    expect(pin.x).toBeCloseTo(64.8, 2);
    expect(pin.y).toBeCloseTo(270.72, 2);
    expect(pin.w).toBeCloseTo(819.72, 2);
    expect(pin.h).toBeCloseTo(860.16, 2);
  });

  it("narrows 9:16 for Snapchat and Pinterest", () => {
    expect(safeZone("9:16", ["snapchat"])).toEqual({ x: 65, y: 168, w: 853, h: 1162 });
    expect(safeZone("9:16", ["pinterest"])).toEqual({ x: 65, y: 271, w: 819, h: 860 });
    expect(safeZone("9:16", ["snapchat", "pinterest"])).toEqual({ x: 65, y: 271, w: 819, h: 860 });
  });

  it("ignores platforms outside 9:16", () => {
    expect(safeZone("16:9", ["tiktok"])).toEqual(safeZone("16:9"));
  });
});

describe("parseFreezes", () => {
  it("pairs each start with its duration and closes a freeze that runs to the end", () => {
    const stderr = [
      "[freezedetect] lavfi.freezedetect.freeze_start: 1.2",
      "[freezedetect] lavfi.freezedetect.freeze_duration: 0.6",
      "[freezedetect] lavfi.freezedetect.freeze_end: 1.8",
      "[freezedetect] lavfi.freezedetect.freeze_start: 7.5",
    ].join("\n");
    expect(parseFreezes(stderr, 10)).toEqual([{ start: 1.2, duration: 0.6 }, { start: 7.5, duration: 2.5 }]);
    expect(parseFreezes("", 10)).toEqual([]);
  });
});

describe("commercialUse", () => {
  it.each([
    ["Apache-2.0", "yes"], ["MIT", "yes"], ["CC-BY-4.0", "yes"], ["OpenRAIL++-M", "yes"],
    ["CC BY-NC 4.0", "no"], ["research only", "no"], ["no comercial", "no"],
    ["unknown", "unknown"], ["Proprietary EULA", "unknown"],
  ])("%s → %s", (license, expected) => {
    expect(commercialUse(license)).toBe(expected);
  });
});
