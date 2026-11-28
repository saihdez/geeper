import type { Report, Rule } from "./types.js";

/** XML-escape text for JUnit output. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape a pipe so it cannot break a Markdown table cell. */
function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatMeasured(rule: Rule): string {
  return typeof rule.measured === "object" ? JSON.stringify(rule.measured) : String(rule.measured);
}

/**
 * Render a JUnit XML report: one test case per rule, so CI can show each rule
 * as its own test. Failing rules get a <failure> element; warnings pass (they
 * never fail the report, and JUnit has no warning state).
 */
export function toJUnit(report: Report): string {
  const failures = report.rules.filter((r) => !r.ok && !r.warning).length;
  const cases = report.rules.map((r) => {
    const name = xmlEscape(r.name);
    if (!r.ok && !r.warning) {
      const message = xmlEscape(`${r.name}: ${formatMeasured(r)} (target ${r.target})`);
      const body = xmlEscape(r.detail ?? "");
      return `    <testcase classname="shortform-qc" name="${name}">\n      <failure message="${message}">${body}</failure>\n    </testcase>`;
    }
    return `    <testcase classname="shortform-qc" name="${name}" />`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="shortform-qc" tests="${report.rules.length}" failures="${failures}">\n${cases.join("\n")}\n  </testsuite>\n</testsuites>\n`;
}

/**
 * Render a Markdown summary for PR comments / $GITHUB_STEP_SUMMARY: a verdict,
 * one table row per rule, and the fix hints for the failing rules.
 */
export function toMarkdown(report: Report): string {
  const lines = [
    `# shortform-qc: ${report.passed ? "Ready to publish" : "Not ready"}`,
    "",
    `File: \`${report.file}\``,
    "",
    "| Rule | Result | Measured | Target |",
    "|---|---|---|---|",
  ];
  for (const r of report.rules) {
    const result = r.ok ? "PASS" : r.warning ? "WARN" : "FAIL";
    lines.push(`| ${mdEscape(r.name)} | ${result} | \`${mdEscape(formatMeasured(r))}\` | ${mdEscape(r.target)} |`);
  }
  const failed = report.rules.filter((r) => !r.ok && !r.warning && r.detail);
  if (failed.length) {
    lines.push("", "## What to fix", "");
    // Indent continuation lines so a multi-line detail stays inside its
    // bullet instead of breaking the Markdown list.
    for (const r of failed) lines.push(`- **${r.name}**: ${(r.detail ?? "").split("\n").join("\n  ")}`);
  }
  return lines.join("\n") + "\n";
}
