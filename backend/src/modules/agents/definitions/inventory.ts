import { sql } from 'drizzle-orm';
import { daysOfCover, type AgentDefinition, type Finding } from '../framework';
import { many } from '../../../common/sql';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Real issues: outgoing rows of vouchers that neither brought the item back in (transfers) nor were reversed. */
const ISSUES = sql`l.qty < 0 and not l.is_reversal and not exists (select 1 from stock_ledger r where r.voucher_id = l.voucher_id and r.item_id = l.item_id and (r.qty > 0 or r.is_reversal))`;

/**
 * Inventory agent: stock-out risk from recent usage and lead time, batches close to expiry,
 * slow-moving stock worth liquidating, and stock to move between warehouses.
 */
export const inventoryAgent: AgentDefinition = {
  code: 'inventory',
  name: 'Inventory agent',
  description: 'Watches stock against usage: what will run out, what will expire, what is not moving, and what sits in the wrong warehouse.',
  watches: ['Days of cover against lead time', 'Batches nearing expiry', 'Stock with no issues for months', 'Stock idle in one warehouse while another uses it'],
  defaultSchedule: 'daily',
  params: {
    usageDays: { default: 60, label: 'Days of usage history' },
    bufferDays: { default: 7, label: 'Safety days beyond lead time' },
    expiryDays: { default: 60, label: 'Warn this many days before expiry' },
    slowDays: { default: 180, label: 'No movement for (days)' },
    slowValue: { default: 50_000, label: 'Slow stock worth at least (₹)' },
  },
  async run({ tx, today, params }) {
    const out: Finding[] = [];

    // ---- stock-out risk ----
    const usage = await many<{ itemId: string; code: string; name: string; leadDays: number | null; available: string; used: string }>(
      tx,
      sql`select i.id as "itemId", i.code, i.name, i.lead_time_days as "leadDays",
                 coalesce((select sum(b.qty) from stock_balances b join warehouses w on w.id = b.warehouse_id where b.item_id = i.id and w.is_nettable), 0)::text as available,
                 coalesce((select sum(-l.qty) from stock_ledger l join warehouses w on w.id = l.warehouse_id where l.item_id = i.id and w.is_nettable and ${ISSUES} and l.posting_date > ${today}::date - ${params.usageDays}::int), 0)::text as used
          from items i where i.is_stock_item and i.deleted_at is null and i.is_active`,
    );
    for (const u of usage) {
      const cover = daysOfCover(Number(u.available), Number(u.used), params.usageDays);
      if (cover === null) continue;
      const lead = u.leadDays ?? 7;
      if (cover >= lead + params.bufferDays) continue;
      out.push({
        kind: 'stockout_risk',
        severity: cover < lead ? 'critical' : 'warning',
        title: `${u.code} runs out in about ${cover} day${cover === 1 ? '' : 's'}`,
        body: `${u.name}: ${Number(u.available)} in stock, using about ${Math.round((Number(u.used) / params.usageDays) * 10) / 10} a day. Replenishment takes about ${lead} days.`,
        evidence: { available: Number(u.available), usedInWindow: Number(u.used), windowDays: params.usageDays, daysOfCover: cover, leadDays: lead },
        dedupeKey: `stockout:${u.itemId}`,
        entityType: 'item',
        entityId: u.itemId,
        link: `/inventory/stock/${u.itemId}`,
        confidence: Number(u.used) > 0 ? 0.8 : 0.5,
        permission: 'inventory.stock.read',
        expiresInDays: 3,
      });
    }

    // ---- expiry risk ----
    const expiring = await many<{ batchId: string; batchNo: string; expiryDate: string; itemId: string; code: string; name: string; qty: string; value: string }>(
      tx,
      sql`select bt.id as "batchId", bt.batch_no as "batchNo", bt.expiry_date::text as "expiryDate", i.id as "itemId", i.code, i.name, sum(b.qty)::text as qty,
                 (sum(b.qty) * coalesce((select max(v.value / nullif(v.qty, 0)) from stock_valuation v where v.item_id = i.id), 0))::text as value
          from stock_balances b join batches bt on bt.id = b.batch_key join items i on i.id = b.item_id join warehouses w on w.id = b.warehouse_id
          where w.is_nettable and b.qty > 0 and bt.expiry_date is not null and bt.expiry_date <= ${today}::date + ${params.expiryDays}::int
          group by bt.id, bt.batch_no, bt.expiry_date, i.id, i.code, i.name`,
    );
    for (const e of expiring) {
      const days = Math.round((Date.parse(e.expiryDate) - Date.parse(today)) / 86_400_000);
      out.push({
        kind: 'expiry_risk',
        severity: days <= 15 ? 'critical' : 'warning',
        title: days < 0 ? `Batch ${e.batchNo} of ${e.code} has expired` : `Batch ${e.batchNo} of ${e.code} expires in ${days} days`,
        body: `${Number(e.qty)} of ${e.name} (about ${inr(Number(e.value))}) expire${days < 0 ? 'd' : 's'} on ${e.expiryDate}. ${days < 0 ? 'Write it off or return it.' : 'Issue or sell it first, or arrange a return to the vendor.'}`,
        evidence: { batchNo: e.batchNo, expiryDate: e.expiryDate, qty: Number(e.qty), value: Number(e.value), daysLeft: days },
        dedupeKey: `expiry:${e.batchId}`,
        entityType: 'batch',
        entityId: e.batchId,
        link: `/inventory/stock/${e.itemId}`,
        confidence: 0.95,
        permission: 'inventory.stock.read',
        expiresInDays: 7,
      });
    }

    // ---- slow-moving ----
    const slow = await many<{ itemId: string; code: string; name: string; qty: string; value: string; lastOut: string | null }>(
      tx,
      sql`select i.id as "itemId", i.code, i.name, sum(v.qty)::text as qty, sum(v.value)::text as value,
                 (select max(l.posting_date)::text from stock_ledger l where l.item_id = i.id and ${ISSUES}) as "lastOut"
          from stock_valuation v join items i on i.id = v.item_id join warehouses w on w.id = v.warehouse_id
          where w.is_nettable and v.qty > 0 group by i.id, i.code, i.name having sum(v.value) >= ${params.slowValue}`,
    );
    for (const s of slow) {
      const since = s.lastOut ? Math.round((Date.parse(today) - Date.parse(s.lastOut)) / 86_400_000) : null;
      if (since !== null && since < params.slowDays) continue;
      const [first] = await many<{ d: string | null }>(tx, sql`select min(posting_date)::text as d from stock_ledger where item_id = ${s.itemId}`);
      if (since === null && first?.d && Math.round((Date.parse(today) - Date.parse(first.d)) / 86_400_000) < params.slowDays) continue;
      out.push({
        kind: 'slow_moving',
        severity: 'info',
        title: `${inr(Number(s.value))} of ${s.code} has not moved ${since === null ? 'since it came in' : `for ${since} days`}`,
        body: `${Number(s.qty)} of ${s.name} are tying up ${inr(Number(s.value))}. Consider a discount, using it elsewhere, or returning it.`,
        evidence: { qty: Number(s.qty), value: Number(s.value), lastIssued: s.lastOut, daysIdle: since },
        dedupeKey: `slow:${s.itemId}`,
        entityType: 'item',
        entityId: s.itemId,
        link: `/inventory/stock/${s.itemId}`,
        confidence: 0.7,
        permission: 'inventory.stock.read',
        expiresInDays: 30,
      });
    }

    // ---- balancing between warehouses ----
    const balance = await many<{ itemId: string; code: string; toWh: string; toCode: string; need: string; fromWh: string; fromCode: string; spare: string }>(
      tx,
      sql`with use30 as (
            select l.item_id, l.warehouse_id, sum(-l.qty) as used from stock_ledger l join warehouses w on w.id = l.warehouse_id
            where w.is_nettable and ${ISSUES} and l.posting_date > ${today}::date - 30 group by 1, 2),
          onhand as (select b.item_id, b.warehouse_id, sum(b.qty) as qty from stock_balances b join warehouses w on w.id = b.warehouse_id where w.is_nettable group by 1, 2)
          select distinct on (u.item_id, u.warehouse_id) u.item_id as "itemId", i.code, u.warehouse_id as "toWh", tw.code as "toCode", (u.used - coalesce(h.qty, 0))::text as need,
                 o.warehouse_id as "fromWh", fw.code as "fromCode", o.qty::text as spare
          from use30 u join items i on i.id = u.item_id join warehouses tw on tw.id = u.warehouse_id left join onhand h on h.item_id = u.item_id and h.warehouse_id = u.warehouse_id
          join onhand o on o.item_id = u.item_id and o.warehouse_id <> u.warehouse_id and o.qty > 0
          join warehouses fw on fw.id = o.warehouse_id
          where coalesce(h.qty, 0) < u.used * 0.25 and not exists (select 1 from use30 x where x.item_id = o.item_id and x.warehouse_id = o.warehouse_id)
          order by u.item_id, u.warehouse_id, o.qty desc`,
    );
    for (const b of balance) {
      const qty = Math.min(Number(b.spare), Math.ceil(Number(b.need)));
      if (qty <= 0) continue;
      out.push({
        kind: 'rebalance',
        severity: 'warning',
        title: `Move ${qty} of ${b.code} from ${b.fromCode} to ${b.toCode}`,
        body: `${b.toCode} used ${Math.ceil(Number(b.need))} more than it holds in the last 30 days, while ${b.fromCode} has ${Number(b.spare)} it has not used.`,
        evidence: { from: b.fromCode, to: b.toCode, spare: Number(b.spare), shortfall: Number(b.need) },
        dedupeKey: `balance:${b.itemId}:${b.fromWh}:${b.toWh}`,
        entityType: 'item',
        entityId: b.itemId,
        action: { type: 'draft_stock_transfer', label: `Draft a transfer of ${qty}`, params: { fromWarehouseId: b.fromWh, toWarehouseId: b.toWh, lines: [{ itemId: b.itemId, qty }], reason: `Rebalance: ${b.toCode} is short` }, amount: null },
        confidence: 0.7,
        permission: 'inventory.entries.manage',
        expiresInDays: 7,
      });
    }
    return out;
  },
};
