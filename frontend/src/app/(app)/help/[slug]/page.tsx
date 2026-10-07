"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, Card } from "@/components/ui/card";
import { HELP_ARTICLES } from "@/lib/help";

export default function HelpArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const a = HELP_ARTICLES.find((x) => x.slug === slug);
  if (!a) return <Alert>That help article does not exist. <Link className="underline" href="/help">Back to help</Link></Alert>;
  const others = HELP_ARTICLES.filter((x) => x.area === a.area && x.slug !== a.slug);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/help" className="text-sm text-muted hover:text-foreground">← Help centre</Link>
        <h1 className="mt-2 text-2xl font-semibold">{a.title}</h1>
        <p className="mt-1 text-muted">{a.summary}</p>
      </div>
      <Card className="space-y-5 p-6 text-[15px] leading-relaxed">
        {a.sections.map((s, i) => (
          <section key={i} className="space-y-2">
            {s.heading && <h2 className="font-semibold">{s.heading}</h2>}
            {s.text && <p>{s.text}</p>}
            {s.steps && (
              <ol className="list-decimal space-y-1.5 pl-5">
                {s.steps.map((st) => <li key={st}>{st}</li>)}
              </ol>
            )}
          </section>
        ))}
        {a.links && a.links.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {a.links.map((l) => <Link key={l.href} href={l.href} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:border-primary hover:text-primary">{l.label} →</Link>)}
          </div>
        )}
      </Card>
      {others.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-muted">More on {a.area.toLowerCase()}</p>
          <ul className="space-y-1 text-sm">{others.map((o) => <li key={o.slug}><Link className="text-primary hover:underline" href={`/help/${o.slug}`}>{o.title}</Link></li>)}</ul>
        </div>
      )}
    </div>
  );
}
