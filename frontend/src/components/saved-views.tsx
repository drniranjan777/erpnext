"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

type Filters = Record<string, string | number | boolean | null>;

interface SavedView {
  id: string;
  name: string;
  filters: Filters;
  isShared: boolean;
  mine: boolean;
  owner: string | null;
}

/** Chips for saved list filters + "Save view". `entity` scopes views to one list. */
export function SavedViews({ entity, current, onApply }: { entity: string; current: Filters; onApply: (f: Filters) => void }) {
  const qc = useQueryClient();
  const key = ["saved-views", entity];
  const views = useQuery({ queryKey: key, queryFn: () => api<SavedView[]>("/saved-views", { query: { entity } }) });
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  const create = useMutation({
    mutationFn: () => api("/saved-views", { body: { entity, name, filters: current, isShared: shared } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setSaving(false);
      setName("");
      setShared(false);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/saved-views/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const same = (f: Filters) => JSON.stringify(normalise(f)) === JSON.stringify(normalise(current));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bookmark className="size-4 text-muted" aria-hidden />
      {views.data?.map((v) => (
        <span
          key={v.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
            same(v.filters) ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface hover:bg-surface-muted",
          )}
        >
          <button onClick={() => onApply(v.filters)} title={v.isShared && !v.mine ? `Shared by ${v.owner}` : undefined}>
            {v.isShared && <Users className="mr-1 inline size-3" aria-label="Shared" />}
            {v.name}
          </button>
          {v.mine && (
            <button onClick={() => confirm(`Delete view "${v.name}"?`) && remove.mutate(v.id)} aria-label={`Delete view ${v.name}`} className="text-muted hover:text-danger">
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <button onClick={() => setSaving(true)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft">
        <BookmarkPlus className="size-3.5" aria-hidden /> Save view
      </button>
      {saving && (
        <Dialog
          open
          onClose={() => setSaving(false)}
          title="Save current filters as a view"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
                Save view
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="View name" required>
              {(p) => <Input {...p} placeholder="e.g. Urgent, pending approval" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Checkbox label="Share with everyone in the workspace" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

function normalise(f: Filters) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== "").sort(([a], [b]) => a.localeCompare(b)));
}
