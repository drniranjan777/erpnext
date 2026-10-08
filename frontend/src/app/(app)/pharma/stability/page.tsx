"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/documents";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; code: string; itemCode: string; itemName: string; batchNo: string; kind: string; temperatureC: number; humidityPct: number | null; startDate: string; status: string; oos: number; nextPull: { timePoint: number; pullDate: string } | null; overdue: number }

const KIND: Record<string, string> = { long_term: "Long term", intermediate: "Intermediate", accelerated: "Accelerated", ongoing: "On-going", photostability: "Photostability" };
const CONDITIONS = [
  { label: "25 °C / 60 % RH (zone II)", t: 25, h: 60 },
  { label: "30 °C / 65 % RH", t: 30, h: 65 },
  { label: "30 °C / 75 % RH (zone IVb)", t: 30, h: 75 },
  { label: "40 °C / 75 % RH (accelerated)", t: 40, h: 75 },
  { label: "5 °C (refrigerated)", t: 5, h: null },
];

/** Stability studies: pull schedule, results against specification, shelf-life support. */
export default function StabilityPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/pharma/stability"], queryFn: () => api<Row[]>("/pharma/stability") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Stability studies" description="Each study is a batch at one storage condition with its time points and tests. Results outside specification raise an OOS deviation; the shelf life the data supports is worked out as ICH Q1E describes." actions={can("pharma.stability.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New study</Button>} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Study</th><th className="px-4 py-2 font-medium">Product · batch</th><th className="px-4 py-2 font-medium">Condition</th><th className="px-4 py-2 font-medium">Next pull</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2"><Link className="font-medium text-primary hover:underline" href={`/pharma/stability/${r.id}`}>{r.code}</Link><span className="block text-xs text-muted">{KIND[r.kind]} · from {formatDate(r.startDate)}</span></td>
                <td className="px-4 py-2">{r.itemCode} · {r.itemName}<span className="block text-xs text-muted">batch {r.batchNo}</span></td>
                <td className="px-4 py-2">{r.temperatureC} °C{r.humidityPct ? ` / ${r.humidityPct} % RH` : ""}</td>
                <td className="px-4 py-2">{r.nextPull ? `${r.nextPull.timePoint} M · ${formatDate(r.nextPull.pullDate)}` : "–"}{r.overdue > 0 && <Badge tone="danger" className="ml-1">{r.overdue} overdue</Badge>}</td>
                <td className="px-4 py-2"><Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status}</Badge>{r.oos > 0 && <Badge tone="danger" className="ml-1">{r.oos} OOS</Badge>}</td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No studies yet.</td></tr>}
          </tbody>
        </table></div>
      </Card>
      {creating && <NewStudy onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewStudy({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", itemId: "", itemLabel: "", batchNo: "", protocolNo: "", kind: "long_term", condition: "2", startDate: "", timePoints: "0, 3, 6, 9, 12, 18, 24, 36", packing: "", claimed: "", tests: [{ name: "Assay", unit: "%", min: "95", max: "105" }, { name: "Total impurities", unit: "%", min: "", max: "1.0" }] });
  const [error, setError] = useState<string | null>(null);
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  async function save() {
    setError(null);
    const c = CONDITIONS[Number(f.condition)];
    try {
      await api("/pharma/stability", { body: { code: f.code, itemId: f.itemId, batchNo: f.batchNo, protocolNo: f.protocolNo || null, kind: f.kind, temperatureC: c.t, humidityPct: c.h, packing: f.packing || null, startDate: f.startDate, timePoints: f.timePoints.split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)), tests: f.tests.filter((t) => t.name).map((t) => ({ name: t.name, unit: t.unit || null, min: n(t.min), max: n(t.max) })), claimedShelfLifeMonths: f.claimed ? Number(f.claimed) : null } });
      qc.invalidateQueries({ queryKey: ["/pharma/stability"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title="New stability study" footer={<Button disabled={!f.code || !f.itemId || !f.batchNo || !f.startDate} onClick={save}>Create</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Study code" placeholder="Study code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Batch" placeholder="Batch" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
          <Input aria-label="Protocol" placeholder="Protocol no." value={f.protocolNo} onChange={(e) => setF({ ...f, protocolNo: e.target.value })} />
        </div>
        {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Product" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
        <div className="grid gap-2 sm:grid-cols-3">
          <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Condition" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{CONDITIONS.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}</Select>
          <Input type="date" aria-label="Start date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input className="sm:col-span-2" aria-label="Time points (months)" value={f.timePoints} onChange={(e) => setF({ ...f, timePoints: e.target.value })} />
          <Input type="number" aria-label="Claimed shelf life (months)" placeholder="Claimed shelf life, months" value={f.claimed} onChange={(e) => setF({ ...f, claimed: e.target.value })} />
        </div>
        <Input aria-label="Packing" placeholder="Packing (e.g. Alu-PVC blister)" value={f.packing} onChange={(e) => setF({ ...f, packing: e.target.value })} />
        <fieldset className="space-y-1">
          <legend className="font-medium">Tests and specifications</legend>
          {f.tests.map((t, i) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" aria-label="Test" value={t.name} onChange={(e) => setF({ ...f, tests: f.tests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input className="w-16" aria-label="Unit" value={t.unit} onChange={(e) => setF({ ...f, tests: f.tests.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} />
              <Input className="w-20" type="number" step="any" aria-label="Minimum" placeholder="Min" value={t.min} onChange={(e) => setF({ ...f, tests: f.tests.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} />
              <Input className="w-20" type="number" step="any" aria-label="Maximum" placeholder="Max" value={t.max} onChange={(e) => setF({ ...f, tests: f.tests.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setF({ ...f, tests: [...f.tests, { name: "", unit: "", min: "", max: "" }] })}>Add test</Button>
        </fieldset>
      </div>
    </Dialog>
  );
}
