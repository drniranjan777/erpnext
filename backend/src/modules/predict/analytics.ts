/**
 * Predictive analytics, pure for unit tests: when customers will pay, why margin moved between
 * two periods (price, cost and mix effects), and reading "why" questions.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function median(v: number[]) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Typical days late per customer (median of paid invoices), with the overall median as fallback. */
export function paymentHabits(paid: { customerId: string; daysLate: number }[]) {
  const by = new Map<string, number[]>();
  for (const p of paid) by.set(p.customerId, [...(by.get(p.customerId) ?? []), p.daysLate]);
  const overall = median(paid.map((p) => p.daysLate)) ?? 0;
  const habits = new Map<string, { days: number; invoices: number }>();
  for (const [c, v] of by) habits.set(c, { days: Math.round(median(v)!), invoices: v.length });
  return { habits, overall: Math.round(overall) };
}

export interface OpenInvoice {
  id: string;
  customerId: string;
  dueDate: string;
  outstanding: number;
}

/**
 * Expected collection date of each open invoice: its due date plus the customer's typical delay
 * (customers with fewer than 3 paid invoices use the overall habit), never before today. Bucketed
 * into weeks from today; anything expected 60+ days past due is marked at risk.
 */
export function predictCollections(open: OpenInvoice[], paid: { customerId: string; daysLate: number }[], today: string, weeks = 8) {
  const { habits, overall } = paymentHabits(paid);
  const rows = open.map((i) => {
    const h = habits.get(i.customerId);
    const delay = h && h.invoices >= 3 ? h.days : overall;
    let expected = addDays(i.dueDate, Math.max(0, delay));
    if (expected < today) expected = today;
    const lateBy = Math.round((Date.parse(expected) - Date.parse(i.dueDate)) / DAY);
    return { ...i, expected, typicalDelay: delay, basis: h && h.invoices >= 3 ? 'customer' : 'overall', atRisk: lateBy >= 60 };
  });
  const buckets = Array.from({ length: weeks }, (_, w) => ({ week: w + 1, from: addDays(today, w * 7), to: addDays(today, w * 7 + 6), amount: 0, invoices: 0 }));
  let later = 0;
  for (const r of rows) {
    const w = Math.floor((Date.parse(r.expected) - Date.parse(today)) / (7 * DAY));
    if (w < weeks) {
      buckets[w].amount += r.outstanding;
      buckets[w].invoices++;
    } else later += r.outstanding;
  }
  for (const b of buckets) b.amount = Math.round(b.amount * 100) / 100;
  return { rows, buckets, later: Math.round(later * 100) / 100, overallDelay: overall };
}

export interface ItemPeriod {
  itemId: string;
  code: string;
  qty: number;
  revenue: number;
  cost: number;
}

const marginPct = (rows: { qty: number; price: number; cost: number }[]) => {
  const rev = rows.reduce((s, r) => s + r.qty * r.price, 0);
  return rev ? (rows.reduce((s, r) => s + r.qty * (r.price - r.cost), 0) / rev) * 100 : 0;
};

/**
 * Explains the change in gross margin % between two periods in three steps: price (current prices,
 * previous costs and quantities), cost (then current costs) and mix (then current quantities).
 * The three effects add up to the change. Items sold in only one period move the mix.
 */
export function marginBridge(prev: ItemPeriod[], curr: ItemPeriod[]) {
  const ids = [...new Set([...prev.map((p) => p.itemId), ...curr.map((c) => c.itemId)])];
  const unit = (r: ItemPeriod | undefined) => (r && r.qty ? { price: r.revenue / r.qty, cost: r.cost / r.qty } : null);
  const rows = ids.map((id) => {
    const p = prev.find((x) => x.itemId === id);
    const c = curr.find((x) => x.itemId === id);
    const up = unit(p);
    const uc = unit(c);
    return { id, code: (c ?? p)!.code, qp: p?.qty ?? 0, qc: c?.qty ?? 0, pp: up?.price ?? uc!.price, cp: up?.cost ?? uc!.cost, pc: uc?.price ?? up!.price, cc: uc?.cost ?? up!.cost };
  });
  const m0 = marginPct(rows.map((r) => ({ qty: r.qp, price: r.pp, cost: r.cp })));
  const m1 = marginPct(rows.map((r) => ({ qty: r.qp, price: r.pc, cost: r.cp })));
  const m2 = marginPct(rows.map((r) => ({ qty: r.qp, price: r.pc, cost: r.cc })));
  const m3 = marginPct(rows.map((r) => ({ qty: r.qc, price: r.pc, cost: r.cc })));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const drivers = rows
    .map((r) => ({
      itemId: r.id,
      code: r.code,
      // ₹ effect on margin at the previous quantities.
      priceImpact: Math.round(r.qp * (r.pc - r.pp)),
      costImpact: Math.round(-r.qp * (r.cc - r.cp)),
      priceChangePct: r.pp ? r1(((r.pc - r.pp) / r.pp) * 100) : null,
      costChangePct: r.cp ? r1(((r.cc - r.cp) / r.cp) * 100) : null,
      marginPctNow: r.pc ? r1(((r.pc - r.cc) / r.pc) * 100) : null,
      qtyChange: r.qc - r.qp,
    }))
    .filter((d) => d.priceImpact || d.costImpact || d.qtyChange);
  return {
    previousPct: r1(m0),
    currentPct: r1(m3),
    changePts: r1(m3 - m0),
    effects: { price: r1(m1 - m0), cost: r1(m2 - m1), mix: r1(m3 - m2) },
    topPrice: [...drivers].filter((d) => d.priceImpact).sort((a, b) => a.priceImpact - b.priceImpact).slice(0, 3),
    topCost: [...drivers].filter((d) => d.costImpact).sort((a, b) => a.costImpact - b.costImpact).slice(0, 3),
    lowMarginGrowth: [...drivers].filter((d) => d.qtyChange > 0 && d.marginPctNow !== null && d.marginPctNow < r1(m3)).sort((a, b) => b.qtyChange - a.qtyChange).slice(0, 3),
  };
}

export interface Period {
  from: string;
  to: string;
  label: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const monthPeriod = (y: number, m: number): Period => ({ from: iso(y, m, 1), to: iso(y, m + 1, 0), label: new Date(Date.UTC(y, m, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });

/** Indian financial-year quarter: Q1 Apr–Jun … Q4 Jan–Mar. */
function quarter(fyStart: number, q: number): Period {
  const m = 3 + (q - 1) * 3;
  return { from: iso(fyStart, m, 1), to: iso(fyStart, m + 3, 0), label: `Q${q} FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}` };
}

/**
 * Reads "why did margin drop in Q2?", "why are sales down last month", "margin in August vs July".
 * The comparison period is the one before (the previous quarter or month) unless two are named.
 */
export function parseWhy(question: string, today: string) {
  const q = question.toLowerCase();
  const metric: 'margin' | 'sales' = /margin|profit|gross/.test(q) ? 'margin' : 'sales';
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const fyNow = tm >= 3 ? ty : ty - 1;
  const named: Period[] = [];
  for (const m of q.matchAll(/\bq([1-4])\b/g)) {
    const n = Number(m[1]);
    const fy = quarter(fyNow, n).from > today ? fyNow - 1 : fyNow;
    named.push(quarter(fy, n));
  }
  // Whole month names or their short forms only ("margin" is not March).
  for (const m of q.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g)) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    const y = mi > tm ? ty - 1 : ty;
    named.push(monthPeriod(y, mi));
  }
  if (/last month|previous month|pichhle mahine/.test(q)) named.push(monthPeriod(tm === 0 ? ty - 1 : ty, (tm + 11) % 12));
  if (/this month|is mahine/.test(q)) named.push({ ...monthPeriod(ty, tm), to: today });
  if (/last quarter|previous quarter/.test(q)) {
    const cq = Math.floor(((tm + 9) % 12) / 3) + 1;
    named.push(cq === 1 ? quarter(fyNow - 1, 4) : quarter(fyNow, cq - 1));
  }
  if (!named.length) named.push({ ...monthPeriod(ty, tm), to: today });
  named.sort((a, b) => a.from.localeCompare(b.from));
  const current = named[named.length - 1];
  let previous = named.length > 1 ? named[named.length - 2] : null;
  if (!previous) {
    const len = Math.round((Date.parse(current.to) - Date.parse(current.from)) / DAY) + 1;
    if (len > 80) {
      const s = new Date(Date.parse(`${current.from}T00:00:00Z`));
      previous = { from: iso(s.getUTCFullYear(), s.getUTCMonth() - 3, 1), to: iso(s.getUTCFullYear(), s.getUTCMonth(), 0), label: 'the quarter before' };
    } else {
      const s = new Date(Date.parse(`${current.from}T00:00:00Z`));
      previous = monthPeriod(s.getUTCFullYear(), s.getUTCMonth() - 1);
    }
  }
  return { metric, current, previous };
}
