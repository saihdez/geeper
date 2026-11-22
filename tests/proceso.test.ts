import { describe, expect, it } from "vitest";
import { correr } from "@/lib/proceso";

describe.skipIf(process.platform === "win32")("correr", () => {
  it("un comando que no lee su entrada no tumba el proceso con EPIPE (WRK-08)", async () => {
    const r = await correr("sh", ["-c", "exit 0"], { entrada: "x".repeat(8_000_000) });
    expect(r.codigo).toBe(0);
  });
});
