"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { PrintShell } from "@/components/print-shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { inr, monthLabel, PAY, type PayLine } from "@/lib/payroll";

interface Slip {
  month: string;
  code: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  doj: string;
  uan: string | null;
  esicNumber: string | null;
  panMasked: string | null;
  bankName: string | null;
  bankAccountLast4: string | null;
  regime: string;
  monthDays: number;
  payableDays: string;
  lopDays: string;
  otHours: string;
  earnings: PayLine[];
  deductions: PayLine[];
  employer: PayLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  fy: string;
  ytd: { gross: number; tds: number; pf: number };
  company: { name: string; address: Record<string, string> | null } | null;
}

const words = (n: number): string => {
  const a = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const b = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? `-${a[x % 10]}` : ""}`);
  const three = (x: number) => `${x >= 100 ? `${a[Math.floor(x / 100)]} hundred${x % 100 ? " " : ""}` : ""}${x % 100 ? two(x % 100) : ""}`;
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (crore) parts.push(`${three(crore)} crore`);
  if (lakh) parts.push(`${two(lakh)} lakh`);
  if (thousand) parts.push(`${two(thousand)} thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(" ");
};

/** A payslip on the company letterhead. */
export default function PrintPayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const q = useQuery({ queryKey: [PAY, "payslip", id], queryFn: () => api<Slip>(`${PAY}/payslips/${id}`), enabled: status === "authenticated" });
  const s = q.data;
  const rows = s ? Math.max(s.earnings.length, s.deductions.length) : 0;
  const addr = s?.company?.address ? [s.company.address.line1, s.company.address.city, s.company.address.pincode].filter(Boolean).join(", ") : "";
  return (
    <PrintShell title={s ? `Payslip ${s.code} ${s.month}` : "Payslip"} ready={!!s}>
      {s && (
        <div className="mx-auto max-w-[210mm] bg-white p-10 text-[12px] text-black shadow print:max-w-none print:p-0 print:shadow-none">
          <style>{"@page { size: A4; margin: 15mm; }"}</style>
          <div className="mb-4 border-b-2 border-black pb-2 text-center">
            <p className="text-base font-bold">{s.company?.name}</p>
            {addr && <p className="text-[11px]">{addr}</p>}
            <p className="mt-1 font-semibold">Payslip for {monthLabel(s.month)}</p>
          </div>
          <table className="mb-4 w-full">
            <tbody>
              <tr><td className="w-1/4 py-0.5 font-semibold">Employee</td><td>{s.fullName} ({s.code})</td><td className="w-1/4 font-semibold">Date of joining</td><td>{formatDate(s.doj)}</td></tr>
              <tr><td className="py-0.5 font-semibold">Designation</td><td>{s.designation ?? "–"}</td><td className="font-semibold">Department</td><td>{s.department ?? "–"}</td></tr>
              <tr><td className="py-0.5 font-semibold">Location</td><td>{s.location ?? "–"}</td><td className="font-semibold">PAN</td><td>{s.panMasked ?? "–"}</td></tr>
              <tr><td className="py-0.5 font-semibold">UAN</td><td>{s.uan ?? "–"}</td><td className="font-semibold">ESIC no.</td><td>{s.esicNumber ?? "–"}</td></tr>
              <tr><td className="py-0.5 font-semibold">Bank</td><td>{s.bankName ? `${s.bankName} ••${s.bankAccountLast4 ?? ""}` : "–"}</td><td className="font-semibold">Days paid</td><td>{Number(s.payableDays)} of {s.monthDays}{Number(s.lopDays) ? ` (LOP ${Number(s.lopDays)})` : ""}{Number(s.otHours) ? ` · OT ${Number(s.otHours)} h` : ""}</td></tr>
            </tbody>
          </table>
          <table className="w-full border-collapse border border-black">
            <thead><tr className="border-b border-black bg-gray-100"><th className="border-r border-black px-2 py-1 text-left">Earnings</th><th className="border-r border-black px-2 py-1 text-right">₹</th><th className="border-r border-black px-2 py-1 text-left">Deductions</th><th className="px-2 py-1 text-right">₹</th></tr></thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => (
                <tr key={i}>
                  <td className="border-r border-black px-2 py-0.5">{s.earnings[i]?.name}</td>
                  <td className="border-r border-black px-2 py-0.5 text-right tabular-nums">{s.earnings[i] && Number(s.earnings[i].amount).toLocaleString("en-IN")}</td>
                  <td className="border-r border-black px-2 py-0.5">{s.deductions[i]?.name}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{s.deductions[i] && Number(s.deductions[i].amount).toLocaleString("en-IN")}</td>
                </tr>
              ))}
              <tr className="border-t border-black font-semibold"><td className="border-r border-black px-2 py-1">Gross earnings</td><td className="border-r border-black px-2 py-1 text-right tabular-nums">{Number(s.gross).toLocaleString("en-IN")}</td><td className="border-r border-black px-2 py-1">Total deductions</td><td className="px-2 py-1 text-right tabular-nums">{Number(s.totalDeductions).toLocaleString("en-IN")}</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-sm font-bold">Net pay {inr(s.net)}</p>
          <p className="text-[11px]">Rupees {words(Math.round(Number(s.net)))} only</p>
          <p className="mt-3 text-[11px]">Employer contributions (not part of take-home): {s.employer.map((l) => `${l.name} ${inr(l.amount)}`).join(" · ") || "none"}</p>
          <p className="text-[11px]">Year to date ({s.fy}): gross {inr(s.ytd.gross)} · TDS {inr(s.ytd.tds)} · PF {inr(s.ytd.pf)} · {s.regime} tax regime</p>
          <p className="mt-6 text-[10px] text-gray-600">This is a computer-generated payslip and needs no signature.</p>
        </div>
      )}
    </PrintShell>
  );
}
