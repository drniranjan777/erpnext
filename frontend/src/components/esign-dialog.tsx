"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api";

/**
 * Electronic signature: the person re-enters their password; the meaning is shown, and a reason
 * can be required. `onSign` gets the password (and reason) and does the signed action.
 */
export function ESignDialog({ meaning, reasonRequired, reasonLabel = "Reason", onSign, onClose, children }: { meaning: string; reasonRequired?: boolean; reasonLabel?: string; onSign: (password: string, reason: string) => Promise<unknown>; onClose: () => void; children?: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function sign() {
    setError(null);
    setBusy(true);
    try {
      await onSign(password, reason);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Electronic signature" description={`You are signing: ${meaning}. Your name, the date and time, and this meaning are recorded with the record.`} footer={<Button loading={busy} disabled={!password || (reasonRequired && reason.trim().length < 3)} onClick={sign}>Sign</Button>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); sign(); }}>
        {error && <Alert>{error}</Alert>}
        {children}
        {reasonRequired !== undefined && <Field label={reasonLabel} required={reasonRequired}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
        <Field label="Your password" required>{(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}
