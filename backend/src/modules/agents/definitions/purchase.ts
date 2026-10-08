import { sql } from 'drizzle-orm';
import { reorderQty, type AgentDefinition, type Finding } from '../framework';
import { many } from '../../../common/sql';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/**
 * Purchase agent: requisitions for items at or below their reorder level (counting what is
 * already ordered or requested), with the best recent vendor; follow-ups on late POs; and
 * price rises against recent history.
 */
export const purchaseAgent: AgentDefinition = {
  code: 'purchase',
  name: 'Purchase agent',
  description: 'Raises requisitions when stock falls to its reorder level, chases vendors on late orders, and flags price rises.',
  watches: ['Reorder levels (stock + on order + requested)', 'Purchase orders past their expected date', 'Prices against the last 6 months'],
  defaultSchedule: 'daily',
  params: {
    priceRisePct: { default: 10, label: 'Flag price rises above (%)' },
    lateDays: { default: 2, label: 'Chase POs late by (days)' },
  },
  async run({ tx, today, params }) {
    const out: Finding[] = [];

    // ---- reorder ----
    const low = await many<{ itemId: string; code: string; name: string; uom: string; uomId: string; reorderLevel: string; reorderQty: string | null; leadDays: number | null; stock: string; onOrder: string; requested: string }>(
      tx,
      sql`select i.id as "itemId", i.code, i.name, u.code as uom, i.base_uom_id as "uomId", i.reorder_level::text as "reorderLevel", i.reorder_qty::text as "reorderQty", i.lead_time_days as "leadDays",
                 coalesce((select sum(b.qty) from stock_balances b join warehouses w on w.id = b.warehouse_id where b.item_id = i.id and w.is_nettable), 0)::text as stock,
                 coalesce((select sum((l.qty - l.received_qty) * l.conversion_factor) from purchase_order_lines l join purchase_orders po on po.id = l.po_id join documents d on d.id = po.id
                           where l.item_id = i.id and d.status in ('approved', 'pending_approval') and po.closed_at is null and l.qty > l.received_qty), 0)::text as "onOrder",
                 coalesce((select sum(l.quantity - l.ordered_qty) from purchase_requisition_lines l join documents d on d.id = l.requisition_id
                           where l.item_id = i.id and d.status in ('draft', 'pending_approval', 'approved') and l.quantity > l.ordered_qty), 0)::text as requested
          from items i join uoms u on u.id = i.base_uom_id where i.is_stock_item and i.is_active and i.deleted_at is null and i.reorder_level is not null`,
    );
    for (const r of low) {
      const position = Number(r.stock) + Number(r.onOrder) + Number(r.requested);
      if (position > Number(r.reorderLevel)) continue;
      const qty = reorderQty(position, Number(r.reorderLevel), r.reorderQty ? Number(r.reorderQty) : null);
      if (qty <= 0) continue;
      const [best] = await many<{ vendorId: string; vendor: string; rate: string; orders: number }>(
        tx,
        sql`select po.vendor_id as "vendorId", p.name as vendor, min(l.rate / nullif(l.conversion_factor, 0))::text as rate, count(*)::int as orders
            from purchase_order_lines l join purchase_orders po on po.id = l.po_id join documents d on d.id = po.id join parties p on p.id = po.vendor_id
            where l.item_id = ${r.itemId} and d.status in ('approved', 'completed') and d.doc_date > ${today}::date - 365
            group by po.vendor_id, p.name order by min(l.rate / nullif(l.conversion_factor, 0)) limit 1`,
      );
      const rate = best ? Number(best.rate) : null;
      const requiredBy = new Date(Date.parse(today) + (r.leadDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
      out.push({
        kind: 'reorder',
        severity: Number(r.stock) <= 0 ? 'critical' : 'warning',
        title: `Reorder ${qty} ${r.uom} of ${r.code}`,
        body: `${r.name}: ${Number(r.stock)} in stock, ${Number(r.onOrder)} on order and ${Number(r.requested)} requested, against a reorder level of ${Number(r.reorderLevel)}.${best ? ` Best recent price: ${inr(rate!)} from ${best.vendor}.` : ''}`,
        evidence: { stock: Number(r.stock), onOrder: Number(r.onOrder), requested: Number(r.requested), reorderLevel: Number(r.reorderLevel), suggestedVendor: best?.vendor ?? null, bestRate: rate },
        dedupeKey: `reorder:${r.itemId}`,
        entityType: 'item',
        entityId: r.itemId,
        link: `/inventory/stock/${r.itemId}`,
        action: {
          type: 'create_requisition',
          label: `Raise a requisition for ${qty} ${r.uom}`,
          params: { purpose: `Reorder: ${r.code} at or below its reorder level`, priority: Number(r.stock) <= 0 ? 'urgent' : 'normal', lines: [{ itemId: r.itemId, uomId: r.uomId, description: r.name, uom: r.uom, quantity: String(qty), estimatedRate: rate ? rate.toFixed(4) : null, requiredBy, remarks: best ? `Suggested vendor: ${best.vendor}` : null }] },
          amount: rate ? Math.round(rate * qty) : null,
        },
        confidence: 0.9,
        permission: 'purchase.requisitions.manage',
        expiresInDays: 3,
      });
    }

    // ---- late purchase orders ----
    const late = await many<{ poId: string; number: string; vendorId: string; vendor: string; email: string | null; expectedDate: string; lines: number; pendingValue: string }>(
      tx,
      sql`select po.id as "poId", d.number, po.vendor_id as "vendorId", p.name as vendor, p.email, po.expected_date::text as "expectedDate",
                 count(l.id)::int as lines, sum((l.qty - l.received_qty) * l.rate)::text as "pendingValue"
          from purchase_orders po join documents d on d.id = po.id join parties p on p.id = po.vendor_id join purchase_order_lines l on l.po_id = po.id
          where d.status = 'approved' and po.closed_at is null and po.expected_date < ${today}::date - ${params.lateDays}::int and l.qty > l.received_qty
          group by po.id, d.number, po.vendor_id, p.name, p.email, po.expected_date`,
    );
    for (const p of late) {
      const days = Math.round((Date.parse(today) - Date.parse(p.expectedDate)) / 86_400_000);
      out.push({
        kind: 'po_late',
        severity: days > 14 ? 'critical' : 'warning',
        title: `PO ${p.number} from ${p.vendor} is ${days} days late`,
        body: `${p.lines} line(s) worth ${inr(Number(p.pendingValue))} were due on ${p.expectedDate}.${p.email ? '' : ' The vendor has no email on record.'}`,
        evidence: { expectedDate: p.expectedDate, daysLate: days, pendingValue: Number(p.pendingValue) },
        dedupeKey: `polate:${p.poId}`,
        entityType: 'purchase_order',
        entityId: p.poId,
        link: `/purchase/orders/${p.poId}`,
        action: p.email
          ? {
              type: 'email_party',
              label: `Email ${p.vendor} for a delivery date`,
              params: {
                partyId: p.vendorId,
                subject: `Delivery status of our PO ${p.number}`,
                body: `Dear ${p.vendor},\n\nOur purchase order ${p.number} was due on ${p.expectedDate} and ${p.lines} line(s) are still pending. Please confirm when the goods will be dispatched, with the vehicle and LR details if already sent.\n\nThank you.`,
                documentId: p.poId,
              },
              amount: null,
            }
          : null,
        confidence: 0.95,
        permission: 'purchase.orders.read',
        expiresInDays: 5,
      });
    }

    // ---- price rises ----
    const rises = await many<{ lineId: string; poId: string; number: string; code: string; vendor: string; rate: string; avg: string }>(
      tx,
      sql`select l.id as "lineId", po.id as "poId", d.number, i.code, p.name as vendor, (l.rate / nullif(l.conversion_factor, 0))::text as rate,
                 (select avg(x.rate / nullif(x.conversion_factor, 0)) from purchase_order_lines x join documents xd on xd.id = x.po_id
                   where x.item_id = l.item_id and xd.status in ('approved', 'completed') and xd.doc_date between d.doc_date - 180 and d.doc_date - 1)::text as avg
          from purchase_order_lines l join purchase_orders po on po.id = l.po_id join documents d on d.id = po.id join items i on i.id = l.item_id join parties p on p.id = po.vendor_id
          where d.status in ('approved', 'pending_approval') and d.doc_date > ${today}::date - 30`,
    );
    for (const r of rises) {
      if (!r.avg) continue;
      const pct = ((Number(r.rate) - Number(r.avg)) / Number(r.avg)) * 100;
      if (pct <= params.priceRisePct) continue;
      out.push({
        kind: 'price_rise',
        severity: pct > params.priceRisePct * 2 ? 'critical' : 'warning',
        title: `${r.code} on PO ${r.number} is ${Math.round(pct)} % above its 6-month average`,
        body: `${r.vendor} charged ${inr(Number(r.rate))} against an average of ${inr(Number(r.avg))}. Check for a price revision or negotiate.`,
        evidence: { rate: Number(r.rate), average: Number(r.avg), risePct: Math.round(pct * 10) / 10 },
        dedupeKey: `price:${r.lineId}`,
        entityType: 'purchase_order',
        entityId: r.poId,
        link: `/purchase/orders/${r.poId}`,
        confidence: 0.85,
        permission: 'purchase.orders.read',
        expiresInDays: 14,
      });
    }
    return out;
  },
};
