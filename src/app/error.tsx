"use client";
/** Si una pantalla falla al abrirse: aviso en español, con la barra a la vista y una salida. */
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Algo falló · Geeper";
    console.error(error);
  }, [error]);
  return (
    <section className="mx-auto max-w-md py-12 text-center" role="alert">
      <h1 className="text-xl font-semibold">Algo falló al abrir esta pantalla.</h1>
      <p className="mt-2 text-sm text-tenue">Tus videos están a salvo. Prueba otra vez; si sigue pasando, mira «Sistema».</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" className="boton boton-primario" onClick={reset}>Volver a intentar</button>
        <Link href="/" className="boton">Ir a mis videos</Link>
      </div>
      {error.message && (
        <details className="mt-4 text-left text-xs text-tenue">
          <summary className="cursor-pointer">Detalle técnico</summary>
          <p className="mt-1 break-words font-mono">{error.message}{error.digest ? ` (${error.digest})` : ""}</p>
        </details>
      )}
    </section>
  );
}
