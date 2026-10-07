export const PAY = "/payroll";

export interface PayLine { code: string; name: string; amount: string; ref?: string }
export interface Component { id: string; code: string; name: string; kind: "earning" | "deduction"; isPfWage: boolean; isEsiWage: boolean; isTaxable: boolean; prorate: boolean; isSystem: boolean; sequence: number; isActive: boolean }
export interface TemplateLine { code: string; calc: "percent_ctc" | "percent_basic" | "fixed" | "balance"; value: number }
export interface SalaryTemplate { id: string; code: string; name: string; lines: TemplateLine[]; employerPfInCtc: boolean; isActive: boolean }
export interface Run { id: string; month: string; status: "draft" | "approved" | "paid"; totals: { employees?: number; gross?: string; deductions?: string; net?: string; employer?: string; tds?: string }; warnings: string[]; computedAt: string | null; approvedAt: string | null; paidOn: string | null; glVoucherId: string | null }
export interface RunSlip { id: string; employeeId: string; code: string; fullName: string; department: string | null; uan: string | null; monthDays: number; payableDays: string; lopDays: string; otHours: string; gross: string; totalDeductions: string; net: string; tds: string; earnings: PayLine[]; deductions: PayLine[]; employer: PayLine[]; warnings: string[] }
export interface RunView extends Run {
  payslips: RunSlip[];
  statutory: {
    pf: { employees: number; epfWages: number; employee: number; eps: number; employerEpf: number; edli: number; missingUan: string[] };
    esi: { employees: number; wages: number; employee: number; employer: number };
    pt: { stateCode: string; employees: number; employee: number }[];
    lwf: { stateCode: string; employees: number; employee: number; employer: number }[];
    tds: number;
  };
}

export const RUN_TONE = { draft: "warning", approved: "primary", paid: "success" } as const;
export const inr = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "–" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`);
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
