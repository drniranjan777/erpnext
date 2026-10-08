"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomFieldInputs, useCustomFields } from "@/components/custom-fields";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GST_REG_TYPES, gstinProblem, useReference, type Party, type PartyAddress, type PartyBank, type PartyContact } from "@/lib/masters";

const emptyAddress = (): PartyAddress => ({ type: "both", label: null, line1: "", line2: null, city: "", district: null, stateCode: "", pincode: "", country: "IN", gstin: null, isDefault: false });
const emptyContact = (): PartyContact => ({ name: "", designation: null, email: null, phone: null, isPrimary: false });
const emptyBank = (): PartyBank & { accountNumber: string } => ({ accountName: "", accountNumber: "", ifsc: "", bankName: null, branchName: null, isPrimary: false });

/** `onCreateAnother` adds "Save & new": after a create the page starts a fresh form. */
export function PartyEditor({ party, defaultRole, onCreateAnother }: { party?: Party; defaultRole?: "customer" | "vendor"; onCreateAnother?: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const ref = useReference();
  const customDefs = useCustomFields("party");
  const readOnly = !can("masters.parties.manage");
  const [f, setF] = useState(() => ({
    code: party?.code ?? "",
    name: party?.name ?? "",
    legalName: party?.legalName ?? "",
    isCustomer: party?.isCustomer ?? defaultRole !== "vendor",
    isVendor: party?.isVendor ?? defaultRole === "vendor",
    gstRegistrationType: party?.gstRegistrationType ?? "regular",
    gstin: party?.gstin ?? "",
    pan: party?.pan ?? "",
    msmeCategory: party?.msmeCategory ?? "",
    msmeUdyamNo: party?.msmeUdyamNo ?? "",
    email: party?.email ?? "",
    phone: party?.phone ?? "",
    website: party?.website ?? "",
    creditLimit: party?.creditLimit ? String(Number(party.creditLimit)) : "",
    creditDays: party?.creditDays?.toString() ?? "",
    paymentTerms: party?.paymentTerms ?? "",
    tdsSection: party?.tdsSection ?? "",
    tcsApplicable: party?.tcsApplicable ?? false,
    notes: party?.notes ?? "",
    isActive: party?.isActive ?? true,
    addresses: party?.addresses.map(({ state: _s, id: _i, ...a }) => ({ ...a, pincode: a.pincode ?? "" })) ?? [emptyAddress()],
    contacts: party?.contacts ?? [],
    bankAccounts: party?.bankAccounts.map((b) => ({ ...b, accountNumber: "" })) ?? [],
  }));
  const [custom, setCustom] = useState<Record<string, unknown>>(party?.customFields ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const needsGstin = ["regular", "composition", "sez"].includes(f.gstRegistrationType);
  const liveGstin = f.gstin ? gstinProblem(f.gstin) : null;
  const err = (k: string) => errors[k];

  async function save(another = false) {
    setSaving(true);
    setError(null);
    setErrors({});
    const body = {
      ...f,
      code: f.code || undefined,
      gstin: needsGstin ? f.gstin || null : null,
      pan: f.pan || null,
      msmeCategory: f.msmeCategory || null,
      msmeUdyamNo: f.msmeUdyamNo || null,
      creditLimit: f.creditLimit || null,
      creditDays: f.creditDays ? Number(f.creditDays) : null,
      addresses: f.addresses.filter((a) => a.line1.trim()).map((a) => ({ ...a, pincode: a.pincode || null, gstin: a.gstin || null })),
      contacts: f.contacts.filter((c) => c.name.trim()),
      bankAccounts: f.bankAccounts.map((b) => ({
        id: b.id,
        accountName: b.accountName,
        accountNumber: b.accountNumber || undefined,
        ifsc: b.ifsc,
        bankName: b.bankName,
        branchName: b.branchName,
        isPrimary: b.isPrimary,
      })),
      customFields: custom,
      ...(party ? { version: party.version } : {}),
    };
    try {
      const saved = await api<Party>(party ? `/masters/parties/${party.id}` : "/masters/parties", { method: party ? "PUT" : "POST", body });
      qc.invalidateQueries({ queryKey: ["masters", "parties"] });
      if (party) qc.setQueryData(["masters", "party", party.id], saved);
      else if (another && onCreateAnother) {
        toast(`${saved.code} · ${saved.name} created.`);
        window.scrollTo({ top: 0 });
        onCreateAnother();
        return;
      } else router.push(`/masters/parties/${saved.id}`);
      setSaving(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server. Please try again.");
      setSaving(false);
    }
  }

  const states = ref.data?.states ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={party ? `${party.code} · ${party.name}` : "New customer / vendor"}
        actions={
          !readOnly && (
            <>
              <Button variant="ghost" onClick={() => router.push("/masters/parties")}>
                Cancel
              </Button>
              {!party && onCreateAnother && (
                <Button variant="secondary" disabled={saving} onClick={() => save(true)}>
                  Save &amp; new
                </Button>
              )}
              <Button loading={saving} onClick={() => save()}>
                {party ? "Save changes" : "Create"}
              </Button>
            </>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <fieldset disabled={readOnly} className="space-y-6">
        <Card>
          <CardHeader title="Business" />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required error={err("name")} className="sm:col-span-2">
              {(p) => <Input {...p} autoFocus={!party} value={f.name} onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="Code" error={err("code")} hint={party ? undefined : "Auto: CUS00001 / VEN00001"}>
              {(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={(e) => set("code", e.target.value)} />}
            </Field>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <Checkbox label="Customer" checked={f.isCustomer} onChange={(e) => set("isCustomer", e.target.checked)} />
              <Checkbox label="Vendor" checked={f.isVendor} onChange={(e) => set("isVendor", e.target.checked)} />
              {err("isCustomer") && <p className="text-xs text-danger">{err("isCustomer")}</p>}
            </div>
            <Field label="Legal name (as per GST)" className="sm:col-span-2">
              {(p) => <Input {...p} value={f.legalName} onChange={(e) => set("legalName", e.target.value)} />}
            </Field>
            <Field label="Phone" error={err("phone")}>
              {(p) => <Input {...p} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
            </Field>
            <Field label="Email" error={err("email")}>
              {(p) => <Input {...p} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Checkbox label="Active" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} />
            </div>
          </div>
          {!!customDefs.data?.length && (
            <div className="border-t border-border px-5 py-4">
              <CustomFieldInputs
                defs={customDefs.data}
                values={custom}
                errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("customFields.")).map(([k, v]) => [k.slice(13), v]))}
                onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
              />
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="GST & compliance" />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="GST registration">
              {(p) => (
                <Select {...p} value={f.gstRegistrationType} onChange={(e) => set("gstRegistrationType", e.target.value as typeof f.gstRegistrationType)}>
                  {Object.entries(GST_REG_TYPES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {needsGstin && (
              <Field
                label="GSTIN"
                required
                error={err("gstin") ?? liveGstin ?? undefined}
                hint={!liveGstin && f.gstin.length === 15 ? `✓ Valid · ${states.find((st) => st.code === f.gstin.slice(0, 2))?.name ?? ""}` : undefined}
              >
                {(p) => <Input {...p} className="font-mono uppercase" maxLength={15} value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} />}
              </Field>
            )}
            <Field label="PAN" error={err("pan")} hint={needsGstin ? "Taken from the GSTIN if left blank" : undefined}>
              {(p) => <Input {...p} className="font-mono uppercase" maxLength={10} value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} />}
            </Field>
            <Field label="MSME category" hint="MSME vendors must be paid within 45 days (Sec. 43B(h))">
              {(p) => (
                <Select {...p} value={f.msmeCategory} onChange={(e) => set("msmeCategory", e.target.value as typeof f.msmeCategory)}>
                  <option value="">Not MSME / unknown</option>
                  <option value="micro">Micro</option>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                </Select>
              )}
            </Field>
            {f.msmeCategory && (
              <Field label="Udyam registration no." error={err("msmeUdyamNo")}>
                {(p) => <Input {...p} className="font-mono uppercase" placeholder="UDYAM-TS-02-0012345" value={f.msmeUdyamNo} onChange={(e) => set("msmeUdyamNo", e.target.value.toUpperCase())} />}
              </Field>
            )}
            <Field label="TDS section" hint="e.g. 194C, 194Q, 194J">
              {(p) => <Input {...p} value={f.tdsSection} onChange={(e) => set("tdsSection", e.target.value)} />}
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label="TCS applicable" checked={f.tcsApplicable} onChange={(e) => set("tcsApplicable", e.target.checked)} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Credit & payment" />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            <Field label="Credit limit (₹)" error={err("creditLimit")}>
              {(p) => <Input {...p} inputMode="decimal" value={f.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} />}
            </Field>
            <Field label="Credit days" error={err("creditDays")}>
              {(p) => <Input {...p} inputMode="numeric" value={f.creditDays} onChange={(e) => set("creditDays", e.target.value)} />}
            </Field>
            <Field label="Payment terms">
              {(p) => <Input {...p} placeholder="e.g. 30% advance, balance on delivery" value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Addresses" description="The default billing address sets the place of supply when there is no GSTIN." />
          <div className="space-y-4 px-5 py-4">
            {err("addresses") && <p className="text-xs text-danger">{err("addresses")}</p>}
            {f.addresses.map((a, i) => {
              const up = (patch: Partial<PartyAddress>) => set("addresses", f.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-6">
                  <Field label="Type" className="sm:col-span-1">
                    {(p) => (
                      <Select {...p} value={a.type} onChange={(e) => up({ type: e.target.value as PartyAddress["type"] })}>
                        <option value="both">Billing & shipping</option>
                        <option value="billing">Billing</option>
                        <option value="shipping">Shipping</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Address line 1" required error={err(`addresses.${i}.line1`)} className="sm:col-span-3">
                    {(p) => <Input {...p} value={a.line1} onChange={(e) => up({ line1: e.target.value })} />}
                  </Field>
                  <Field label="Label" className="sm:col-span-2">
                    {(p) => <Input {...p} placeholder="e.g. Plant 2" value={a.label ?? ""} onChange={(e) => up({ label: e.target.value })} />}
                  </Field>
                  <Field label="Address line 2" className="sm:col-span-2">
                    {(p) => <Input {...p} value={a.line2 ?? ""} onChange={(e) => up({ line2: e.target.value })} />}
                  </Field>
                  <Field label="City" required error={err(`addresses.${i}.city`)}>
                    {(p) => <Input {...p} value={a.city} onChange={(e) => up({ city: e.target.value })} />}
                  </Field>
                  <Field label="State" required error={err(`addresses.${i}.stateCode`)}>
                    {(p) => (
                      <Select {...p} value={a.stateCode} onChange={(e) => up({ stateCode: e.target.value })}>
                        <option value="">Select…</option>
                        {states.map((st) => (
                          <option key={st.code} value={st.code}>
                            {st.code} · {st.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="PIN code" error={err(`addresses.${i}.pincode`)}>
                    {(p) => <Input {...p} inputMode="numeric" maxLength={6} value={a.pincode ?? ""} onChange={(e) => up({ pincode: e.target.value })} />}
                  </Field>
                  <div className="flex items-end justify-between gap-2 pb-2">
                    <Checkbox label="Default" checked={a.isDefault} onChange={(e) => set("addresses", f.addresses.map((x, j) => ({ ...x, isDefault: j === i ? e.target.checked : false })))} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => set("addresses", f.addresses.filter((_, j) => j !== i))} aria-label="Remove address">
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="secondary" size="sm" onClick={() => set("addresses", [...f.addresses, emptyAddress()])}>
              <Plus className="size-3.5" aria-hidden /> Add address
            </Button>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Contacts" />
            <div className="space-y-3 px-5 py-4">
              {f.contacts.map((c, i) => {
                const up = (patch: Partial<PartyContact>) => set("contacts", f.contacts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                    <Input aria-label="Contact name" placeholder="Name" value={c.name} onChange={(e) => up({ name: e.target.value })} />
                    <Input aria-label="Designation" placeholder="Designation" value={c.designation ?? ""} onChange={(e) => up({ designation: e.target.value })} />
                    <Input aria-label="Phone" aria-invalid={!!err(`contacts.${i}.phone`)} placeholder="Phone" type="tel" value={c.phone ?? ""} onChange={(e) => up({ phone: e.target.value })} />
                    <div className="flex gap-2">
                      <Input aria-label="Email" aria-invalid={!!err(`contacts.${i}.email`)} placeholder="Email" type="email" value={c.email ?? ""} onChange={(e) => up({ email: e.target.value })} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))} aria-label="Remove contact">
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button type="button" variant="secondary" size="sm" onClick={() => set("contacts", [...f.contacts, emptyContact()])}>
                <Plus className="size-3.5" aria-hidden /> Add contact
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Bank accounts" description="Account numbers are encrypted and never shown in full." />
            <div className="space-y-3 px-5 py-4">
              {f.bankAccounts.map((b, i) => {
                const up = (patch: Partial<PartyBank>) => set("bankAccounts", f.bankAccounts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                    <Input aria-label="Account name" placeholder="Account holder name" value={b.accountName} onChange={(e) => up({ accountName: e.target.value })} />
                    <Input
                      aria-label="Account number"
                      aria-invalid={!!err(`bankAccounts.${i}.accountNumber`)}
                      inputMode="numeric"
                      placeholder={b.accountNumberMasked ? `${b.accountNumberMasked} (leave blank to keep)` : "Account number"}
                      value={b.accountNumber ?? ""}
                      onChange={(e) => up({ accountNumber: e.target.value.replace(/\D/g, "") })}
                    />
                    <Input aria-label="IFSC" aria-invalid={!!err(`bankAccounts.${i}.ifsc`)} className="font-mono uppercase" placeholder="IFSC" maxLength={11} value={b.ifsc} onChange={(e) => up({ ifsc: e.target.value.toUpperCase() })} />
                    <div className="flex gap-2">
                      <Input aria-label="Bank name" placeholder="Bank / branch" value={b.bankName ?? ""} onChange={(e) => up({ bankName: e.target.value })} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => set("bankAccounts", f.bankAccounts.filter((_, j) => j !== i))} aria-label="Remove bank account">
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                    {(err(`bankAccounts.${i}.accountNumber`) || err(`bankAccounts.${i}.ifsc`)) && <p className="text-xs text-danger sm:col-span-2">{err(`bankAccounts.${i}.accountNumber`) ?? err(`bankAccounts.${i}.ifsc`)}</p>}
                  </div>
                );
              })}
              <Button type="button" variant="secondary" size="sm" onClick={() => set("bankAccounts", [...f.bankAccounts, emptyBank()])}>
                <Plus className="size-3.5" aria-hidden /> Add bank account
              </Button>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Notes" />
          <div className="px-5 py-4">
            <textarea
              aria-label="Notes"
              rows={3}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </Card>
      </fieldset>
    </div>
  );
}
