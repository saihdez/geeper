import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The CLI is built before tests run (see .github/workflows/shortform-qc.yml),
// so the conflict check is exercised against the real entry point. The check
// runs before any video work, so no ffmpeg or real video file is needed.
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

describe("CLI output-format flags", () => {
  it("rejects --json together with --markdown as a usage error", () => {
    const run = spawnSync(process.execPath, [cli, "fake.mp4", "--json", "--markdown"], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--json and --markdown cannot be used together");
  });
});
