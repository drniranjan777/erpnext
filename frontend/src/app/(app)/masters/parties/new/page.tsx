"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/ui/page";
import { PartyEditor } from "../party-editor";

function NewParty() {
  const role = useSearchParams().get("role");
  return <PartyEditor defaultRole={role === "vendor" ? "vendor" : role === "customer" ? "customer" : undefined} />;
}

export default function NewPartyPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewParty />
    </Suspense>
  );
}
