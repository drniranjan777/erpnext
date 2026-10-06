import { Injectable } from '@nestjs/common';
import { documents, goodsReceipts, items, jobCards, parties, qualityInspections, workCenters, workOrderOperations, workOrders } from '@nextgen/database';
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Monday of the ISO week a date falls in. */
export const weekOf = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return addDays(d, -((t.getUTCDay() + 6) % 7));
};
const pct = (rej: number, total: number) => (total > 0 ? Math.round((rej / total) * 10000) / 100 : 0);

export interface RejectFact {
  date: string;
  workCenter: string;
  item: string;
  reason: string;
  processed: number;
  rejected: number;
  cost: number;
}

export interface Alert {
  severity: 'warning' | 'info';
  message: string;
}

/** Totals, breakdowns, the weekly trend and plain-language alerts from reject facts. */
export function analyse(facts: RejectFact[], supplier: { vendor: string; inspected: number; rejected: number; lots: number }[]) {
  const group = (key: (f: RejectFact) => string) => {
    const m = new Map<string, { processed: number; rejected: number; cost: number }>();
    for (const f of facts) {
      const g = m.get(key(f)) ?? { processed: 0, rejected: 0, cost: 0 };
      g.processed += f.processed;
      g.rejected += f.rejected;
      g.cost += f.cost;
      m.set(key(f), g);
    }
    return [...m.entries()].map(([k, g]) => ({ key: k, ...g, rate: pct(g.rejected, g.processed) }));
  };
  const processed = facts.reduce((s, f) => s + f.processed, 0);
  const rejected = facts.reduce((s, f) => s + f.rejected, 0);
  const byWorkCenter = group((f) => f.workCenter).sort((x, y) => y.rate - x.rate);
  const byItem = group((f) => f.item).sort((x, y) => y.rejected - x.rejected);
  const weekly = group((f) => weekOf(f.date)).sort((x, y) => x.key.localeCompare(y.key));
  const reasons = new Map<string, number>();
  for (const f of facts) if (f.rejected > 0) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + f.rejected);
  let running = 0;
  const byReason = [...reasons.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([reason, qty]) => {
      running += qty;
      return { reason, qty, share: pct(qty, rejected), cumulative: pct(running, rejected) };
    });

  const alerts: Alert[] = [];
  // A work centre whose latest week runs at twice its earlier rate.
  const lastWeek = weekly.at(-1)?.key;
  if (lastWeek && weekly.length > 1) {
    for (const wc of byWorkCenter) {
      const mine = facts.filter((f) => f.workCenter === wc.key);
      const last = mine.filter((f) => weekOf(f.date) === lastWeek);
      const before = mine.filter((f) => weekOf(f.date) < lastWeek);
      const lr = last.reduce((s, f) => s + f.rejected, 0);
      const lp = last.reduce((s, f) => s + f.processed, 0);
      const br = before.reduce((s, f) => s + f.rejected, 0);
      const bp = before.reduce((s, f) => s + f.processed, 0);
      const lastRate = pct(lr, lp);
      const beforeRate = pct(br, bp);
      if (lr >= 5 && bp > 0 && lastRate >= Math.max(2 * beforeRate, beforeRate + 2)) {
        alerts.push({ severity: 'warning', message: `${wc.key}: rejects ran at ${lastRate}% in the week of ${lastWeek}, against ${beforeRate}% before.` });
      }
    }
  }
  if (byReason[0] && byReason[0].share >= 50 && rejected >= 5) {
    alerts.push({ severity: 'info', message: `“${byReason[0].reason}” is ${byReason[0].share}% of all rejects; fixing that one cause would roughly halve scrap.` });
  }
  const recent = weekly.slice(-4);
  if (recent.length === 4 && recent.every((w, i) => i === 0 || w.rate > recent[i - 1].rate) && recent[3].rate > 0) {
    alerts.push({ severity: 'warning', message: `The reject rate has risen four weeks running, to ${recent[3].rate}%.` });
  }
  for (const s of supplier) {
    const rate = pct(s.rejected, s.inspected);
    if (s.lots >= 2 && rate > 5) alerts.push({ severity: 'warning', message: `${s.vendor}: ${rate}% of inspected material rejected over ${s.lots} lots.` });
  }

  return {
    totals: { processed, rejected, rate: pct(rejected, processed), cost: Math.round(facts.reduce((s, f) => s + f.cost, 0) * 100) / 100 },
    byWorkCenter,
    byItem: byItem.slice(0, 10),
    byReason,
    weekly,
    supplier: supplier.map((s) => ({ ...s, rate: pct(s.rejected, s.inspected) })).sort((x, y) => y.rate - x.rate),
    alerts,
  };
}

/**
 * Scrap trends: rejects booked on job cards and in in-process / final inspections, by work
 * centre, item, reason (Pareto) and week, with what they cost at standard; supplier rejections
 * from incoming inspection.
 */
@Injectable()
export class ScrapInsightsService {
  constructor(private readonly database: DatabaseService) {}

  report(auth: AuthContext, q: { from?: string; to?: string }) {
    const to = q.to ?? todayIST();
    const from = q.from ?? addDays(to, -83);
    return this.database.run(auth, async (tx) => {
      const istDate = sql<string>`to_char((${jobCards.endedAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`;
      const cards = await tx
        .select({ date: istDate, workCenter: workCenters.code, item: items.code, reason: jobCards.rejectReason, good: jobCards.goodQty, reject: jobCards.rejectQty, std: workOrders.stdUnitCost, itemStd: items.standardCost })
        .from(jobCards)
        .innerJoin(workOrderOperations, eq(workOrderOperations.id, jobCards.operationId))
        .innerJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId))
        .innerJoin(workOrders, eq(workOrders.id, jobCards.workOrderId))
        .innerJoin(items, eq(items.id, workOrders.itemId))
        .where(and(eq(jobCards.status, 'done'), isNotNull(jobCards.endedAt), sql`${istDate} >= ${from}`, sql`${istDate} <= ${to}`));
      const unit = (std: string | null, itemStd: string | null) => Number(std) || Number(itemStd) || 0;
      const facts: RejectFact[] = cards.map((c) => ({
        date: c.date,
        workCenter: c.workCenter,
        item: c.item,
        reason: c.reason?.trim() || 'No reason given',
        processed: Number(c.good) + Number(c.reject),
        rejected: Number(c.reject),
        cost: Number(c.reject) * unit(c.std, c.itemStd),
      }));

      // Rejections found by in-process and final inspection (beyond what the cards recorded).
      const qis = await tx
        .select({ date: documents.docDate, stage: qualityInspections.stage, item: items.code, rejected: qualityInspections.rejectedQty, rework: qualityInspections.reworkQty, workCenter: workCenters.code, std: workOrders.stdUnitCost, itemStd: items.standardCost })
        .from(qualityInspections)
        .innerJoin(documents, eq(documents.id, qualityInspections.id))
        .innerJoin(items, eq(items.id, qualityInspections.itemId))
        .leftJoin(workOrders, eq(workOrders.id, qualityInspections.workOrderId))
        .leftJoin(workOrderOperations, eq(workOrderOperations.id, qualityInspections.operationId))
        .leftJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId))
        .where(and(eq(documents.status, 'approved'), inArray(qualityInspections.stage, ['in_process', 'final']), gte(documents.docDate, from), lt(documents.docDate, addDays(to, 1))));
      for (const r of qis) {
        const out = Number(r.rejected) + Number(r.rework);
        if (!out) continue;
        facts.push({ date: r.date, workCenter: r.workCenter ?? (r.stage === 'final' ? 'Final inspection' : 'Inspection'), item: r.item, reason: `Failed ${r.stage === 'final' ? 'final' : 'in-process'} inspection`, processed: 0, rejected: out, cost: Number(r.rejected) * unit(r.std, r.itemStd) });
      }

      const incoming = await tx
        .select({ vendor: parties.name, lot: qualityInspections.lotQty, rejected: qualityInspections.rejectedQty, rework: qualityInspections.reworkQty })
        .from(qualityInspections)
        .innerJoin(documents, eq(documents.id, qualityInspections.id))
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, qualityInspections.sourceDocId))
        .innerJoin(parties, eq(parties.id, goodsReceipts.vendorId))
        .where(and(eq(documents.status, 'approved'), eq(qualityInspections.stage, 'incoming'), gte(documents.docDate, from), lt(documents.docDate, addDays(to, 1))));
      const supplier = new Map<string, { vendor: string; inspected: number; rejected: number; lots: number }>();
      for (const r of incoming) {
        const s = supplier.get(r.vendor) ?? { vendor: r.vendor, inspected: 0, rejected: 0, lots: 0 };
        s.inspected += Number(r.lot);
        s.rejected += Number(r.rejected) + Number(r.rework);
        s.lots += 1;
        supplier.set(r.vendor, s);
      }
      return { period: { from, to }, ...analyse(facts, [...supplier.values()]) };
    });
  }
}
