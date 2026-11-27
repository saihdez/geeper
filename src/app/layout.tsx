import type { Metadata } from "next";
import Link from "next/link";
import { Paleta } from "@/components/paleta";
import { TrabajosFlotantes } from "@/components/trabajos-flotantes";
import "./globals.css";

export const metadata: Metadata = { title: "Geeper", description: "Estudio de video local de Dimerso" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <header className="border-b border-borde">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-bold tracking-tight">
              Geeper
            </Link>
            <Link href="/" className="text-tenue hover:text-white">Proyectos</Link>
            <Link href="/nuevo" className="text-tenue hover:text-white">Nuevo</Link>
            <Link href="/clips" className="text-tenue hover:text-white">Clips</Link>
            <Link href="/avatares" className="text-tenue hover:text-white">Avatares</Link>
            <Link href="/workflows" className="text-tenue hover:text-white">Workflows</Link>
            <Link href="/escenas-3d" className="text-tenue hover:text-white">Escenas 3D</Link>
            <Link href="/trabajos" className="text-tenue hover:text-white">Trabajos</Link>
            <Link href="/anuncios" className="text-tenue hover:text-white">Anuncios</Link>
            <Link href="/invitaciones" className="text-tenue hover:text-white">Invitaciones</Link>
            <Link href="/plantillas" className="text-tenue hover:text-white">Plantillas</Link>
            <Link href="/media" className="text-tenue hover:text-white">Media</Link>
            <Link href="/cuentas" className="text-tenue hover:text-white">Cuentas</Link>
            <Link href="/sistema" className="text-tenue hover:text-white">Sistema</Link>
            <Paleta />
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <TrabajosFlotantes />
      </body>
    </html>
  );
}
