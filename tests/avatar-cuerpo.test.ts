import { describe, expect, it } from "vitest";
import { AvatarDelVideo, promptHabla } from "@/lib/actuar";

describe("avatar de cuerpo completo que habla como una persona frente a la cámara", () => {
  it("de la cintura para abajo gesticula con las manos; de cuerpo entero, todo el cuerpo; sólo la cara, no", () => {
    expect(promptHabla("medio")).toMatch(/hand gestures/);
    expect(promptHabla("completo")).toMatch(/hand gestures.*whole body visible/);
    expect(promptHabla("cara")).not.toMatch(/hand/);
    expect(promptHabla("completo", "con entusiasmo.")).toMatch(/^con entusiasmo\. The person/);
  });

  it("lo guardado antes (sin «cuerpo») se sigue leyendo, como medio cuerpo", () => {
    expect(AvatarDelVideo.parse({ avatar: "sofia-1" }).cuerpo).toBe("medio");
  });
});
