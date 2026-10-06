export type SheetEntity = "items" | "parties" | "opening-stock";
export type ImportKind = SheetEntity | "tally";

export interface CellError {
  column: string | null;
  message: string;
}

export interface RowResult {
  rowNo: number;
  status: "created" | "skipped" | "error";
  label: string;
  message?: string;
  errors: CellError[];
  ref?: { id: string; code: string | null };
}

export interface Summary {
  total: number;
  created: number;
  skipped: number;
  errors: number;
}

export interface SheetResult {
  entity: string;
  title: string;
  fileName: string;
  committed: boolean;
  summary: Summary;
  ignoredColumns: string[];
  rows: RowResult[];
}

export interface TallySection {
  key:
    "units" | "groups" | "warehouses" | "items" | "parties" | "opening_stock";
  title: string;
  summary: Summary;
  rows: RowResult[];
}

export interface TallyResult {
  fileName: string;
  committed: boolean;
  summary: Summary;
  sections: TallySection[];
  warnings: string[];
  ignored: { ledgers: number; compoundUnits: number };
}

export interface ColumnInfo {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  example?: string;
}

export const IMPORT_KINDS: Record<
  ImportKind,
  { title: string; description: string; permission: string; accept: string }
> = {
  items: {
    title: "Items",
    description:
      "Item master with units, HSN / GST, batch & serial settings, reorder levels and rates.",
    permission: "masters.items.manage",
    accept: ".xlsx,.csv",
  },
  parties: {
    title: "Customers & vendors",
    description:
      "GSTIN (check digit verified), address, contact, credit terms and MSME details.",
    permission: "masters.parties.manage",
    accept: ".xlsx,.csv",
  },
  "opening-stock": {
    title: "Opening stock",
    description:
      "Quantity and rate per item, warehouse and batch. Creates one opening stock entry per warehouse.",
    permission: "inventory.entries.manage",
    accept: ".xlsx,.csv",
  },
  tally: {
    title: "From Tally",
    description:
      "Units, stock groups, godowns, stock items, debtor / creditor ledgers and opening stock from a Tally XML export.",
    permission: "masters.items.manage",
    accept: ".xml",
  },
};
