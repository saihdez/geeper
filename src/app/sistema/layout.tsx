import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sistema" };

export default function Seccion({ children }: { children: React.ReactNode }) {
  return children;
}
