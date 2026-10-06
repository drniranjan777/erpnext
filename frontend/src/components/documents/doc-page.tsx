import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/documents/document-parts";
import { Alert } from "@/components/ui/card";
import { formatDateTime } from "@/components/ui/page";
import type { DocumentHeader } from "@/lib/documents";

/** Back link, number + status (+ extra badges), subtitle and action buttons. */
export function DocPageHeader({ doc, back, badges, subtitle, actions }: { doc: DocumentHeader; back: { href: string; label: string }; badges?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div>
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {back.label}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{doc.displayNumber}</h1>
            <StatusBadge status={doc.status} />
            {badges}
          </div>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** The usual rejected / cancelled / waiting-for-you banners. */
export function DocStatusAlerts({ doc, approvedNote }: { doc: DocumentHeader; approvedNote?: string }) {
  return (
    <>
      {doc.status === "approved" && approvedNote && <Alert tone="success">{approvedNote}</Alert>}
      {doc.status === "rejected" && <Alert>Rejected. Edit and resubmit, or cancel it. See the activity for the reason.</Alert>}
      {doc.status === "cancelled" && (
        <Alert tone="warning">
          Cancelled on {formatDateTime(doc.cancelledAt)}: {doc.cancelReason}
        </Alert>
      )}
      {doc.can.approve && <Alert tone="warning">This document is waiting for your approval.</Alert>}
    </>
  );
}

export function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono" : ""}`}>{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}
