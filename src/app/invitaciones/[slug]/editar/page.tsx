import { EditarInvitacion } from "@/components/invitaciones";

export default async function Editar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <EditarInvitacion slug={slug} />;
}
