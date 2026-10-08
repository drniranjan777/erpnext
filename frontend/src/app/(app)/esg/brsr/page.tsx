"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { currentFy, fyOptions } from "@/lib/esg";

type Num = number | null;
interface Brsr {
  fiscalYear: string;
  company: { name: string; gstin: string | null; pan: string | null } | null;
  turnover: number;
  sections: {
    employees: { byGender: Record<string, number>; permanent: number; otherThanPermanent: number; contractWorkers: number; femalePct: Num };
    energy: { totalGj: number; electricityGj: number; fuelGj: number; renewablePct: Num; intensityGjPerCrore: Num };
    emissions: { scope1: number; scope2: number; scope3: number; intensityPerCrore: Num };
    water: { withdrawalKl: Num; consumptionKl: Num; dischargeKl: Num; intensityKlPerCrore: Num };
    waste: { hazardousT: number; plasticT: Num; eWasteT: Num; otherT: Num; recycledT: Num };
    safety: { lti: number; fatal: number; recordable: number; lostDays: number; personHours: number; personHoursEstimated: boolean; ltifr: Num };
    epr: { category: string; targetKg: number; certifiedKg: number; pct: Num }[];
    social: { csrSpend: Num; trainingHours: Num; complaints: Num };
  };
}
interface Metrics { labels: Record<string, string>; values: Record<string, number> }

const v = (n: Num | undefined, unit = "") => (n === null || n === undefined ? "–" : `${n.toLocaleString("en-IN")}${unit}`);

/** BRSR-lite: the environment, social and governance indicators a manufacturer can fill from its records. */
export default function BrsrPage() {
  const { can } = useAuth();
  const [fy, setFy] = useState(currentFy);
  const q = useQuery({ queryKey: ["/esg/brsr", fy], queryFn: () => api<Brsr>("/esg/brsr", { query: { fiscalYear: fy } }) });
  const m = useQuery({ queryKey: ["/esg/metrics", fy], queryFn: () => api<Metrics>("/esg/metrics", { query: { fiscalYear: fy } }) });
  const b = q.data;
  const s = b?.sections;
  const rows: [string, [string, string][]][] = s
    ? [
        ["Employees (Section A)", [...Object.entries(s.employees.byGender).map(([g, n]): [string, string] => [`Employees — ${g}`, v(n)]), ["Permanent / other than permanent", `${s.employees.permanent} / ${s.employees.otherThanPermanent}`], ["Contract workers", v(s.employees.contractWorkers)], ["Women in the workforce", v(s.employees.femalePct, " %")]]],
        ["Energy (Principle 6)", [["Total energy", v(s.energy.totalGj, " GJ")], ["Electricity / fuel", `${v(s.energy.electricityGj)} / ${v(s.energy.fuelGj)} GJ`], ["Renewable share of electricity", v(s.energy.renewablePct, " %")], ["Energy intensity", v(s.energy.intensityGjPerCrore, " GJ per ₹ crore")]]],
        ["Emissions (Principle 6)", [["Scope 1", v(s.emissions.scope1, " t CO2e")], ["Scope 2", v(s.emissions.scope2, " t CO2e")], ["Scope 3", v(s.emissions.scope3, " t CO2e")], ["Scope 1 + 2 intensity", v(s.emissions.intensityPerCrore, " t per ₹ crore")]]],
        ["Water (Principle 6)", [["Withdrawal", v(s.water.withdrawalKl, " kl")], ["Consumption", v(s.water.consumptionKl, " kl")], ["Discharge", v(s.water.dischargeKl, " kl")], ["Water intensity", v(s.water.intensityKlPerCrore, " kl per ₹ crore")]]],
        ["Waste (Principle 6)", [["Hazardous (register)", v(s.waste.hazardousT, " t")], ["Plastic", v(s.waste.plasticT, " t")], ["E-waste", v(s.waste.eWasteT, " t")], ["Other", v(s.waste.otherT, " t")], ["Recycled or reused", v(s.waste.recycledT, " t")]]],
        ["Safety (Principle 3)", [["Lost-time injuries", v(s.safety.lti)], ["LTIFR (per million person-hours)", `${v(s.safety.ltifr)}${s.safety.personHoursEstimated ? " (hours estimated)" : ""}`], ["Recordable injuries", v(s.safety.recordable)], ["Fatalities", v(s.safety.fatal)], ["Person-hours", v(s.safety.personHours)]]],
        ["Extended producer responsibility", s.epr.map((e): [string, string] => [e.category.replaceAll("_", " "), `${v(e.certifiedKg)} of ${v(e.targetKg)} kg (${v(e.pct, " %")})`])],
        ["Social", [["CSR spend", v(s.social.csrSpend, " ₹")], ["Training hours", v(s.social.trainingHours)], ["Complaints received", v(s.social.complaints)]]],
      ]
    : [];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="BRSR-lite" description={`Business Responsibility and Sustainability indicators for ${b?.company?.name ?? "the company"}, built from emissions, HR, HSE, waste and EPR records plus the figures entered below.${b ? ` Turnover ₹${b.turnover.toLocaleString("en-IN")}.` : ""}`} actions={<span className="flex gap-2 print:hidden"><Select className="h-9 w-32" aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>{fyOptions().map((y) => <option key={y}>{y}</option>)}</Select><Button variant="secondary" onClick={() => window.print()}>Print</Button></span>} />
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(([title, items]) => (
          <Card key={title}>
            <CardHeader title={title} />
            <dl className="divide-y divide-border border-t border-border text-sm">{items.map(([k, val]) => <div key={k} className="flex justify-between gap-3 px-4 py-1.5"><dt className="capitalize text-muted">{k}</dt><dd className="text-right tabular-nums">{val}</dd></div>)}</dl>
          </Card>
        ))}
      </div>
      {can("esg.data.manage") && m.data && <MetricsForm key={`${fy}-${m.dataUpdatedAt}`} fy={fy} metrics={m.data} />}
    </div>
  );
}

function MetricsForm({ fy, metrics }: { fy: string; metrics: Metrics }) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(Object.keys(metrics.labels).map((k) => [k, metrics.values[k]?.toString() ?? ""])));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api("/esg/metrics", { body: { fiscalYear: fy, values: Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, x === "" ? null : Number(x)])) } });
      setMsg({ tone: "success", text: "Saved." });
      qc.invalidateQueries({ queryKey: ["/esg/brsr"] });
      qc.invalidateQueries({ queryKey: ["/esg/metrics"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card className="print:hidden">
      <CardHeader title={`Figures for ${fy}`} description="Entered by hand; everything else comes from the records." />
      <div className="space-y-2 border-t border-border p-4 text-sm">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">{Object.entries(metrics.labels).map(([k, l]) => <label key={k} className="flex items-center justify-between gap-2">{l}<Input className="h-8 w-36" type="number" min={0} step="any" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>)}</div>
        <Button onClick={save}>Save</Button>
      </div>
    </Card>
  );
}
