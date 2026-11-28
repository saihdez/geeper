import { InvitacionAMano } from "@/components/invitacion-a-mano";

export default async function AMano({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <InvitacionAMano slug={slug} />;
}
