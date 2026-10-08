import { Injectable } from '@nestjs/common';
import type { Transaction } from '@nextgen/database';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { forecastSeries, months } from '../planning/forecast';
import { marginBridge, parseWhy, predictCollections, type ItemPeriod, type Period } from './analytics';
import { many } from '../../common/sql';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const pts = (v: number) => `${v > 0 ? '+' : ''}${v} pts`;

/** Predictions: when customers will pay, where purchase prices are heading, and why sales or margin moved. */
@Injectable()
export class PredictService {
  constructor(private readonly database: DatabaseService) {}

  /** Expected collections by week, from each customer's payment record over the last year. */
  collections(auth: AuthContext, weeks: number) {
    const today = todayIST();
    return this.database.run(auth, async (tx) => {
      const paid = await many<{ customerId: string; daysLate: number }>(
        tx,
        sql`select si.customer_id as "customerId", greatest(-30, (max(d2.doc_date) - si.due_date))::int as "daysLate"
            from sales_invoices si join documents d on d.id = si.id join money_allocations a on a.against_doc_id = si.id join documents d2 on d2.id = a.voucher_id
            where d.status in ('approved', 'completed') and si.due_date is not null and si.grand_total - si.received_amount - si.credited_amount <= 0 and d.doc_date > ${today}::date - 365
            group by si.id, si.customer_id, si.due_date`,
      );
      const open = await many<{ id: string; number: string; customerId: string; customer: string; dueDate: string; outstanding: string }>(
        tx,
        sql`select si.id, d.number, si.customer_id as "customerId", p.name as customer, coalesce(si.due_date, d.doc_date)::text as "dueDate", (si.grand_total - si.received_amount - si.credited_amount)::text as outstanding
            from sales_invoices si join documents d on d.id = si.id join parties p on p.id = si.customer_id
            where d.status in ('approved', 'completed') and si.grand_total - si.received_amount - si.credited_amount > 0`,
      );
      const r = predictCollections(open.map((o) => ({ id: o.id, customerId: o.customerId, dueDate: o.dueDate, outstanding: Number(o.outstanding) })), paid, today, weeks);
      const names = new Map(open.map((o) => [o.id, o]));
      return {
        ...r,
        rows: r.rows.map((x) => ({ ...x, number: names.get(x.id)!.number, customer: names.get(x.id)!.customer })).sort((a, b) => a.expected.localeCompare(b.expected)),
        total: Math.round(open.reduce((s, o) => s + Number(o.outstanding), 0) * 100) / 100,
        paidInvoicesLearned: paid.length,
      };
    });
  }

  /** Monthly average purchase price of the biggest-spend items (or one item), with a 3-month forecast. */
  prices(auth: AuthContext, itemId: string | undefined, horizon: number) {
    const today = todayIST();
    const start = `${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - 17, 1)).toISOString().slice(0, 7)}`;
    const window = months(start, 18);
    return this.database.run(auth, async (tx) => {
      const top = itemId
        ? [{ itemId }]
        : await many<{ itemId: string }>(
            tx,
            sql`select l.item_id as "itemId" from purchase_order_lines l join documents d on d.id = l.po_id where d.status in ('approved', 'completed') and d.doc_date >= ${`${start}-01`}::date
                group by l.item_id order by sum(l.qty * l.rate) desc limit 10`,
          );
      const out = [];
      for (const t of top) {
        const rows = await many<{ period: string; rate: string; code: string; name: string }>(
          tx,
          sql`select to_char(d.doc_date, 'YYYY-MM') as period, (sum(l.qty * l.rate) / nullif(sum(l.base_qty), 0))::text as rate, max(i.code) as code, max(i.name) as name
              from purchase_order_lines l join documents d on d.id = l.po_id join items i on i.id = l.item_id
              where l.item_id = ${t.itemId} and d.status in ('approved', 'completed') and d.doc_date >= ${`${start}-01`}::date group by 1 order by 1`,
        );
        if (rows.length < 2) continue;
        const by = new Map(rows.map((r) => [r.period, Number(r.rate)]));
        // Months without a purchase carry the last price forward.
        const firstAt = window.findIndex((p) => by.has(p));
        const series: number[] = [];
        for (const p of window.slice(firstAt)) series.push(by.get(p) ?? series[series.length - 1]);
        const f = forecastSeries(series, horizon);
        const last = series[series.length - 1];
        const ahead = f.forecast[f.forecast.length - 1];
        out.push({ itemId: t.itemId, code: rows[0].code, name: rows[0].name, history: window.slice(firstAt).map((p, i) => ({ period: p, rate: Math.round(series[i] * 100) / 100 })), forecast: f.forecast.map((v, i) => ({ period: months(window[window.length - 1], horizon + 1)[i + 1], rate: v, low: f.lower?.[i], high: f.upper?.[i] })), method: f.method, lastRate: Math.round(last * 100) / 100, changePct: last ? Math.round(((ahead - last) / last) * 1000) / 10 : null });
      }
      return out;
    });
  }

  private async itemPeriod(tx: Transaction, p: Period): Promise<ItemPeriod[]> {
    const rows = await many<{ itemId: string; code: string; qty: string; revenue: string; cost: string }>(
      tx,
      sql`select l.item_id as "itemId", i.code, sum(l.base_qty)::text as qty, sum(l.taxable_value)::text as revenue, sum(l.cost_value)::text as cost
          from sales_invoice_lines l join documents d on d.id = l.invoice_id join items i on i.id = l.item_id
          where d.status in ('approved', 'completed') and d.doc_date between ${p.from}::date and ${p.to}::date group by l.item_id, i.code`,
    );
    return rows.map((r) => ({ itemId: r.itemId, code: r.code, qty: Number(r.qty), revenue: Number(r.revenue), cost: Number(r.cost) }));
  }

  /** Answers "why did margin drop in Q2?" or "why are sales down last month?" with a decomposition. */
  why(auth: AuthContext, question: string) {
    const today = todayIST();
    const q = parseWhy(question, today);
    return this.database.run(auth, async (tx) => {
      const prev = await this.itemPeriod(tx, q.previous);
      const curr = await this.itemPeriod(tx, q.current);
      if (!prev.length && !curr.length) return { ...q, answer: `There were no sales in ${q.current.label} or ${q.previous.label} to compare.`, bridge: null, sales: null };
      if (q.metric === 'margin') {
        const b = marginBridge(prev, curr);
        const parts: string[] = [];
        const name = (k: 'price' | 'cost' | 'mix') => ({ price: 'selling prices', cost: 'costs', mix: 'product mix' })[k];
        const effects = (Object.entries(b.effects) as ['price' | 'cost' | 'mix', number][]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
        for (const [k, v] of effects) {
          if (Math.abs(v) < 0.05) continue;
          let why = '';
          if (k === 'cost' && b.topCost[0] && b.topCost[0].costImpact < 0) why = ` (mostly ${b.topCost.filter((d) => d.costImpact < 0).map((d) => `${d.code} cost ${d.costChangePct! > 0 ? '+' : ''}${d.costChangePct} %`).join(', ')})`;
          if (k === 'price' && b.topPrice[0] && b.topPrice[0].priceImpact < 0) why = ` (mostly ${b.topPrice.filter((d) => d.priceImpact < 0).map((d) => `${d.code} sold ${d.priceChangePct} %`).join(', ')})`;
          if (k === 'mix' && v < 0 && b.lowMarginGrowth.length) why = ` (more of lower-margin ${b.lowMarginGrowth.map((d) => d.code).join(', ')})`;
          parts.push(`${name(k)} ${pts(v)}${why}`);
        }
        const dir = b.changePts < 0 ? 'fell' : b.changePts > 0 ? 'rose' : 'held';
        const answer = `Gross margin ${dir} from ${b.previousPct} % in ${q.previous.label} to ${b.currentPct} % in ${q.current.label} (${pts(b.changePts)}).${parts.length ? ` Drivers: ${parts.join('; ')}.` : ''}`;
        return { ...q, answer, bridge: b, sales: null };
      }
      // Sales: price effect at old quantities, volume at old prices, and new / lost items.
      const ids = new Set([...prev.map((p) => p.itemId), ...curr.map((c) => c.itemId)]);
      let price = 0;
      let volume = 0;
      let added = 0;
      let lost = 0;
      const movers: { code: string; change: number }[] = [];
      for (const id of ids) {
        const p = prev.find((x) => x.itemId === id);
        const c = curr.find((x) => x.itemId === id);
        if (p && c && p.qty && c.qty) {
          price += p.qty * (c.revenue / c.qty - p.revenue / p.qty);
          volume += (c.qty - p.qty) * (p.revenue / p.qty);
        } else if (c && !p) added += c.revenue;
        else if (p && !c) lost += p.revenue;
        movers.push({ code: (c ?? p)!.code, change: (c?.revenue ?? 0) - (p?.revenue ?? 0) });
      }
      const before = prev.reduce((s, r) => s + r.revenue, 0);
      const now = curr.reduce((s, r) => s + r.revenue, 0);
      const change = now - before;
      movers.sort((a, b) => a.change - b.change);
      const biggest = change < 0 ? movers.slice(0, 3).filter((m) => m.change < 0) : movers.slice(-3).reverse().filter((m) => m.change > 0);
      const answer = `Sales ${change < 0 ? 'fell' : 'rose'} ${inr(Math.abs(change))} (${before ? `${Math.round((change / before) * 1000) / 10} %` : 'from nothing'}) from ${inr(before)} in ${q.previous.label} to ${inr(now)} in ${q.current.label}: volume ${inr(volume)}, price ${inr(price)}${added ? `, new items ${inr(added)}` : ''}${lost ? `, items not sold this time ${inr(-lost)}` : ''}.${biggest.length ? ` Biggest ${change < 0 ? 'drops' : 'gains'}: ${biggest.map((m) => `${m.code} ${inr(m.change)}`).join(', ')}.` : ''}`;
      return { ...q, answer, bridge: null, sales: { before, now, volume: Math.round(volume), price: Math.round(price), newItems: Math.round(added), lostItems: Math.round(-lost), movers: movers.slice(0, 5) } };
    });
  }
}
