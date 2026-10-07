import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/documents";

export interface NextAction {
  action: string;
  label: string;
  why: string;
  by: string | null;
  urgency: "now" | "soon" | "later";
}

export interface LeadInsight {
  score: number;
  grade: string;
  summary: string;
  missing: string[];
  nextAction: NextAction;
}

const TONE = { now: "danger", soon: "warning", later: "neutral" } as const;

/** Rule-based suggestion shown at the top of a lead or opportunity. */
export function NextActionCard({ next, summary, missing }: { next: NextAction; summary?: string; missing?: string[] }) {
  if (next.action === "none" && !summary) return null;
  return (
    <Card className="flex gap-3 border-primary/30 bg-primary/5 px-5 py-3 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="space-y-1">
        {summary && <p>{summary}</p>}
        {next.action !== "none" && (
          <p>
            <span className="font-medium">Next: {next.label}</span>
            {next.by && <span className="text-muted"> by {formatDate(next.by)}</span>} <Badge tone={TONE[next.urgency]}>{next.urgency}</Badge>
            <span className="block text-xs text-muted">{next.why}</span>
          </p>
        )}
        {missing && missing.length > 0 && <p className="text-xs text-muted">Would raise the score: {missing.join(" · ")}</p>}
      </div>
    </Card>
  );
}
