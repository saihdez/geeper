import type { Metadata } from "next";
import { tituloDe } from "@/lib/titulos-pagina";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await tituloDe("campana", (await params).id) };
}

export default function Campana({ children }: { children: React.ReactNode }) {
  return children;
}
