"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { QMS, type Alerts } from "@/lib/qms";

const TILES: { key: keyof Alerts; label: string; href: string; tone: "danger" | "warning" }[] = [
  { key: "calibrationOverdue", label: "Gauges overdue for calibration", href: "/quality/calibration", tone: "danger" },
  { key: "calibrationDue", label: "Calibrations due in 15 days", href: "/quality/calibration", tone: "warning" },
  { key: "capaActionsOverdue", label: "CAPA actions overdue", href: "/quality/capas", tone: "danger" },
  { key: "deviationsExpired", label: "Planned deviations past their date", href: "/quality/deviations", tone: "danger" },
  { key: "mySopsToRead", label: "SOPs you still have to read", href: "/quality/sops", tone: "warning" },
  { key: "sopReviewsDue", label: "SOP reviews due in 30 days", href: "/quality/sops", tone: "warning" },
  { key: "retainsDue", label: "Retain samples to dispose of", href: "/quality/retain-samples", tone: "warning" },
  { key: "licencesExpired", label: "Licences expired", href: "/hse", tone: "danger" },
  { key: "licencesToRenew", label: "Licences to renew", href: "/hse", tone: "warning" },
  { key: "incidentsOpen", label: "HSE incidents open", href: "/hse", tone: "warning" },
  { key: "wasteStoredTooLong", label: "Hazardous waste stored over 90 days", href: "/hse", tone: "danger" },
];

export default function QualityCockpit() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [QMS, "alerts"], queryFn: () => api<Alerts>(`${QMS}/alerts`), enabled: can("quality.inspections.read") });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Quality and compliance" description="What needs attention across calibration, CAPA, deviations, SOP training, retain samples, licences and HSE." />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((t) => {
            const n = q.data![t.key];
            return (
              <Link key={t.key} href={t.href}>
                <Card className={`p-4 transition hover:shadow-md ${n ? (t.tone === "danger" ? "border-danger" : "border-warning") : ""}`}>
                  <p className={`text-3xl font-semibold tabular-nums ${n ? (t.tone === "danger" ? "text-danger" : "text-warning") : "text-muted"}`}>{n}</p>
                  <p className="text-sm text-muted">{t.label}</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
