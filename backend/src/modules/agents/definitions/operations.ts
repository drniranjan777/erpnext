import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '@nextgen/database';
import type { AgentDefinition, Finding } from '../framework';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

/** Production agent: material shortages for work orders starting soon, and work orders running late. */
export const productionAgent: AgentDefinition = {
  code: 'production',
  name: 'Production agent',
  description: 'Checks upcoming work orders for missing material and flags orders behind schedule.',
  watches: ['Material for work orders starting within days', 'Work orders past their planned end'],
  defaultSchedule: 'daily',
  params: { horizonDays: { default: 7, label: 'Look ahead (days)' } },
  async run({ tx, today, params }) {
    const out: Finding[] = [];
    const short = await many<{ woId: string; number: string; product: string; start: string; itemId: string; code: string; name: string; uom: string; uomId: string; need: string; available: string }>(
      tx,
      sql`with need as (
            select wo.id as wo_id, m.item_id, sum(greatest(0, m.required_qty - m.issued_qty)) as need, max(wo.planned_start) as start, max(coalesce(wo.source_warehouse_id::text, '')) as wh
            from work_orders wo join documents d on d.id = wo.id join work_order_materials m on m.work_order_id = wo.id
            where d.status in ('approved', 'pending_approval') and wo.closed_at is null and m.kind = 'component' and wo.planned_start <= ${today}::date + ${params.horizonDays}::int
            group by wo.id, m.item_id)
          select n.wo_id as "woId", d.number, ip.code as product, n.start::text as start, n.item_id as "itemId", i.code, i.name, u.code as uom, i.base_uom_id as "uomId", n.need::text as need,
                 coalesce((select sum(b.qty) from stock_balances b join warehouses w on w.id = b.warehouse_id where b.item_id = n.item_id and w.is_nettable), 0)::text as available
          from need n join documents d on d.id = n.wo_id join work_orders wo on wo.id = n.wo_id join items ip on ip.id = wo.item_id join items i on i.id = n.item_id join uoms u on u.id = i.base_uom_id
          where n.need > 0 and i.is_stock_item`,
    );
    for (const s of short) {
      const gap = Number(s.need) - Number(s.available);
      if (gap <= 0) continue;
      const qty = Math.ceil(gap);
      out.push({
        kind: 'material_shortage',
        severity: s.start <= today ? 'critical' : 'warning',
        title: `Work order ${s.number} (${s.product}) is short of ${qty} ${s.uom} ${s.code}`,
        body: `It starts ${s.start}. Needs ${Number(s.need)} of ${s.name}; ${Number(s.available)} available across stores (other orders may need it too).`,
        evidence: { start: s.start, need: Number(s.need), available: Number(s.available), shortBy: gap },
        dedupeKey: `woshort:${s.woId}:${s.itemId}`,
        entityType: 'work_order',
        entityId: s.woId,
        link: `/manufacturing/work-orders/${s.woId}`,
        action: {
          type: 'create_requisition',
          label: `Request ${qty} ${s.uom}`,
          params: { purpose: `Material for work order ${s.number}`, priority: s.start <= today ? 'urgent' : 'high', lines: [{ itemId: s.itemId, uomId: s.uomId, description: s.name, uom: s.uom, quantity: String(qty), requiredBy: s.start > today ? s.start : today }] },
          amount: null,
        },
        confidence: 0.85,
        permission: 'manufacturing.production.read',
        expiresInDays: 3,
      });
    }
    const late = await many<{ id: string; number: string; product: string; plannedEnd: string; qty: string; produced: string }>(
      tx,
      sql`select wo.id, d.number, i.code as product, wo.planned_end::text as "plannedEnd", wo.qty::text as qty, wo.produced_qty::text as produced
          from work_orders wo join documents d on d.id = wo.id join items i on i.id = wo.item_id
          where d.status = 'approved' and wo.closed_at is null and wo.planned_end < ${today}::date and wo.produced_qty < wo.qty`,
    );
    for (const w of late) {
      const days = Math.round((Date.parse(today) - Date.parse(w.plannedEnd)) / 86_400_000);
      const pct = Math.round((Number(w.produced) / Number(w.qty)) * 100);
      out.push({
        kind: 'wo_late',
        severity: days > 3 ? 'critical' : 'warning',
        title: `Work order ${w.number} (${w.product}) is ${days} days behind`,
        body: `${pct} % made (${Number(w.produced)} of ${Number(w.qty)}); it was due to finish ${w.plannedEnd}. Re-plan or tell sales.`,
        evidence: { plannedEnd: w.plannedEnd, daysLate: days, producedPct: pct },
        dedupeKey: `wolate:${w.id}`,
        entityType: 'work_order',
        entityId: w.id,
        link: `/manufacturing/work-orders/${w.id}`,
        confidence: 0.95,
        permission: 'manufacturing.production.read',
        expiresInDays: 2,
      });
    }
    return out;
  },
};

/** Maintenance agent: preventive maintenance coming due, with critical spares below their minimum. */
export const maintenanceAgent: AgentDefinition = {
  code: 'maintenance',
  name: 'Maintenance agent',
  description: 'Reminds about preventive maintenance coming due and checks the critical spares are in stock.',
  watches: ['PM schedules due within days', 'Critical spares below their minimum'],
  defaultSchedule: 'daily',
  params: { aheadDays: { default: 3, label: 'Remind before due (days)' } },
  async run({ tx, today, params }) {
    const out: Finding[] = [];
    const pm = await many<{ id: string; title: string; asset: string; assetId: string; nextDue: string; criticality: string | null }>(
      tx,
      sql`select s.id, s.title, a.code || ' ' || a.name as asset, a.id as "assetId", s.next_due::text as "nextDue", a.criticality
          from pm_schedules s join maint_assets a on a.id = s.asset_id where s.is_active and s.next_due is not null and s.next_due <= ${today}::date + ${params.aheadDays}::int`,
    );
    for (const p of pm) {
      const days = Math.round((Date.parse(p.nextDue) - Date.parse(today)) / 86_400_000);
      out.push({
        kind: 'pm_due',
        severity: days < 0 ? 'critical' : 'warning',
        title: days < 0 ? `PM "${p.title}" on ${p.asset} is ${-days} days overdue` : `PM "${p.title}" on ${p.asset} is due ${days === 0 ? 'today' : `in ${days} days`}`,
        body: `Due ${p.nextDue}.${p.criticality ? ` Asset criticality: ${p.criticality}.` : ''} Schedule it and keep the spares ready.`,
        evidence: { nextDue: p.nextDue, daysToDue: days },
        dedupeKey: `pm:${p.id}:${p.nextDue}`,
        entityType: 'pm_schedule',
        entityId: p.id,
        link: `/maintenance/assets/${p.assetId}`,
        confidence: 0.98,
        permission: 'maintenance.orders.read',
        expiresInDays: 7,
      });
    }
    const spares = await many<{ itemId: string; code: string; name: string; uom: string; uomId: string; minQty: string; available: string; assets: string }>(
      tx,
      sql`select sp.item_id as "itemId", i.code, i.name, u.code as uom, i.base_uom_id as "uomId", max(sp.min_qty)::text as "minQty", string_agg(distinct a.code, ', ') as assets,
                 coalesce((select sum(b.qty) from stock_balances b join warehouses w on w.id = b.warehouse_id where b.item_id = sp.item_id and w.is_nettable), 0)::text as available
          from asset_spares sp join items i on i.id = sp.item_id join uoms u on u.id = i.base_uom_id join maint_assets a on a.id = sp.asset_id
          where sp.is_critical and sp.min_qty > 0 group by sp.item_id, i.code, i.name, u.code, i.base_uom_id`,
    );
    for (const s of spares) {
      if (Number(s.available) >= Number(s.minQty)) continue;
      const qty = Math.ceil(Number(s.minQty) - Number(s.available));
      out.push({
        kind: 'spare_low',
        severity: Number(s.available) <= 0 ? 'critical' : 'warning',
        title: `Critical spare ${s.code} is below its minimum`,
        body: `${Number(s.available)} in stock against a minimum of ${Number(s.minQty)}, for ${s.assets}. A breakdown now would wait for it.`,
        evidence: { available: Number(s.available), minimum: Number(s.minQty), assets: s.assets },
        dedupeKey: `spare:${s.itemId}`,
        entityType: 'item',
        entityId: s.itemId,
        link: `/inventory/stock/${s.itemId}`,
        action: { type: 'create_requisition', label: `Request ${qty} ${s.uom}`, params: { purpose: `Critical spare below minimum (${s.assets})`, priority: 'high', lines: [{ itemId: s.itemId, uomId: s.uomId, description: s.name, uom: s.uom, quantity: String(qty) }] }, amount: null },
        confidence: 0.9,
        permission: 'maintenance.orders.read',
        expiresInDays: 7,
      });
    }
    return out;
  },
};

/** Quality agent: the same defect recurring on an item, and suppliers with rising incoming rejections. */
export const qualityAgent: AgentDefinition = {
  code: 'quality',
  name: 'Quality agent',
  description: 'Spots repeat defects that need a CAPA and suppliers whose incoming lots are failing.',
  watches: ['Same defect on an item 3+ times in 60 days', 'Incoming rejection rate per supplier'],
  defaultSchedule: 'daily',
  params: { repeatCount: { default: 3, label: 'Repeat defects (count)' }, rejectPct: { default: 5, label: 'Supplier rejection above (%)' } },
  async run({ tx, today, params }) {
    const out: Finding[] = [];
    const repeat = await many<{ itemId: string; code: string; defect: string; n: number; copq: string; open: number }>(
      tx,
      sql`select n.item_id as "itemId", i.code, coalesce(n.defect_category, 'unspecified') as defect, count(*)::int as n, coalesce(sum(n.copq), 0)::text as copq,
                 (select count(*)::int from capas c where c.ncr_id in (select x.id from ncrs x where x.item_id = n.item_id) and c.closed_at is null) as open
          from ncrs n join documents d on d.id = n.id join items i on i.id = n.item_id where d.doc_date > ${today}::date - 60
          group by n.item_id, i.code, coalesce(n.defect_category, 'unspecified') having count(*) >= ${params.repeatCount}::int`,
    );
    for (const r of repeat) {
      if (r.open > 0) continue;
      out.push({
        kind: 'repeat_defect',
        severity: 'warning',
        title: `${r.code}: "${r.defect}" ${r.n} times in 60 days`,
        body: `The same defect keeps coming back (cost of poor quality ₹${Math.round(Number(r.copq)).toLocaleString('en-IN')}). Raise a CAPA to find the root cause.`,
        evidence: { defect: r.defect, occurrences: r.n, copq: Number(r.copq) },
        dedupeKey: `repeat:${r.itemId}:${r.defect}`,
        entityType: 'item',
        entityId: r.itemId,
        link: '/quality/ncrs',
        confidence: 0.85,
        permission: 'quality.inspections.read',
        expiresInDays: 14,
      });
    }
    const vendors = await many<{ partyId: string; vendor: string; lots: number; rejected: number }>(
      tx,
      sql`select q.party_id as "partyId", p.name as vendor, count(*)::int as lots, count(*) filter (where q.result in ('rejected', 'partial'))::int as rejected
          from quality_inspections q join documents d on d.id = q.id join parties p on p.id = q.party_id
          where q.stage = 'incoming' and q.result <> 'pending' and d.doc_date > ${today}::date - 90 group by q.party_id, p.name having count(*) >= 3`,
    );
    for (const v of vendors) {
      const pct = (v.rejected / v.lots) * 100;
      if (pct <= params.rejectPct) continue;
      out.push({
        kind: 'supplier_quality',
        severity: pct > params.rejectPct * 3 ? 'critical' : 'warning',
        title: `${v.vendor}: ${Math.round(pct)} % of incoming lots rejected`,
        body: `${v.rejected} of ${v.lots} lots in 90 days. Consider a supplier audit, tightened inspection or a corrective action request.`,
        evidence: { lots: v.lots, rejected: v.rejected, rejectPct: Math.round(pct * 10) / 10 },
        dedupeKey: `supq:${v.partyId}:${today.slice(0, 7)}`,
        entityType: 'party',
        entityId: v.partyId,
        link: '/quality/suppliers',
        confidence: 0.8,
        permission: 'quality.inspections.read',
        expiresInDays: 30,
      });
    }
    return out;
  },
};
