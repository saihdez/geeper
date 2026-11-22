"use client";
/** Último recurso: falló hasta la barra (layout). Sin estilos de la app, por eso lleva los suyos. */
export default function ErrorGlobal({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <head><title>Algo falló · Geeper</title></head>
      <body style={{ background: "#0b0d12", color: "#e6e9ef", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main role="alert" style={{ maxWidth: "28rem", padding: "1rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem" }}>Algo falló al abrir Geeper.</h1>
          <p style={{ color: "#8b93a7", fontSize: ".9rem" }}>Tus videos están a salvo. Prueba otra vez; si sigue pasando, cierra Geeper y ábrelo de nuevo.</p>
          <p style={{ display: "flex", gap: ".5rem", justifyContent: "center" }}>
            <button type="button" onClick={reset} style={{ background: "#0e7490", color: "white", border: 0, borderRadius: 8, padding: ".5rem .9rem" }}>Volver a intentar</button>
            {/* Un <a> normal: recarga todo, que es lo que hace falta si falló la estructura de la app. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#7dd3fc", padding: ".5rem .9rem" }}>Ir a mis videos</a>
          </p>
        </main>
      </body>
    </html>
  );
}
