import { Plantillas } from "@/components/plantillas";

export default async function Pagina({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Plantillas abrirNueva={"nueva" in (await searchParams)} />;
}
