"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { api } from "./api";

export const WMS = "/wms";

export interface WmsWarehouse { id: string; code: string; name: string; allowNegativeStock: boolean; wms: boolean; receivingBinId: string | null; dispatchBinId: string | null; bins: number; openTasks: number }
export interface Zone { id: string; code: string; name: string; kind: string; condition: string; sequence: number; isActive: boolean; bins: number }
export interface Bin {
  id: string; code: string; zoneId: string; zone: string; zoneKind: string; condition: string; aisle: string | null; rack: string | null; shelf: string | null; position: string | null; binType: string;
  maxWeightKg: string | null; maxVolumeM3: string | null; maxQty: string | null; pickSequence: number; fixedItemId: string | null; fixedItem: string | null; isBlocked: boolean; blockReason: string | null; isActive: boolean; gridX: number | null; gridY: number | null; items: number;
}
export interface BinContent { itemId: string; code: string; name: string; batchKey: string; batchNo: string | null; expiryDate: string | null; qcStatus: string | null; qty: string; uom: string }
export interface BinView { id: string; code: string; zone: string; zoneKind: string; condition: string; binType: string; isBlocked: boolean; blockReason: string | null; fixedItem: string | null; contents: BinContent[] }
export interface Task {
  id: string; number: string; kind: string; status: string; warehouseId: string; warehouse: string; itemId: string; itemCode: string; itemName: string; batchId: string | null; batchNo: string | null; qty: string;
  fromBinId: string | null; fromBin: string | null; toBinId: string | null; toBin: string | null; reason: string | null; doneQty: string | null; doneBin: string | null; overrideReason: string | null; assignee: string | null; createdAt: string; doneAt: string | null;
}

export const CONDITIONS = ["ambient", "cold", "frozen", "hazardous", "quarantine", "bonded"] as const;
export const CONDITION_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = { ambient: "neutral", cold: "primary", frozen: "primary", hazardous: "danger", quarantine: "warning", bonded: "success" };

export function useWmsWarehouses() {
  return useQuery({ queryKey: [WMS, "warehouses"], queryFn: () => api<WmsWarehouse[]>(`${WMS}/warehouses`) });
}

/** The warehouse chosen in `?wh=`, defaulting to the first one run with bins. */
export function useWarehouseParam() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const list = useWmsWarehouses();
  const enabled = (list.data ?? []).filter((w) => w.wms);
  const wh = sp.get("wh") ?? enabled[0]?.id ?? null;
  useEffect(() => {
    if (!sp.get("wh") && enabled[0]) router.replace(`${path}?wh=${enabled[0].id}`);
  }, [sp, enabled, router, path]);
  const set = (id: string) => router.replace(`${path}?wh=${id}`);
  return { wh, set, enabled, loading: list.isLoading, current: enabled.find((w) => w.id === wh) ?? null };
}
