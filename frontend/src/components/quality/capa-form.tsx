"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { EIGHT_D, FISHBONE, FISHBONE_LABEL, QA, type Capa } from "@/lib/quality";

const textarea = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
interface ActionRow { kind: "containment" | "corrective" | "preventive"; action: string; owner: string; dueDate: string }

export function CapaForm({ capa }: { capa?: Capa }) {
  const router = useRouter();
  const [f, setF] = useState({
    kind: capa?.kind ?? "corrective",
    source: capa?.source ?? "internal",
    problem: capa?.problem ?? "",
    method: capa?.method ?? "5why",
    rootCause: capa?.rootCause ?? "",
    effectivenessDue: capa?.effectivenessDue ?? "",
    responseDue: capa?.responseDue ?? "",
    isScar: capa?.isScar ?? false,
  });
  const [party, setParty] = useState<PickedParty | null>(capa?.party ? { id: capa.party.id, code: "", name: capa.party.name, gstin: null, stateCode: null, creditDays: null } : null);
  const [whys, setWhys] = useState<string[]>(capa?.whys.length ? capa.whys : ["", "", ""]);
  const [bone, setBone] = useState<Record<string, string>>(Object.fromEntries(FISHBONE.map((k) => [k, (capa?.fishbone[k] ?? []).join("\n")])));
  const [d8, setD8] = useState<Record<string, string>>(capa?.eightD ? Object.fromEntries(Object.entries(capa.eightD).map(([k, v]) => [k, v ?? ""])) : {});
  const [actions, setActions] = useState<ActionRow[]>(capa?.actions.map((a) => ({ kind: a.kind, action: a.action, owner: a.owner ?? "", dueDate: a.dueDate ?? "" })) ?? [{ kind: "corrective", action: "", owner: "", dueDate: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      kind: f.kind,
      source: f.isScar ? "supplier" : f.source,
      problem: f.problem,
      method: f.method,
      rootCause: f.rootCause || null,
      effectivenessDue: f.effectivenessDue || null,
      responseDue: f.isScar ? f.responseDue || null : null,
      isScar: f.isScar,
      partyId: party?.id ?? null,
      ncrId: capa?.ncr?.id ?? null,
      complaintId: capa?.complaint?.id ?? null,
      itemId: capa?.item?.id ?? null,
      whys: whys.map((w) => w.trim()).filter(Boolean),
      fishbone: Object.fromEntries(Object.entries(bone).map(([k, v]) => [k, v.split("\n").map((x) => x.trim()).filter(Boolean)]).filter(([, v]) => v.length)),
      eightD: Object.fromEntries(Object.entries(d8).filter(([, v]) => v.trim())),
      actions: actions.filter((a) => a.action.trim()).map((a) => ({ ...a, owner: a.owner || null, dueDate: a.dueDate || null })),
    };
    try {
      const r = await api<Capa>(capa ? `${QA}/capas/${capa.id}` : `${QA}/capas`, { method: capa ? "PUT" : "POST", body: capa ? { ...body, version: capa.version } : body });
      router.push(`${QA}/capas/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Type">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}><option value="corrective">Corrective action</option><option value="preventive">Preventive action</option></Select>}</Field>
        <Field label="Raised from">{(p) => <Select {...p} value={f.source} onChange={set("source")} disabled={f.isScar || !!capa?.ncr || !!capa?.complaint}><option value="internal">Internal</option><option value="audit">Audit finding</option><option value="ncr">NCR</option><option value="complaint">Customer complaint</option><option value="supplier">Supplier</option></Select>}</Field>
        <div className="flex items-end pb-2"><Checkbox label="Supplier corrective action request (SCAR)" checked={f.isScar} onChange={(e) => setF({ ...f, isScar: e.target.checked })} /></div>
        {f.isScar && (
          <>
            <Field label="Supplier" required className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role="vendor" value={party} onChange={setParty} />}</Field>
            <Field label="Response due">{(p) => <Input {...p} type="date" value={f.responseDue} onChange={set("responseDue")} />}</Field>
          </>
        )}
        <Field label="Problem" required className="sm:col-span-3">{(p) => <textarea {...p} rows={3} className={textarea} value={f.problem} onChange={set("problem")} />}</Field>
      </Card>
      <Card>
        <CardHeader title="Root cause analysis" action={<Select className="h-9 w-40" aria-label="Method" value={f.method} onChange={set("method")}><option value="5why">5 Why</option><option value="fishbone">Fishbone</option><option value="8d">8D</option></Select>} />
        <div className="space-y-3 border-t border-border p-5">
          {f.method === "5why" && (
            <div className="space-y-2">
              {whys.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted">Why {i + 1}</span>
                  <Input className="h-9" aria-label={`Why ${i + 1}`} value={w} onChange={(e) => setWhys(whys.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
              ))}
              {whys.length < 7 && <Button size="sm" variant="ghost" onClick={() => setWhys([...whys, ""])}><Plus className="size-4" aria-hidden /> Another why</Button>}
            </div>
          )}
          {f.method === "fishbone" && (
            <div className="grid gap-3 sm:grid-cols-3">
              {FISHBONE.map((k) => <Field key={k} label={FISHBONE_LABEL[k]} hint="One cause per line">{(p) => <textarea {...p} rows={3} className={textarea} value={bone[k]} onChange={(e) => setBone({ ...bone, [k]: e.target.value })} />}</Field>)}
            </div>
          )}
          {f.method === "8d" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {EIGHT_D.map(([k, label]) => <Field key={k} label={label}>{(p) => <textarea {...p} rows={2} className={textarea} value={d8[k] ?? ""} onChange={(e) => setD8({ ...d8, [k]: e.target.value })} />}</Field>)}
            </div>
          )}
          <Field label="Root cause" required={!f.isScar}>{(p) => <textarea {...p} rows={2} className={textarea} value={f.rootCause} onChange={set("rootCause")} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Actions" />
        <div className="space-y-2 border-t border-border p-5">
          {actions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select className="h-9 w-36" aria-label="Kind" value={a.kind} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, kind: e.target.value as ActionRow["kind"] } : x)))}><option value="containment">Containment</option><option value="corrective">Corrective</option><option value="preventive">Preventive</option></Select>
              <Input className="h-9 min-w-64 flex-1" aria-label="Action" placeholder="What will be done" value={a.action} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))} />
              <Input className="h-9 w-36" aria-label="Owner" placeholder="Owner" value={a.owner} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))} />
              <Input className="h-9 w-40" type="date" aria-label="Due" value={a.dueDate} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove action" onClick={() => setActions(actions.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setActions([...actions, { kind: "corrective", action: "", owner: "", dueDate: "" }])}><Plus className="size-4" aria-hidden /> Add action</Button>
          <Field label="Check effectiveness by" className="max-w-xs pt-2">{(p) => <Input {...p} type="date" value={f.effectivenessDue} onChange={set("effectivenessDue")} />}</Field>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
