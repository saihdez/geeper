/** Avnac Studio en Media: qué archivo se baja en cada sistema y qué falta en Linux para abrirlo. */
import { describe, expect, it } from "vitest";
import { AVNAC, archivoAvnac, comandoLibrerias, libreriasQueFaltan } from "@/lib/avnac";

describe("archivo de Avnac por sistema", () => {
  it("Linux, Windows y las dos Mac tienen su archivo con la suma fijada", () => {
    expect(archivoAvnac("linux", "x64").nombre).toBe("avnac-studio-linux-amd64");
    expect(archivoAvnac("windows", "x64").nombre).toMatch(/installer\.exe$/);
    expect(archivoAvnac("mac", "arm64").nombre).toBe("avnac-studio-macos-arm64.dmg");
    expect(archivoAvnac("mac", "x64").nombre).toBe("avnac-studio-macos-amd64.dmg");
    for (const a of Object.values(AVNAC.archivos)) expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("librerías que faltan en Linux", () => {
  const ldd = `
\tlinux-vdso.so.1 (0x00007ffd)
\tlibwebkit2gtk-4.1.so.0 => not found
\tlibgtk-3.so.0 => /lib/x86_64-linux-gnu/libgtk-3.so.0 (0x0000)
\tlibjavascriptcoregtk-4.1.so.0 => not found
`;
  it("lee las que dicen «not found» y arma un solo comando", () => {
    const faltan = libreriasQueFaltan(ldd);
    expect(faltan).toEqual(["libwebkit2gtk-4.1.so.0", "libjavascriptcoregtk-4.1.so.0"]);
    expect(comandoLibrerias(faltan)).toBe("sudo apt install -y libwebkit2gtk-4.1-0");
  });
  it("sin faltantes no hay comando", () => {
    expect(comandoLibrerias(libreriasQueFaltan("\tlibgtk-3.so.0 => /lib/libgtk-3.so.0 (0x1)"))).toBeNull();
  });
});
