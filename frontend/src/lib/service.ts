export const SVC = "/service";

export const PRIORITY_TONE = { urgent: "danger", high: "warning", medium: "primary", low: "neutral" } as const;
export const STATUS_TONE = { open: "warning", in_progress: "primary", waiting_customer: "neutral", resolved: "success", closed: "neutral" } as const;
export const SLA_TONE = { met: "success", missed: "danger", due: "neutral", at_risk: "warning", breached: "danger" } as const;
export const SLA_LABEL = { met: "met", missed: "missed", due: "on track", at_risk: "at risk", breached: "breached" } as const;

export interface TicketRow { id: string; number: string; subject: string; category: string; priority: keyof typeof PRIORITY_TONE; status: keyof typeof STATUS_TONE; channel: string; escalationLevel: number; createdAt: string; resolutionDueAt: string | null; customer: string | null; assignee: string | null; serialNo: string | null; underWarranty: boolean; underContract: boolean; response: keyof typeof SLA_TONE | null; resolutionSla: keyof typeof SLA_TONE | null }

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "–");
