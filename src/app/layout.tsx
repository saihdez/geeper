import type { Metadata } from "next";
import { Barra } from "@/components/barra";
import "./globals.css";

export const metadata: Metadata = {
  // Cada sección pone el suyo («Clips · Geeper»); así se distinguen las pestañas y el historial.
  title: { default: "Mis videos · Geeper", template: "%s · Geeper" },
  description: "Estudio de video local de Dimerso",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <Barra />
        <main id="contenido" tabIndex={-1} className="outline-none mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
