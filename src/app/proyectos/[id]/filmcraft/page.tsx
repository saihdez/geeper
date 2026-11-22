import { AbrirEnFilmcraft } from "@/components/abrir-filmcraft";

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  return <AbrirEnFilmcraft proyectoId={(await params).id} />;
}
