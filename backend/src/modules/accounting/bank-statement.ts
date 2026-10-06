import { normaliseHeader } from '../imports/file-parser';

/** One transaction of a bank statement. */
export interface StatementLine {
  txnDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  withdrawal: string;
  deposit: string;
  balance: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Bank statement dates: 05/10/2026, 05-10-26, 05-Oct-2026, 05 Oct 26, 2026-10-05. Day first. */
export function statementDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3})[A-Za-z]*[\s/-]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}

function iso(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? dt.toISOString().slice(0, 10) : null;
}

/** "1,23,456.78", "1234.5 Cr", "(500.00)" → positive amount text, or null. */
function amount(v: string | undefined) {
  if (!v) return null;
  const s = v.replace(/[,₹\s]/g, '').replace(/(Cr|Dr|CR|DR)\.?$/, '').replace(/^\((.*)\)$/, '$1').replace(/^-/, '');
  return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? Number(s).toFixed(2) : null;
}

/** Running balance keeps its sign: "-2,105.00", "(2,105.00)" or "2,105.00 Dr" are overdrawn. */
function signedBalance(v: string | undefined) {
  if (!v || !v.trim()) return null;
  const t = v.trim();
  const neg = /^-/.test(t) || /^\(.*\)$/.test(t) || /dr\.?$/i.test(t);
  const s = t.replace(/[,₹\s()]/g, '').replace(/(Cr|Dr|CR|DR)\.?$/, '').replace(/^-/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return `${neg && Number(s) ? '-' : ''}${Number(s).toFixed(2)}`;
}

const pick = (h: string[], ...names: RegExp[]) => h.findIndex((x) => names.some((n) => n.test(x)));

/**
 * Bank statement from a CSV / Excel table. Finds the header row (skipping the bank's preamble)
 * by a date column plus withdrawal / deposit (or debit / credit, or amount + Dr/Cr) columns.
 */
export function parseStatementTable(table: string[][]): StatementLine[] {
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const h = table[i].map(normaliseHeader);
    const date = pick(h, /^(txn_|transaction_|tran_|posting_)?date$/, /^date$/, /^value_dt$/);
    const valueDate = pick(h, /^value_(date|dt)$/);
    const desc = pick(h, /narration/, /description/, /particulars/, /^remarks?$/, /details/);
    const ref = pick(h, /chq|cheque|ref/);
    const wd = pick(h, /withdrawal/, /^debit(_amount)?$/, /^dr(_amount)?$/, /paid_out/);
    const dp = pick(h, /deposit/, /^credit(_amount)?$/, /^cr(_amount)?$/, /paid_in/);
    const amt = pick(h, /^amount$/, /^txn_amount$/, /^transaction_amount$/);
    const drcr = pick(h, /^(dr_cr|cr_dr|type|debit_credit)$/);
    const bal = pick(h, /balance/);
    if (date < 0 || desc < 0 || ((wd < 0 || dp < 0) && (amt < 0 || drcr < 0))) continue;
    const out: StatementLine[] = [];
    for (const row of table.slice(i + 1)) {
      const d = statementDate(row[date] ?? '');
      if (!d) continue;
      let w = wd >= 0 ? amount(row[wd]) : null;
      let p = dp >= 0 ? amount(row[dp]) : null;
      if (wd < 0) {
        const a = amount(row[amt]);
        const isDr = /^d/i.test((row[drcr] ?? '').trim());
        w = isDr ? a : null;
        p = isDr ? null : a;
      }
      if (!w && !p) continue;
      out.push({
        txnDate: d,
        valueDate: valueDate >= 0 && valueDate !== date ? statementDate(row[valueDate] ?? '') : null,
        description: (row[desc] ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
        reference: ref >= 0 && ref !== desc ? (row[ref] ?? '').trim() || null : null,
        withdrawal: w ?? '0.00',
        deposit: p ?? '0.00',
        balance: bal >= 0 ? signedBalance(row[bal]) : null,
      });
    }
    return out;
  }
  throw new Error('Could not find the statement columns: the file needs a date, a description and withdrawal / deposit (or amount + Dr/Cr) columns');
}

/** SWIFT MT940: :61: statement lines with their :86: narrative. */
export function parseMt940(text: string): StatementLine[] {
  const out: StatementLine[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^:61:(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])([A-Z])?(\d+,\d{0,2})N?[A-Z0-9]{0,3}(.*)$/);
    if (!m) continue;
    const date = iso(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
    if (!date) continue;
    const amt = Number(m[7].replace(',', '.')).toFixed(2);
    const credit = m[5].endsWith('C') !== m[5].startsWith('R');
    let narrative = '';
    for (let j = i + 1; j < lines.length && !/^:\d{2}[A-Z]?:/.test(lines[j]); j++) narrative += ` ${lines[j]}`;
    if (lines[i + 1]?.startsWith(':86:')) {
      narrative = lines[i + 1].slice(4);
      for (let j = i + 2; j < lines.length && !/^:\d{2}[A-Z]?:/.test(lines[j]); j++) narrative += ` ${lines[j]}`;
    }
    const ref = m[8].split('//')[0].trim();
    out.push({ txnDate: date, valueDate: null, description: narrative.replace(/\s+/g, ' ').trim().slice(0, 500) || ref, reference: ref || null, withdrawal: credit ? '0.00' : amt, deposit: credit ? amt : '0.00', balance: null });
  }
  return out;
}

export interface BookEntry {
  id: string;
  postingDate: string;
  /** Money into the bank (debit) is positive, out (credit) negative. */
  amount: string;
  /** Text to look for in the statement: voucher number, cheque number, party. */
  refs: string[];
}

export interface Match {
  lineIndex: number;
  entryIds: string[];
  rule: 'reference' | 'amount_date' | 'amount_window';
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Auto-matching, strongest rule first: same amount and a reference (cheque / voucher number)
 * in the narration; then same amount within 3 days when exactly one entry fits; then within
 * 10 days when exactly one fits. Each entry matches at most one line.
 */
export function autoMatch(lines: StatementLine[], entries: BookEntry[]): Match[] {
  const used = new Set<string>();
  const out: Match[] = [];
  const signed = (l: StatementLine) => (Number(l.deposit) - Number(l.withdrawal)).toFixed(2);
  const pending = lines.map((l, i) => ({ l, i, amt: signed(l), text: `${l.description} ${l.reference ?? ''}`.toUpperCase() }));
  const candidates = (amt: string) => entries.filter((e) => !used.has(e.id) && Number(e.amount).toFixed(2) === amt);
  const take = (p: (typeof pending)[number], e: BookEntry, rule: Match['rule']) => {
    used.add(e.id);
    out.push({ lineIndex: p.i, entryIds: [e.id], rule });
  };
  const done = new Set<number>();
  for (const p of pending) {
    const hit = candidates(p.amt).find((e) => e.refs.some((r) => r && r.length >= 4 && p.text.includes(r.toUpperCase())));
    if (hit) {
      take(p, hit, 'reference');
      done.add(p.i);
    }
  }
  for (const [rule, window] of [['amount_date', 3], ['amount_window', 10]] as const) {
    for (const p of pending) {
      if (done.has(p.i)) continue;
      const near = candidates(p.amt).filter((e) => daysApart(e.postingDate, p.l.txnDate) <= window);
      if (near.length === 1) {
        take(p, near[0], rule);
        done.add(p.i);
      }
    }
  }
  return out;
}
