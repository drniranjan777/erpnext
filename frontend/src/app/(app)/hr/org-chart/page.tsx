"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { HR } from "@/lib/hr";

interface Node { id: string; code: string; fullName: string; reportsToId: string | null; department: string | null; designation: string | null; reports: number }

function Branch({ node, tree, depth }: { node: Node; tree: Map<string, Node[]>; depth: number }) {
  const kids = tree.get(node.id) ?? [];
  return (
    <li>
      <div className="flex items-baseline gap-2 py-1" style={{ paddingLeft: depth * 20 }}>
        <Link href={`${HR}/employees/${node.id}`} className="font-medium hover:underline">{node.fullName}</Link>
        <span className="text-xs text-muted">{[node.designation, node.department].filter(Boolean).join(", ")}{node.reports > 0 && ` · ${node.reports} direct`}</span>
      </div>
      {kids.length > 0 && <ul className="border-l border-border" style={{ marginLeft: depth * 20 + 6 }}>{kids.map((k) => <Branch key={k.id} node={k} tree={tree} depth={1} />)}</ul>}
    </li>
  );
}

export default function OrgChartPage() {
  const q = useQuery({ queryKey: [HR, "org-chart"], queryFn: () => api<Node[]>(`${HR}/org-chart`) });
  const tree = useMemo(() => {
    const rows = q.data ?? [];
    const ids = new Set(rows.map((r) => r.id));
    const children = new Map<string, Node[]>();
    const roots: Node[] = [];
    for (const r of rows) {
      // Anyone whose manager has left (or who has none) starts a tree of their own.
      if (r.reportsToId && ids.has(r.reportsToId)) children.set(r.reportsToId, [...(children.get(r.reportsToId) ?? []), r]);
      else roots.push(r);
    }
    return { roots, children };
  }, [q.data]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Org chart" description="Reporting lines of current employees." />
      <Card className="px-5 py-4 text-sm">
        <ul>{tree.roots.map((r) => <Branch key={r.id} node={r} tree={tree.children} depth={0} />)}</ul>
        {!tree.roots.length && <p className="text-muted">No employees yet.</p>}
      </Card>
    </div>
  );
}
