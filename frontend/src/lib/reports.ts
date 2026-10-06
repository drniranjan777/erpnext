import { formatDate, formatMoney, formatQty } from "./documents";

export type ColumnType = "text" | "date" | "number" | "qty" | "money" | "percent";

export interface ReportColumn { key: string; label: string; type: ColumnType; total?: boolean; link?: { path: string; idKey: string } }
export interface ReportParam { key: string; label: string; type: "date" | "number" | "item" | "party" | "warehouse" | "select"; default?: string; options?: { value: string; label: string }[]; required?: boolean }

export type CatalogueEntry =
  | { kind: "query"; key: string; title: string; category: string; description: string; params: ReportParam[]; columns: ReportColumn[]; chart: { label: string; value: string } | null }
  | { kind: "link"; key: string; title: string; category: string; description: string; href: string };

export interface Catalogue { categories: Record<string, string>; reports: CatalogueEntry[] }

export interface ReportResult {
  key: string;
  title: string;
  params: Record<string, string>;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string>;
  truncated: boolean;
  chart: { label: string; value: string } | null;
}

export const NUMERIC: ColumnType[] = ["number", "qty", "money", "percent"];

export function formatCell(c: ReportColumn, v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  switch (c.type) {
    case "money":
      return formatMoney(String(v));
    case "qty":
      return formatQty(String(v));
    case "percent":
      return `${Number(v)}%`;
    case "number":
      return Number(v).toLocaleString("en-IN");
    case "date":
      return formatDate(String(v));
    default:
      return String(v);
  }
}
