export const DMS = "/dms";

export interface Distributor { id: string; partyId: string; code: string; name: string; gstin: string | null; territory: string | null; salesperson: string | null; salespersonId: string | null; isActive: boolean; retailers: number; secondaryMtd: number }
export interface Retailer { id: string; code: string; name: string; ownerName: string | null; phone: string | null; city: string | null; outletClass: string; distributorId: string; distributor: string; beatId: string | null; beat: string | null; latitude: string | null; longitude: string | null; isActive: boolean; points: number; lastVisit: string | null }
export interface Beat { id: string; code: string; name: string; distributorId: string | null; distributor: string | null; salespersonId: string | null; salesperson: string | null; weekday: number | null; isActive: boolean; retailers: number }
export interface SchemeRow { id: string; code: string; name: string; kind: "qty_slab" | "value_slab" | "free_goods"; level: "primary" | "secondary"; itemIds: string[]; slabs: { min: number; discountPct?: number; perUnit?: number; freeQty?: number }[]; fromDate: string; toDate: string; isActive: boolean }
export interface Applied { schemeId: string; code: string; itemId: string | null; discount: number; freeQty: number; basis: string }

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const SCHEME_KIND = { qty_slab: "Quantity slab", value_slab: "Value slab", free_goods: "Free goods" } as const;
export const slabText = (kind: SchemeRow["kind"], s: SchemeRow["slabs"][number]) =>
  kind === "free_goods" ? `buy ${s.min}, get ${s.freeQty} free` : kind === "value_slab" ? `₹${s.min.toLocaleString("en-IN")}+: ${s.discountPct} %` : `${s.min}+ units: ${s.perUnit ? `₹${s.perUnit} a unit` : `${s.discountPct} %`}`;
