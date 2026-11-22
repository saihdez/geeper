import type { Metadata } from "next";
import { tituloDe } from "@/lib/titulos-pagina";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: await tituloDe("proyecto", (await params).id) };
}

export default function Proyecto({ children }: { children: React.ReactNode }) {
  return children;
}
