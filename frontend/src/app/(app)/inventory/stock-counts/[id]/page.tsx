"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  EyeOff,
  Loader2,
  PackagePlus,
  Printer,
  ScanLine,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import {
  ActivityFeed,
  ApprovalProgress,
  StatusBadge,
  Tabs,
} from "@/components/documents/document-parts";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import {
  INVENTORY_KEY,
  SC_API,
  SC_ROUTE,
  scKeys,
  type StockCount,
  type StockCountLine,
} from "@/lib/inventory";
import { cn } from "@/lib/cn";

type Filter = "all" | "uncounted" | "differences";
const SHOW = 400;

export default function StockCountPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const sc = useQuery({
    queryKey: scKeys.detail(id),
    queryFn: () => api<StockCount>(`${SC_API}/${id}`),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"activity" | "approval">("activity");
  const [adding, setAdding] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const d = sc.data;
  const lines = useMemo(() => {
    if (!d) return [];
    const t = search.trim().toLowerCase();
    return d.lines.filter((l) => {
      if (filter === "uncounted" && l.countedQty !== null) return false;
      if (
        filter === "differences" &&
        (!l.difference || Number(l.difference) === 0)
      )
        return false;
      if (!t) return true;
      return (
        l.itemCode.toLowerCase().includes(t) ||
        l.itemName.toLowerCase().includes(t) ||
        (l.batchNo ?? "").toLowerCase().includes(t)
      );
    });
  }, [d, filter, search]);

  if (sc.isLoading) return <LoadingBlock />;
  if (sc.error) return <ErrorBlock error={sc.error} />;
  const doc = d!;
  const counting = doc.can.edit;
  const counted = doc.lines.filter((l) => l.countedQty !== null).length;

  const focusLine = (lineId: string | undefined) => {
    if (!lineId) return;
    const el = inputs.current.get(lineId);
    el?.focus();
    el?.select();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link
          href={SC_ROUTE}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Stock counts
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{doc.displayNumber}</h1>
              <StatusBadge status={doc.status} />
              {doc.blind && (
                <Badge>
                  <EyeOff className="mr-1 inline size-3" aria-hidden />
                  Blind
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {doc.warehouse.code} · {doc.warehouse.name}
              {doc.itemGroup && ` · ${doc.itemGroup.name}`} · sheet taken{" "}
              {formatDateTime(doc.snapshotAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Link
              href={`/print/stock-counts/${doc.id}`}
              target="_blank"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
            >
              <Printer className="size-4" aria-hidden /> Count sheet
            </Link>
            <DocumentActions
              doc={doc}
              apiBase={SC_API}
              routeBase={SC_ROUTE}
              queryKey={scKeys.detail(id)}
              hideEdit
            />
          </div>
        </div>
      </div>

      {doc.status === "approved" && (
        <Alert tone="success">
          Posted on {formatDateTime(doc.approvedAt)}. Book stock now matches the
          counted quantities. Cancelling reverses the adjustments.
        </Alert>
      )}
      {doc.status === "pending_approval" && (
        <Alert tone="warning">
          Waiting for approval. Differences are posted against the book quantity
          at the moment of approval.
        </Alert>
      )}
      {doc.status === "rejected" && (
        <Alert>
          Sent back. Recount the lines in question and submit again.
        </Alert>
      )}
      {doc.status === "cancelled" && (
        <Alert tone="warning">
          Cancelled on {formatDateTime(doc.cancelledAt)}: {doc.cancelReason}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat
          label="Counted"
          value={`${counted} / ${doc.lines.length}`}
          progress={doc.lines.length ? counted / doc.lines.length : 0}
        />
        <Stat
          label="Lines with a difference"
          value={
            doc.stats.withDifference === null
              ? "Hidden"
              : String(doc.stats.withDifference)
          }
        />
        <Stat
          label={
            doc.stats.estimated ? "Shortage (est.)" : "Shortage written off"
          }
          value={
            doc.stats.shortageValue === null
              ? "Hidden"
              : formatMoney(doc.stats.shortageValue)
          }
          tone="danger"
        />
        <Stat
          label={doc.stats.estimated ? "Excess (est.)" : "Excess taken in"}
          value={
            doc.stats.excessValue === null
              ? "Hidden"
              : formatMoney(doc.stats.excessValue)
          }
          tone="success"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative w-full sm:w-80">
            <ScanLine
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Scan or type item code, name or batch"
              aria-label="Find a line"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusLine(lines[0]?.id);
                }
              }}
            />
          </div>
          <div className="flex gap-1">
            {(["all", "uncounted", "differences"] as Filter[]).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "secondary" : "ghost"}
                onClick={() => setFilter(f)}
                disabled={f === "differences" && doc.bookHidden}
              >
                {f === "all"
                  ? "All"
                  : f === "uncounted"
                    ? "Not counted"
                    : "Differences"}
              </Button>
            ))}
          </div>
          {counting && (
            <Button
              size="sm"
              variant="secondary"
              className="sm:ml-auto"
              onClick={() => setAdding(true)}
            >
              <PackagePlus className="size-4" aria-hidden /> Add found stock
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-12 px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Batch</th>
                <th className="px-3 py-2 text-right font-medium">Book</th>
                <th className="w-36 px-3 py-2 text-right font-medium">
                  Counted
                </th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.slice(0, SHOW).map((l, i) => (
                <LineRow
                  key={l.id}
                  countId={doc.id}
                  line={l}
                  editable={counting}
                  register={(el) =>
                    el
                      ? inputs.current.set(l.id, el)
                      : inputs.current.delete(l.id)
                  }
                  onNext={() => focusLine(lines[i + 1]?.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {lines.length > SHOW && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            Showing {SHOW} of {lines.length} lines. Search or filter to find the
            rest.
          </p>
        )}
        {!lines.length && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No lines match.
          </p>
        )}
      </Card>

      <Card>
        <div className="px-5 pt-2">
          <Tabs
            tabs={[
              { value: "activity", label: "Activity" },
              { value: "approval", label: "Approval" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <div className="px-5 py-4">
          {tab === "activity" ? (
            <ActivityFeed documentId={doc.id} />
          ) : (
            <ApprovalProgress steps={doc.approvals} />
          )}
        </div>
      </Card>

      <AddFoundDialog
        open={adding}
        countId={doc.id}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: scKeys.detail(id) });
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  progress,
  tone,
}: {
  label: string;
  value: string;
  progress?: number;
  tone?: "danger" | "success";
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </Card>
  );
}

/** One sheet line. Saves on blur / Enter and patches the cached sheet (no full reload per line). */
function LineRow({
  countId,
  line: l,
  editable,
  register,
  onNext,
}: {
  countId: string;
  line: StockCountLine;
  editable: boolean;
  register: (el: HTMLInputElement | null) => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(
    l.countedQty === null ? "" : String(Number(l.countedQty)),
  );
  const [remarks, setRemarks] = useState(l.remarks ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { countedQty: string | null; remarks?: string }) =>
      api(`${SC_API}/${countId}/counts`, {
        body: { lines: [{ id: l.id, ...body }] },
      }),
    onSuccess: (_r, body) => {
      setErr(null);
      qc.setQueryData<StockCount>(
        scKeys.detail(countId),
        (old) =>
          old && {
            ...old,
            lines: old.lines.map((x) => {
              if (x.id !== l.id) return x;
              const countedQty =
                body.countedQty === null
                  ? null
                  : Number(body.countedQty).toFixed(4);
              const difference =
                countedQty !== null && x.systemQty !== null
                  ? (Number(countedQty) - Number(x.systemQty)).toFixed(4)
                  : null;
              const varianceValue =
                difference !== null && x.rate
                  ? (Number(difference) * Number(x.rate)).toFixed(2)
                  : null;
              return {
                ...x,
                countedQty,
                difference,
                varianceValue,
                remarks: body.remarks ?? x.remarks,
              };
            }),
          },
      );
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Not saved"),
  });

  const commitQty = () => {
    const v = qty.trim();
    const current = l.countedQty === null ? "" : String(Number(l.countedQty));
    if (v === current) return;
    if (v !== "" && !/^\d+(\.\d{1,4})?$/.test(v))
      return setErr("Enter a number");
    if (v !== "" && l.uomDecimals === 0 && !/^\d+$/.test(v))
      return setErr("Whole units only");
    save.mutate({ countedQty: v === "" ? null : v });
  };
  const diff = l.difference === null ? null : Number(l.difference);

  return (
    <tr className={cn(l.countedQty === null && "bg-surface-muted/40")}>
      <td className="px-3 py-2 tabular-nums text-muted">{l.lineNo}</td>
      <td className="px-3 py-2">
        <span className="font-mono text-xs text-muted">{l.itemCode}</span>{" "}
        {l.itemName}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs">
        {l.batchNo ? (
          <span className="font-mono">{l.batchNo}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
        {l.expiryDate && (
          <span className="block text-muted">
            exp {formatDate(l.expiryDate)}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">
        {l.systemQty === null ? "•••" : formatQty(l.systemQty)}{" "}
        <span className="text-xs">{l.uom}</span>
      </td>
      <td className="px-3 py-1.5">
        {editable ? (
          <div className="flex items-center gap-1.5">
            <Input
              ref={register}
              inputMode="decimal"
              className={cn(
                "h-9 text-right tabular-nums",
                err && "border-danger",
              )}
              aria-label={`Counted quantity, line ${l.lineNo}`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitQty();
                  onNext();
                }
              }}
            />
            <span className="w-4">
              {save.isPending ? (
                <Loader2
                  className="size-4 animate-spin text-muted"
                  aria-label="Saving"
                />
              ) : save.isSuccess && !err ? (
                <Check className="size-4 text-success" aria-label="Saved" />
              ) : null}
            </span>
          </div>
        ) : (
          <p className="text-right tabular-nums">
            {l.countedQty === null ? (
              <span className="text-muted">not counted</span>
            ) : (
              formatQty(l.countedQty)
            )}
          </p>
        )}
        {err && <p className="mt-0.5 text-right text-xs text-danger">{err}</p>}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2 text-right tabular-nums",
          diff !== null && diff < 0 && "text-danger",
          diff !== null && diff > 0 && "text-success",
        )}
      >
        {diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatQty(diff)}`}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {l.varianceValue === null ? "—" : formatMoney(l.varianceValue)}
      </td>
      <td className="px-3 py-1.5">
        {editable ? (
          <Input
            className="h-9 text-xs"
            aria-label={`Remarks, line ${l.lineNo}`}
            placeholder="Location, condition…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            onBlur={() =>
              remarks !== (l.remarks ?? "") &&
              save.mutate({
                countedQty:
                  l.countedQty === null ? null : String(Number(l.countedQty)),
                remarks,
              })
            }
          />
        ) : (
          <span className="text-xs text-muted">{l.remarks}</span>
        )}
      </td>
    </tr>
  );
}

function AddFoundDialog({
  open,
  countId,
  onClose,
  onAdded,
}: {
  open: boolean;
  countId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const qc = useQueryClient();
  const [item, setItem] = useState<PickedItem | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [qty, setQty] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setItem(null);
    setBatchNo("");
    setMfgDate("");
    setExpiryDate("");
    setQty("");
    setErrors({});
    setError(null);
    onClose();
  };

  async function add() {
    if (!item) return;
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api(`${SC_API}/${countId}/lines`, {
        body: {
          itemId: item.id,
          batchNo: batchNo || null,
          mfgDate: mfgDate || null,
          expiryDate: expiryDate || null,
          countedQty: qty || null,
        },
      });
      qc.invalidateQueries({ queryKey: INVENTORY_KEY });
      close();
      onAdded();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add found stock"
      description="Stock on the shelf that isn't on the sheet: another batch, or an item the books don't show here."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={add} loading={busy} disabled={!item}>
            Add line
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {item ? (
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
            <span>
              <span className="font-mono text-xs text-muted">{item.code}</span>{" "}
              {item.name}
            </span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setItem(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <ItemPicker
            stockOnly
            onPick={setItem}
            placeholder="Scan or search the item"
          />
        )}
        {errors.itemId && (
          <p className="text-xs text-danger">{errors.itemId}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Batch no."
            error={errors.batchNo}
            hint="For batch-tracked items"
          >
            {(p) => (
              <Input
                {...p}
                className="uppercase"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
              />
            )}
          </Field>
          <Field label="Counted quantity" error={errors.countedQty}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
          </Field>
          <Field label="Mfg date" error={errors.mfgDate}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={mfgDate}
                onChange={(e) => setMfgDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Expiry" error={errors.expiryDate}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
