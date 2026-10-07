export const CRM = "/crm";

export const SOURCES: Record<string, string> = { web: "Website", indiamart: "IndiaMART", tradeindia: "TradeIndia", justdial: "JustDial", whatsapp: "WhatsApp", email: "Email", referral: "Referral", walk_in: "Walk-in", exhibition: "Exhibition", other: "Other" };
export const LEAD_TONE = { new: "primary", contacted: "warning", qualified: "success", unqualified: "neutral", converted: "success", lost: "danger" } as const;
export const ACTIVITY_LABEL: Record<string, string> = { call: "Call", meeting: "Meeting", task: "Task", note: "Note", email: "Email", whatsapp: "WhatsApp" };
export const grade = (score: number) => (score >= 70 ? "A" : score >= 40 ? "B" : "C");
export const GRADE_TONE = { A: "success", B: "warning", C: "neutral" } as const;

export interface Lead { id: string; number: string; name: string; company: string | null; email: string | null; phone: string | null; city: string | null; stateCode: string | null; source: string; product: string | null; estimatedValue: string | null; status: keyof typeof LEAD_TONE; score: number; duplicateOfId: string | null; nextFollowUp: string | null; owner: string | null; ownerId: string | null; territory: string | null; createdAt: string }
export interface Activity { id: string; kind: string; subject: string; notes: string | null; dueAt: string | null; doneAt: string | null; outcome: string | null; owner: string | null }
export interface Stage { id: string; name: string; probability: number; sequence: number; kind: "open" | "won" | "lost"; isActive: boolean }
export interface Opportunity { id: string; number: string; title: string; amount: string; closeDate: string | null; status: "open" | "won" | "lost"; stageId: string; stage: string; probability: number; partyId: string; party: string; ownerId: string | null; owner: string | null; quotationId: string | null; nextActivity: string | null; overdue: boolean }

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "–");
