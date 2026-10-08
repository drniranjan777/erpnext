"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { DataTable } from "@/components/ui/data-table";

interface Stats {
  days: number;
  byOutcome: { lang: string; command: string | null; outcome: string; n: number }[];
  fieldAccuracyPct: number | null;
  evalSet: { cases: number; accuracyPct: number; byLanguage: Record<string, number | null>; failures: { text: string; misses: string[] }[] };
  languages: { code: string; name: string }[];
}

const tone = (p: number | null) => (p === null ? "neutral" : p >= 90 ? "success" : p >= 75 ? "warning" : "danger");

/** How well voice commands are understood: on the fixed evaluation set and in real use. */
export default function VoiceStatsPage() {
  const q = useQuery({ queryKey: ["/voice/stats"], queryFn: () => api<Stats>("/voice/stats", { query: { days: 30 } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const s = q.data!;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Voice commands" description="Tap the microphone on any screen and speak: production orders, requisitions and stock questions are understood in English, Hindi and Hinglish; other questions go to the copilot. The target is 90 % accuracy." />
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Evaluation set</p><p className="text-2xl font-semibold"><Badge tone={tone(s.evalSet.accuracyPct)}>{s.evalSet.accuracyPct} %</Badge></p><p className="text-xs text-muted">{s.evalSet.cases} phrases</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">English</p><p className="text-2xl font-semibold">{s.evalSet.byLanguage.en ?? "–"} %</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Hindi / Hinglish</p><p className="text-2xl font-semibold">{s.evalSet.byLanguage.hi ?? "–"} % / {s.evalSet.byLanguage.hinglish ?? "–"} %</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">In use (30 days)</p><p className="text-2xl font-semibold">{s.fieldAccuracyPct === null ? "–" : `${s.fieldAccuracyPct} %`}</p><p className="text-xs text-muted">confirmed as heard</p></Card>
      </div>
      {s.evalSet.failures.length > 0 && (
        <Card>
          <CardHeader title="Phrases not yet understood" />
          <ul className="divide-y divide-border border-t border-border text-sm">{s.evalSet.failures.map((f) => <li key={f.text} className="px-5 py-2">“{f.text}” <span className="text-xs text-muted">{f.misses.join("; ")}</span></li>)}</ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Use in the last 30 days" description={`Speech recognition languages: ${s.languages.map((l) => l.name).join(", ")}. Commands in languages other than English and Hindi are understood when an AI key is set.`} />
        <DataTable
          rows={s.byOutcome}
          rowKey={(_r, i) => String(i)}
          exportName="ai-voice"
          storageKey="ai-voice-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No voice commands yet.</p>}
          columns={[
            { key: "language", label: "Language", locked: true, className: "whitespace-normal", render: (r) => <>{r.lang}</> },
            { key: "command", label: "Command", className: "whitespace-normal", render: (r) => <>{r.command ?? "question"}</> },
            { key: "outcome", label: "Outcome", className: "whitespace-normal", render: (r) => <>{r.outcome}</> },
            { key: "times", label: "Times", align: "right", render: (r) => <>{r.n}</> },
          ]}
        />
      </Card>
    </div>
  );
}
