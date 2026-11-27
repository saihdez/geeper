/** GPU-06: rehacer la voz no promete «No usa la GPU»: con una voz diseñada espera su turno en la tarjeta. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const leer = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", "components", f), "utf8");

describe("textos de rehacer la voz (GPU-06)", () => {
  it.each(["editor-proyecto.tsx", "acciones-proyecto.ts"])("%s avisa que la voz diseñada espera la tarjeta de video", (f) => {
    const s = leer(f);
    expect(s).not.toMatch(/No usa la GPU\./);
    expect(s).not.toMatch(/Kokoro y whisper en CPU/);
    expect(s).toContain("Con una voz diseñada espera su turno en la tarjeta de video.");
  });
});
