"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LoadingBlock } from "@/components/ui/page";
import { PartyEditor } from "../party-editor";

function NewParty() {
  const role = useSearchParams().get("role");
  const [n, setN] = useState(0);
  return <PartyEditor key={n} defaultRole={role === "vendor" ? "vendor" : role === "customer" ? "customer" : undefined} onCreateAnother={() => setN((x) => x + 1)} />;
}

export default function NewPartyPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewParty />
    </Suspense>
  );
}
