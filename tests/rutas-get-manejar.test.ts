/** SRV-02 (ronda 2): los GET de proyecto, trabajos, log y Sistema devuelven un error legible si algo falla. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const errorPrisma = () => Object.assign(new Error("database is locked"), { name: "PrismaClientKnownRequestError" });
const falla = { activa: true };

vi.mock("@/lib/db", () => {
  const tirar = () => (falla.activa ? Promise.reject(errorPrisma()) : Promise.resolve(null));
  return { db: { trabajo: { findMany: tirar, findUnique: tirar }, sistema: { findUnique: tirar } } };
});
vi.mock("@/lib/vista", () => ({ vistaProyecto: () => (falla.activa ? Promise.reject(errorPrisma()) : Promise.resolve(null)) }));
vi.mock("@/lib/doctor", () => ({ diagnosticar: () => Promise.reject(new Error("falló en /home/alguien/geeper-data/x.json")) }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  falla.activa = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET con manejar() (SRV-02)", () => {
  it("/api/proyectos/[id]: error de base → 500 legible; sin proyecto → 404 en palabras simples", async () => {
    const { GET } = await import("@/app/api/proyectos/[id]/route");
    const r = await GET(new Request("http://x/api/proyectos/p1"), ctx("p1"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: expect.stringMatching(/base de datos/) });
    falla.activa = false;
    const n = await GET(new Request("http://x/api/proyectos/p1"), ctx("p1"));
    expect(n.status).toBe(404);
    expect((await n.json()).error).toMatch(/ya no existe/);
  });

  it("/api/trabajos y su log: error de base → 500 legible", async () => {
    const lista = await (await import("@/app/api/trabajos/route")).GET(new Request("http://x/api/trabajos"));
    expect(lista.status).toBe(500);
    expect((await lista.json()).error).toMatch(/base de datos/);
    const log = await (await import("@/app/api/trabajos/[id]/log/route")).GET(new Request("http://x/api/trabajos/t1/log?lineas=abc"), ctx("t1"));
    expect(log.status).toBe(500);
    falla.activa = false;
    const vacio = await (await import("@/app/api/trabajos/[id]/log/route")).GET(new Request("http://x/api/trabajos/t1/log?lineas=abc"), ctx("t1"));
    expect(await vacio.text()).toBe("(sin log todavía)");
  });

  it("/api/sistema: si la revisión falla, sale el mensaje sin rutas", async () => {
    const r = await (await import("@/app/api/sistema/route")).GET(new Request("http://x/api/sistema"));
    expect(r.status).toBe(400);
    const { error } = (await r.json()) as { error: string };
    expect(error).not.toContain("/home/");
    expect(error).toMatch(/«x\.json»/);
  });
});
