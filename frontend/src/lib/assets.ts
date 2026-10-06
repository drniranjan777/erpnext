export interface AssetCategory {
  id: string;
  name: string;
  assetAccountId: string;
  method: "slm" | "wdv";
  usefulLifeYears: string;
  residualPct: string;
  itRatePct: string;
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: string | { id: string; name: string };
  location: string | null;
  locationId: string | null;
  custodian: string | null;
  serialNo: string | null;
  purchaseDate: string;
  capitalisedOn: string;
  cost: string;
  residualValue: string;
  method: "slm" | "wdv";
  usefulLifeYears: string;
  itRatePct: string;
  accumulatedDepreciation: string;
  depreciatedUntil: string | null;
  netBookValue: string;
  status: "active" | "disposed";
  disposedOn: string | null;
  disposalAmount: string;
  notes: string | null;
  history?: { id: string; fromDate: string; toDate: string; days: number; amount: string; journalId: string; journalNumber: string | null }[];
  references?: { id: string; number: string | null; docType: string }[];
}
