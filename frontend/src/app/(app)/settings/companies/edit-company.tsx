"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { gstinProblem, useReference } from "@/lib/masters";
import type { Company } from "@/lib/types";

/** Name, GSTIN and address. The GSTIN sets the state used for GST on every document. */
export function EditCompanyDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  return company ? <EditForm key={company.id} company={company} onClose={onClose} /> : null;
}

function EditForm({ company, onClose }: { company: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useReference();
  const [name, setName] = useState(company.name);
  const [legalName, setLegalName] = useState(company.legalName ?? "");
  const [gstin, setGstin] = useState(company.gstin ?? "");
  const [line1, setLine1] = useState(company.address?.line1 ?? "");
  const [city, setCity] = useState(company.address?.city ?? "");
  const [stateCode, setStateCode] = useState(company.address?.stateCode ?? company.stateCode ?? "");
  const [pincode, setPincode] = useState(company.address?.pincode ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const gstinHint = gstin ? gstinProblem(gstin.toUpperCase()) : null;

  const save = useMutation({
    mutationFn: () =>
      api<Company>(`/org/companies/${company.id}`, {
        method: "PUT",
        body: {
          name,
          legalName: legalName || null,
          gstin: gstin.toUpperCase() || "",
          address: { line1: line1 || null, city: city || null, stateCode: (gstin ? gstin.slice(0, 2) : stateCode) || undefined, pincode: pincode || undefined },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", "companies"] });
      onClose();
    },
    onError: (e) => setErrors(e instanceof ApiError ? e.fieldErrors : {}),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${company.name}`}
      description="The GSTIN decides whether purchases and sales are intra-state (CGST + SGST) or inter-state (IGST)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!!gstinHint || name.trim().length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && (
          <div className="sm:col-span-2">
            <Alert>{save.error instanceof ApiError ? save.error.message : "Could not save."}</Alert>
          </div>
        )}
        <Field label="Name" required error={errors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Legal name" hint="As on the GST certificate" error={errors.legalName}>
          {(p) => <Input {...p} value={legalName} onChange={(e) => setLegalName(e.target.value)} />}
        </Field>
        <Field label="GSTIN" error={errors.gstin ?? gstinHint ?? undefined} hint="State and PAN are taken from it">
          {(p) => <Input {...p} className="font-mono uppercase" maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value.trim())} />}
        </Field>
        <Field label="State" hint={gstin ? "From the GSTIN" : undefined}>
          {(p) => (
            <Select {...p} disabled={!!gstin} value={gstin ? gstin.slice(0, 2) : stateCode} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">Choose…</option>
              {(ref.data?.states ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Address" className="sm:col-span-2" error={errors["address.line1"]}>
          {(p) => <Input {...p} value={line1} onChange={(e) => setLine1(e.target.value)} />}
        </Field>
        <Field label="City" error={errors["address.city"]}>
          {(p) => <Input {...p} value={city} onChange={(e) => setCity(e.target.value)} />}
        </Field>
        <Field label="PIN code" error={errors["address.pincode"]}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
