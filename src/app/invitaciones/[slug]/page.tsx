import { Suspense } from "react";
import { VistaInvitacion } from "@/components/invitaciones";

export default async function Invitacion({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <VistaInvitacion slug={slug} />
    </Suspense>
  );
}
