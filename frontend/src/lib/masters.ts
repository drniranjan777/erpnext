"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const ITEM_TYPES = {
  raw_material: "Raw material",
  packing_material: "Packing material",
  semi_finished: "Semi-finished",
  finished_good: "Finished good",
  trading: "Trading goods",
  consumable: "Consumable",
  spare: "Spare / tool",
  service: "Service",
  asset: "Capital asset",
  scrap: "Scrap",
  by_product: "By-product",
} as const;
export type ItemType = keyof typeof ITEM_TYPES;

export const GST_REG_TYPES = {
  regular: "Registered (regular)",
  composition: "Registered (composition)",
  sez: "SEZ unit / developer",
  unregistered: "Unregistered business",
  consumer: "Consumer (B2C)",
  overseas: "Overseas",
} as const;

export const WAREHOUSE_TYPES = {
  store: "Store",
  production: "Production floor",
  finished_goods: "Finished goods",
  quarantine: "Quarantine / QC hold",
  rejected: "Rejected",
  scrap: "Scrap yard",
  transit: "In transit",
  job_work: "At job worker",
} as const;

export interface Uom {
  id: string;
  code: string;
  name: string;
  decimals: number;
  uqc: string;
  isActive: boolean;
  version: number;
}

export interface ItemGroup {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  version: number;
  itemCount: number;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: keyof typeof WAREHOUSE_TYPES;
  companyId: string;
  company: string;
  branchId: string | null;
  branch: string | null;
  address: { line1?: string; city?: string; stateCode?: string; pincode?: string };
  isNettable: boolean;
  allowNegativeStock: boolean;
  isActive: boolean;
  version: number;
}

export interface Reference {
  states: { code: string; name: string }[];
  gstRates: string[];
  uqc: { code: string; name: string }[];
}

export interface ItemListRow {
  id: string;
  code: string;
  name: string;
  type: ItemType;
  hsnCode: string | null;
  gstRate: string | null;
  isStockItem: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  reorderLevel: string | null;
  sellingRate: string | null;
  standardCost: string | null;
  isActive: boolean;
  group: string | null;
  baseUom: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ItemType;
  groupId: string | null;
  baseUomId: string;
  purchaseUomId: string | null;
  salesUomId: string | null;
  hsnCode: string | null;
  gstRate: string | null;
  cessRate: string;
  isNilRatedOrExempt: boolean;
  isStockItem: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  hasExpiry: boolean;
  shelfLifeDays: number | null;
  minRemainingShelfLifeDays: number | null;
  valuationMethod: "weighted_average" | "fifo";
  reorderLevel: string | null;
  reorderQty: string | null;
  safetyStock: string | null;
  minOrderQty: string | null;
  leadTimeDays: number | null;
  standardCost: string | null;
  lastPurchaseRate: string | null;
  sellingRate: string | null;
  mrp: string | null;
  brand: string | null;
  netWeightKg: string | null;
  grossWeightKg: string | null;
  attributes: Record<string, string | number | boolean | null>;
  abcClass: "A" | "B" | "C" | null;
  isActive: boolean;
  customFields: Record<string, unknown>;
  version: number;
  conversions: { uomId: string; uom: string; factor: string }[];
  barcodes: { id: string; barcode: string; uomId: string | null; isPrimary: boolean }[];
}

export interface PartyAddress {
  id?: string;
  type: "billing" | "shipping" | "both";
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  district: string | null;
  stateCode: string;
  pincode: string | null;
  country: string;
  gstin: string | null;
  isDefault: boolean;
  state?: string | null;
}

export interface PartyContact {
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface PartyBank {
  id?: string;
  accountName: string;
  accountNumber?: string;
  accountNumberMasked?: string;
  ifsc: string;
  bankName: string | null;
  branchName: string | null;
  isPrimary: boolean;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  isCustomer: boolean;
  isVendor: boolean;
  gstRegistrationType: keyof typeof GST_REG_TYPES;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  state: string | null;
  msmeUdyamNo: string | null;
  msmeCategory: "micro" | "small" | "medium" | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  currency: string;
  creditLimit: string | null;
  creditDays: number | null;
  paymentTerms: string | null;
  tdsSection: string | null;
  tcsApplicable: boolean;
  notes: string | null;
  isActive: boolean;
  customFields: Record<string, unknown>;
  version: number;
  addresses: PartyAddress[];
  contacts: PartyContact[];
  bankAccounts: PartyBank[];
}

export interface PartyListRow {
  id: string;
  code: string;
  name: string;
  isCustomer: boolean;
  isVendor: boolean;
  gstin: string | null;
  gstRegistrationType: keyof typeof GST_REG_TYPES;
  stateCode: string | null;
  state: string | null;
  msmeCategory: string | null;
  phone: string | null;
  email: string | null;
  creditDays: number | null;
  isActive: boolean;
  city: string | null;
}

const STALE = 5 * 60_000;

export const useReference = () => useQuery({ queryKey: ["masters", "reference"], queryFn: () => api<Reference>("/masters/reference"), staleTime: Infinity });
export const useUoms = () => useQuery({ queryKey: ["masters", "uoms"], queryFn: () => api<Uom[]>("/masters/uoms"), staleTime: STALE });
export const useItemGroups = () => useQuery({ queryKey: ["masters", "item-groups"], queryFn: () => api<ItemGroup[]>("/masters/item-groups"), staleTime: STALE });
export const useWarehouses = () => useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api<Warehouse[]>("/inventory/warehouses"), staleTime: STALE });

/** Client-side GSTIN check (same mod-36 algorithm as the server) for instant feedback. */
export function gstinProblem(v: string): string | null {
  const g = v.trim().toUpperCase();
  if (!g) return null;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return "Enter a valid 15-character GSTIN";
  const C = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return C[(36 - (sum % 36)) % 36] === g[14] ? null : "Check digit is wrong. Please re-check the GSTIN.";
}
