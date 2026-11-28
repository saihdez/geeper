"use client";
import type { Pedido } from "@/lib/invitaciones/formularios";
import { Aviso, useSondeo } from "./comun";
import { FormInvitacion, type BorradorFormulario } from "./form-invitacion";

/** El formulario de siempre, ya lleno con lo que respondió el cliente, para corregir lo que no se pudo usar. */
export function DesdeFormulario({ id }: { id: string }) {
  const { datos, error } = useSondeo<{ pedido: Pedido }>(`/api/invitaciones/formularios/${encodeURIComponent(id)}`, 3_600_000);
  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos) return <p className="text-sm text-tenue">Cargando sus respuestas…</p>;
  const p = datos.pedido;
  if (!p.borrador) return <Aviso tipo="info">Esta respuesta ya se usó{p.slug ? "" : " o todavía no llega"}. Vuelve a Invitaciones.</Aviso>;
  return (
    <>
      <p className="text-sm text-tenue">Respuestas de «{p.referencia}». Corrige lo que se marca abajo y toca «Crear invitación».</p>
      <Aviso tipo="alerta"><ul className="list-disc pl-4">{p.problemas.map((x) => <li key={x}>{x}</li>)}</ul></Aviso>
      <FormInvitacion desde={{ formulario: p.id, datos: p.borrador as BorradorFormulario["datos"] }} />
    </>
  );
}
