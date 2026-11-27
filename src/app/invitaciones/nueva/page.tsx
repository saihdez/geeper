import Link from "next/link";
import { FormInvitacion } from "@/components/form-invitacion";

export default function NuevaInvitacion() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/invitaciones" className="text-xs text-tenue hover:text-white">← Invitaciones</Link>
      <h1 className="text-xl font-semibold">Nueva invitación interactiva</h1>
      <p className="text-sm text-tenue">
        Llena estos 5 datos y toca «Crear invitación». Se abre como un sobre, suena tu canción, tiene calendario, cuenta atrás,
        cómo llegar y un botón para confirmar por WhatsApp.
      </p>
      <FormInvitacion />
    </div>
  );
}
