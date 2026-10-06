"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api } from "@/lib/api";
import type { Item } from "@/lib/masters";
import { ItemEditor } from "../item-editor";

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const item = useQuery({ queryKey: ["masters", "item", id], queryFn: () => api<Item>(`/masters/items/${id}`) });
  if (item.isLoading) return <LoadingBlock />;
  if (item.error) return <ErrorBlock error={item.error} />;
  // key: re-initialise the form when the saved version changes
  return <ItemEditor key={item.data!.version} item={item.data!} />;
}
