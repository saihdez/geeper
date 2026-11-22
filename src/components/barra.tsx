"use client";
/**
 * Barra de arriba: marca la sección en la que estás y ofrece «Saltar al contenido» para el teclado.
 *
 * En ventanas angostas (A11-16) las 11 secciones ocupaban dos a cuatro filas. Ahí quedan a la vista
 * las de todos los días (PRINCIPALES) y el resto va en el menú «Más»; en ventanas anchas se ven todas
 * y «Más» no aparece (globals.css, `.barra-extra` y `.barra-mas`). «Más» es un <details>: se abre con
 * Enter o Espacio, se cierra con Escape, al tocar fuera o al elegir una sección.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AvisoMotor } from "@/components/motor";
import { Paleta } from "@/components/paleta";
import { DESTINOS, destinoActual, type Destino } from "@/lib/destinos";

/** Secciones que siempre se ven, también en una ventana angosta. */
export const PRINCIPALES: ReadonlySet<string> = new Set(["/", "/nuevo", "/clips", "/trabajos", "/anuncios"]);

/** Las secciones que van en «Más» cuando la ventana es angosta, en el mismo orden que la barra. */
export const enMas = (): Destino[] => DESTINOS.filter((d) => !PRINCIPALES.has(d.ruta));

const claseEnlace = (aqui: boolean) => (aqui ? "font-medium text-white underline decoration-acento decoration-2 underline-offset-8" : "text-tenue hover:text-white");

export function Barra() {
  const ruta = usePathname() ?? "/";
  const mas = useRef<HTMLDetailsElement>(null);

  // Al cambiar de sección, «Más» se cierra (Link no recarga la página).
  useEffect(() => {
    if (mas.current) mas.current.open = false;
  }, [ruta]);

  // Tocar o hacer clic fuera de «Más» lo cierra.
  useEffect(() => {
    const fuera = (e: PointerEvent) => {
      const d = mas.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, []);

  // Una app Craft abierta ocupa toda la ventana y trae su propia barra para volver.
  if (ruta.startsWith("/media/")) return null;
  const actual = destinoActual(ruta);
  const otras = enMas();
  const actualEnMas = otras.find((d) => d.ruta === actual?.ruta);

  const cerrarConEscape = (e: React.KeyboardEvent<HTMLDetailsElement>) => {
    const d = mas.current;
    if (e.key !== "Escape" || !d?.open) return;
    e.preventDefault();
    d.open = false;
    d.querySelector("summary")?.focus();
  };

  return (
    <header className="border-b border-borde">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <nav aria-label="Secciones" className="barra relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="text-base font-bold tracking-tight">Geeper</Link>
        {DESTINOS.map((d) => {
          const aqui = actual?.ruta === d.ruta;
          return (
            <Link key={d.ruta} href={d.ruta} aria-current={aqui ? "page" : undefined}
              className={`${PRINCIPALES.has(d.ruta) ? "" : "barra-extra "}${claseEnlace(aqui)}`}>
              {d.titulo}
            </Link>
          );
        })}
        <details ref={mas} className="barra-mas" onKeyDown={cerrarConEscape}>
          <summary className={`cursor-pointer select-none rounded px-1 ${claseEnlace(!!actualEnMas)}`}>
            {actualEnMas ? actualEnMas.titulo : "Más"}
            <span aria-hidden="true"> ▾</span>
            {actualEnMas && <span className="sr-only"> (más secciones)</span>}
          </summary>
          <ul className="tarjeta z-40 mt-2 min-w-48 p-1 shadow-lg">
            {otras.map((d) => {
              const aqui = actual?.ruta === d.ruta;
              return (
                <li key={d.ruta}>
                  <Link href={d.ruta} aria-current={aqui ? "page" : undefined}
                    onClick={() => mas.current && (mas.current.open = false)}
                    className={`block rounded px-3 py-2 hover:bg-white/5 ${claseEnlace(aqui)}`}>
                    {d.titulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
        <Paleta />
      </nav>
      <AvisoMotor />
    </header>
  );
}
