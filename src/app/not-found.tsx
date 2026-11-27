import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "No existe" };

export default function NoEncontrada() {
  return (
    <section className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-xl font-semibold">Esta página no existe.</h1>
      <p className="mt-2 text-sm text-tenue">Puede que el enlace esté mal escrito o que eso se haya borrado.</p>
      <Link href="/" className="boton boton-primario mt-5">Ir a mis videos</Link>
    </section>
  );
}
