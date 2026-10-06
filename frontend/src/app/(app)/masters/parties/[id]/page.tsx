"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { Party } from "@/lib/masters";
import { PartyEditor } from "../party-editor";

export default function PartyPage() {
  const { id } = useParams<{ id: string }>();
  const party = useQuery({ queryKey: ["masters", "party", id], queryFn: () => api<Party>(`/masters/parties/${id}`) });
  if (party.isLoading) return <LoadingBlock />;
  if (party.error) return <ErrorBlock error={party.error} />;
  return <PartyEditor key={party.data!.version} party={party.data!} />;
}
