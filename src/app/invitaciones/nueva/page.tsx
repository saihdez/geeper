import Link from "next/link";
import { DesdeFormulario } from "@/components/invitacion-desde-formulario";
import { FormInvitacion } from "@/components/form-invitacion";

export default async function NuevaInvitacion({ searchParams }: { searchParams: Promise<{ formulario?: string }> }) {
  const { formulario } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/invitaciones" className="text-xs text-tenue hover:text-white">← Invitaciones</Link>
      <h1 className="text-xl font-semibold">Nueva invitación interactiva</h1>
      {formulario ? <DesdeFormulario id={formulario} /> : (
        <>
          <p className="text-sm text-tenue">
            Llena estos 5 datos y toca «Crear invitación». Se abre como un sobre, suena tu canción, tiene calendario, cuenta atrás,
            cómo llegar y un botón para confirmar por WhatsApp.
          </p>
          <FormInvitacion />
        </>
      )}
    </div>
  );
}
