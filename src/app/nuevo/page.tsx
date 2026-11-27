import { Suspense } from "react";
import { Nuevo as NuevoVideo } from "@/components/nuevo";

export default function Nuevo() {
  return (
    <Suspense>
      <NuevoVideo />
    </Suspense>
  );
}
