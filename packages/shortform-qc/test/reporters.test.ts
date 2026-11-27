import { describe, expect, it } from "vitest";
import { toJUnit, toMarkdown } from "../src/reporters.js";
import type { Report } from "../src/types.js";

const report: Report = {
  passed: false,
  file: "final.mp4",
  measuredAt: "2026-11-26T00:00:00.000Z",
  rules: [
    { id: "loudness", name: "Integrated loudness", ok: true, measured: -14.1, target: "-14 ± 1 LUFS" },
    { id: "true-peak", name: "True peak", ok: false, measured: -0.6, target: "≤ -1 dBTP", detail: "Lower the limiter ceiling to -1.5 dBTP & re-export." },
    { id: "licenses", name: "Licenses", ok: false, warning: true, measured: "CC BY-NC 4.0", target: "commercial use allowed" },
  ],
};

describe("toJUnit", () => {
  it("emits one test case per rule and a failure only for failing rules", () => {
    const xml = toJUnit(report);
    expect(xml).toContain('<testsuite name="shortform-qc" tests="3" failures="1">');
    expect(xml.match(/<testcase/g)).toHaveLength(3);
    expect(xml).toContain('<failure message="True peak: -0.6 (target ≤ -1 dBTP)">');
    expect(xml).toContain("Lower the limiter ceiling to -1.5 dBTP &amp; re-export.");
    // A warning never fails the report, so it has no <failure> element.
    expect(xml).not.toContain("Licenses:");
  });

  it("escapes XML special characters", () => {
    const xml = toJUnit({ ...report, rules: [{ id: "x", name: 'A <b> & "c"', ok: false, measured: 1, target: "t" }] });
    expect(xml).toContain('name="A &lt;b&gt; &amp; &quot;c&quot;"');
  });
});

describe("toMarkdown", () => {
  it("renders a table with one row per rule and a fix list for failures", () => {
    const md = toMarkdown(report);
    expect(md).toContain("# shortform-qc: Not ready");
    expect(md).toContain("| True peak | FAIL | `-0.6` | ≤ -1 dBTP |");
    expect(md).toContain("| Licenses | WARN |");
    expect(md).toContain("## What to fix");
    expect(md).toContain("Lower the limiter ceiling");
  });

  it("says ready when every rule passes", () => {
    const md = toMarkdown({ ...report, passed: true, rules: report.rules.map((r) => ({ ...r, ok: true })) });
    expect(md).toContain("# shortform-qc: Ready to publish");
    expect(md).not.toContain("## What to fix");
  });
});
