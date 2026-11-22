"use client";
/** Barra de arriba: marca la sección en la que estás y ofrece «Saltar al contenido» para el teclado. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Paleta } from "@/components/paleta";
import { DESTINOS, destinoActual } from "@/lib/destinos";

export function Barra() {
  const ruta = usePathname() ?? "/";
  // Una app Craft abierta ocupa toda la ventana y trae su propia barra para volver.
  if (ruta.startsWith("/media/")) return null;
  const actual = destinoActual(ruta);
  return (
    <header className="border-b border-borde">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <nav aria-label="Secciones" className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="text-base font-bold tracking-tight">Geeper</Link>
        {DESTINOS.map((d) => {
          const aqui = actual?.ruta === d.ruta;
          return (
            <Link key={d.ruta} href={d.ruta} aria-current={aqui ? "page" : undefined}
              className={aqui ? "font-medium text-white underline decoration-acento decoration-2 underline-offset-8" : "text-tenue hover:text-white"}>
              {d.titulo}
            </Link>
          );
        })}
        <Paleta />
      </nav>
    </header>
  );
}
