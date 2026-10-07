export const STAGE_TONE = { applied: "neutral", screening: "neutral", interview: "primary", offered: "warning", hired: "success", rejected: "danger", withdrawn: "neutral" } as const;
export const REQ_TONE = { pending: "warning", approved: "success", rejected: "danger", closed: "neutral" } as const;
export const SEP_TONE = { requested: "warning", accepted: "primary", settled: "success", withdrawn: "neutral" } as const;
/** Shop-floor skill levels (ILUO). */
export const LEVELS = ["Not trained", "I · learning", "L · with help", "U · on their own", "O · can train others"];
export const LEVEL_TONE = ["bg-surface-muted text-muted", "bg-danger/10 text-danger", "bg-warning/15 text-warning", "bg-success/15 text-success", "bg-primary/15 text-primary"];

export interface Requisition { id: string; number: string; title: string; department: string | null; designation: string | null; location: string | null; openings: number; reason: string; maxCtc: string | null; neededBy: string | null; description: string | null; status: keyof typeof REQ_TONE; requestedBy: string | null; candidates?: number; hired?: number; createdAt: string }
export interface Interview { id: string; round: number; scheduledAt: string; result: string; score: number | null; feedback: string | null; mode: string; interviewer: string | null }
export interface Candidate { id: string; name: string; email: string | null; mobile: string | null; source: string | null; currentCtc: string | null; expectedCtc: string | null; noticeDays: number | null; stage: keyof typeof STAGE_TONE; notes: string | null; employeeId: string | null; interviews: Interview[] | null; offer: { id: string; status: string; ctcAnnual: string; joiningDate: string; hasLetter: boolean } | null }
export interface SettlementLine { code: string; name: string; amount: string; basis?: string }
