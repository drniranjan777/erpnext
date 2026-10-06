/** Types + helpers for the document framework (shared by every transaction type). */

export type DocumentStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled" | "completed";

export const STATUS_META: Record<DocumentStatus, { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Pending approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  completed: { label: "Completed", tone: "primary" },
};

export interface ApprovalStep {
  stepNo: number;
  name: string;
  status: "waiting" | "pending" | "approved" | "rejected" | "skipped";
  approver: { roleId: string | null; roleName: string | null; userId: string | null; userName: string | null };
  actedBy: string | null;
  actedAt: string | null;
  comment: string | null;
}

export interface DocumentHeader {
  id: string;
  docType: string;
  docTypeLabel: string;
  number: string | null;
  displayNumber: string;
  fiscalYear: string | null;
  docDate: string;
  status: DocumentStatus;
  revision: number;
  title: string | null;
  amount: string | null;
  currency: string;
  company: { id: string; name: string };
  branch: { id: string; code: string; name: string } | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  version: number;
  customFields: Record<string, unknown>;
  approvals: ApprovalStep[];
  can: { edit: boolean; delete: boolean; submit: boolean; approve: boolean; reject: boolean; cancel: boolean; amend: boolean };
}

export interface ActivityEntry {
  id: string;
  kind: string;
  message: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string | null; name: string | null };
}

export interface AttachmentInfo {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string | null; name: string | null };
}

export interface Revision {
  revision: number;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
  snapshot: Record<string, unknown>;
}

export interface InboxItem {
  documentId: string;
  docType: string;
  docTypeLabel: string;
  number: string | null;
  title: string | null;
  amount: string | null;
  currency: string;
  docDate: string;
  submittedAt: string;
  submittedBy: string | null;
  stepNo: number;
  stepName: string;
  path: string | null;
}

export const documentKeys = {
  inbox: ["documents", "inbox"] as const,
  activity: (id: string) => ["documents", id, "activity"] as const,
  attachments: (id: string) => ["documents", id, "attachments"] as const,
  revisions: (id: string) => ["documents", id, "revisions"] as const,
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });

/** ₹ 1,23,456.78 (Indian digit grouping). */
export function formatMoney(value: string | number | null | undefined, currency = "INR") {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (currency !== "INR") return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(n);
  return inr.format(n);
}

export function formatQty(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return num.format(Number(value));
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** Today in IST as YYYY-MM-DD (for date inputs). */
export function todayIST() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
