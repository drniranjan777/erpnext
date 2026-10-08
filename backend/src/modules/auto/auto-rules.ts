import type { ApqpDeliverable, PpapElement } from '@nextgen/database';

/**
 * Automotive rules, kept pure: APQP deliverables, PPAP elements by submission level, AIAG-VDA
 * FMEA action priority, layered process audit scoring, and EDIFACT messages with OEMs.
 */

// ---- APQP ---------------------------------------------------------------------------------------

const APQP_PHASES = ['Plan and define', 'Product design and development', 'Process design and development', 'Product and process validation', 'Feedback, assessment and corrective action'];

const D: [number, string, string][] = [
  [1, 'P1-01', 'Voice of the customer and customer-specific requirements'],
  [1, 'P1-02', 'Design goals, reliability and quality goals'],
  [1, 'P1-03', 'Preliminary bill of materials and process flow'],
  [1, 'P1-04', 'Preliminary special characteristics'],
  [1, 'P1-05', 'Feasibility commitment'],
  [2, 'P2-01', 'Design FMEA'],
  [2, 'P2-02', 'Design verification plan and report'],
  [2, 'P2-03', 'Engineering drawings and specifications'],
  [2, 'P2-04', 'New equipment, tooling and gauges requirements'],
  [2, 'P2-05', 'Prototype control plan and prototype build'],
  [3, 'P3-01', 'Process flow chart and floor plan'],
  [3, 'P3-02', 'Process FMEA'],
  [3, 'P3-03', 'Pre-launch control plan'],
  [3, 'P3-04', 'Process instructions'],
  [3, 'P3-05', 'Measurement system analysis plan'],
  [3, 'P3-06', 'Packaging standards and specifications'],
  [4, 'P4-01', 'Significant production run'],
  [4, 'P4-02', 'Measurement system evaluation (MSA)'],
  [4, 'P4-03', 'Preliminary process capability study'],
  [4, 'P4-04', 'Production validation testing'],
  [4, 'P4-05', 'Production control plan'],
  [4, 'P4-06', 'PPAP approval'],
  [5, 'P5-01', 'Reduced variation and customer satisfaction review'],
  [5, 'P5-02', 'Lessons learned'],
];

export function apqpTemplate(): ApqpDeliverable[] {
  return D.map(([phase, code, name]) => ({ code, phase, name, status: 'open', owner: null, due: null, notes: null }));
}

/** Progress per phase, and whether a phase is ready for its gate (every deliverable done or not applicable). */
export function apqpProgress(ds: ApqpDeliverable[]) {
  return APQP_PHASES.map((name, i) => {
    const p = ds.filter((d) => d.phase === i + 1);
    const done = p.filter((d) => d.status === 'done' || d.status === 'na').length;
    return { phase: i + 1, name, total: p.length, done, pct: p.length ? Math.round((done / p.length) * 100) : 100, ready: done === p.length };
  });
}

// ---- PPAP ---------------------------------------------------------------------------------------

const PPAP_ELEMENTS = [
  'Design records',
  'Authorised engineering change documents',
  'Customer engineering approval',
  'Design FMEA',
  'Process flow diagram',
  'Process FMEA',
  'Control plan',
  'Measurement system analysis studies',
  'Dimensional results',
  'Material and performance test results',
  'Initial process studies',
  'Qualified laboratory documentation',
  'Appearance approval report',
  'Sample production parts',
  'Master sample',
  'Checking aids',
  'Customer-specific requirements',
  'Part submission warrant (PSW)',
];

/** AIAG PPAP 4th edition retention / submission requirements by level (S submit, R retain, * as specified). */
const MATRIX: Record<number, string> = {
  1: 'RRRRRRRRRRRRSRRRRS',
  2: 'SSRRRRRRSSRSSSRRRS',
  3: 'SSSSSSSSSSSSSSRRSS',
  4: '*****************S',
  5: 'RRRRRRRRRRRRRRRRRR',
};

export function ppapElements(level: number): PpapElement[] {
  return PPAP_ELEMENTS.map((name, i) => ({ no: i + 1, name, requirement: MATRIX[level][i] as 'S' | 'R' | '*', status: 'not_started', reference: null, notes: null }));
}

/** Elements still open: everything to submit (or as specified) must be complete or not applicable. */
export function ppapOpen(elements: PpapElement[]) {
  return elements.filter((e) => e.no !== 18 && e.requirement !== 'R' && e.status !== 'complete' && e.status !== 'na');
}

// ---- FMEA (AIAG-VDA action priority) ------------------------------------------------------------

const band = (o: number) => (o >= 8 ? 0 : o >= 6 ? 1 : o >= 4 ? 2 : o >= 2 ? 3 : 4);
const dBand = (d: number) => (d >= 7 ? 0 : d >= 5 ? 1 : d >= 2 ? 2 : 3);
type AP = 'H' | 'M' | 'L';
/** Rows: occurrence bands 8–10, 6–7, 4–5, 2–3, 1; columns: detection 7–10, 5–6, 2–4, 1. */
const TABLE: Record<string, AP[][]> = {
  s9: [['H', 'H', 'H', 'H'], ['H', 'H', 'H', 'H'], ['H', 'H', 'H', 'M'], ['H', 'M', 'L', 'L'], ['L', 'L', 'L', 'L']],
  s7: [['H', 'H', 'H', 'H'], ['H', 'H', 'H', 'M'], ['H', 'M', 'M', 'M'], ['M', 'M', 'L', 'L'], ['L', 'L', 'L', 'L']],
  s4: [['H', 'H', 'M', 'M'], ['M', 'M', 'M', 'L'], ['M', 'L', 'L', 'L'], ['L', 'L', 'L', 'L'], ['L', 'L', 'L', 'L']],
  s2: [['M', 'M', 'L', 'L'], ['L', 'L', 'L', 'L'], ['L', 'L', 'L', 'L'], ['L', 'L', 'L', 'L'], ['L', 'L', 'L', 'L']],
};

/** AIAG-VDA (2019) action priority for severity, occurrence and detection ratings (1–10). */
export function actionPriority(s: number, o: number, d: number): AP {
  if (s <= 1) return 'L';
  const t = s >= 9 ? TABLE.s9 : s >= 7 ? TABLE.s7 : s >= 4 ? TABLE.s4 : TABLE.s2;
  return t[band(o)][dBand(d)];
}

// ---- LPA ----------------------------------------------------------------------------------------

export function lpaScore(answers: { answer: 'yes' | 'no' | 'na' }[]) {
  const counted = answers.filter((a) => a.answer !== 'na');
  const yes = counted.filter((a) => a.answer === 'yes').length;
  return { questions: answers.length, findings: counted.length - yes, compliancePct: counted.length ? Math.round((yes / counted.length) * 1000) / 10 : null };
}

// ---- EDIFACT ------------------------------------------------------------------------------------

export type Segment = string[][];

/** Splits an EDIFACT interchange into segments → elements → components, honouring the release character. */
export function parseEdifact(raw: string): { tag: string; elements: string[][] }[] {
  let text = raw.replace(/\r?\n/g, '');
  let comp = ':';
  let el = '+';
  let rel = '?';
  let term = "'";
  if (text.startsWith('UNA')) {
    comp = text[3];
    el = text[4];
    rel = text[6];
    term = text[8];
    text = text.slice(9);
  }
  const segments: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === rel && i + 1 < text.length) {
      cur += rel + text[++i];
      continue;
    }
    if (c === term) {
      if (cur.trim()) segments.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segments.push(cur);
  const split = (s: string, sep: string) => {
    const out: string[] = [];
    let part = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === rel && i + 1 < s.length) {
        part += s[++i];
        continue;
      }
      if (s[i] === sep) {
        out.push(part);
        part = '';
        continue;
      }
      part += s[i];
    }
    out.push(part);
    return out;
  };
  return segments.map((s) => {
    const elements = split(s, el).map((e) => split(e, comp));
    return { tag: elements[0][0].trim(), elements: elements.slice(1) };
  });
}

const esc = (v: string) => v.replace(/([?:+'])/g, '?$1');
/** One segment: tag, then elements (strings or component arrays). */
function seg(tag: string, ...elements: (string | (string | null | undefined)[] | null | undefined)[]) {
  const parts = elements.map((e) => (Array.isArray(e) ? e.map((c) => esc(c ?? '')).join(':') : esc(e ?? '')));
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return `${[tag, ...parts].join('+')}'`;
}

const edDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
const fromEd = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v);

export interface ScheduleLine {
  part: string;
  qty: number;
  date: string;
  /** firm (commitment level 1 / JIT call) or forecast */
  firm: boolean;
}

/** Delivery schedule (DELFOR) or JIT call (DELJIT): who it is from and the dated quantities per part. */
export function readSchedule(raw: string) {
  const segs = parseEdifact(raw);
  const unh = segs.find((s) => s.tag === 'UNH');
  const type = unh?.elements[1]?.[0] ?? '';
  if (type !== 'DELFOR' && type !== 'DELJIT') throw new Error(`Not a delivery schedule (${type || 'no UNH'})`);
  const unb = segs.find((s) => s.tag === 'UNB');
  const bgm = segs.find((s) => s.tag === 'BGM');
  const lines: ScheduleLine[] = [];
  let part: string | null = null;
  let firm = type === 'DELJIT';
  let qty: number | null = null;
  for (const s of segs) {
    if (s.tag === 'LIN') {
      part = s.elements[2]?.[0] || s.elements[0]?.[0] || null;
      firm = type === 'DELJIT';
    } else if (s.tag === 'PIA' && !part) part = s.elements[1]?.[0] ?? null;
    else if (s.tag === 'SCC') firm = s.elements[0]?.[0] === '1';
    else if (s.tag === 'QTY' && ['113', '1', '12'].includes(s.elements[0]?.[0] ?? '')) qty = Number(s.elements[0][1]);
    else if (s.tag === 'DTM' && ['2', '10', '64', '158'].includes(s.elements[0]?.[0] ?? '') && part && qty !== null) {
      lines.push({ part, qty, date: fromEd(s.elements[0][1]), firm });
      qty = null;
    }
  }
  return { type, sender: unb?.elements[1]?.[0] ?? null, receiver: unb?.elements[2]?.[0] ?? null, reference: bgm?.elements[1]?.[0] ?? null, lines };
}

function envelope(type: string, sender: string, receiver: string, ref: string, now: Date, body: string[]) {
  const ts = now.toISOString();
  const yymmdd = ts.slice(2, 10).replace(/-/g, '');
  const hhmm = ts.slice(11, 16).replace(':', '');
  const msg = [seg('UNH', '1', [type, 'D', '96A', 'UN']), ...body];
  return [seg('UNB', ['UNOC', '3'], sender, receiver, [yymmdd, hhmm], ref), ...msg, seg('UNT', String(msg.length + 1), '1'), seg('UNZ', '1', ref)].join('\n');
}

/** Despatch advice (DESADV) for a delivery. */
export function buildDesadv(d: { sender: string; receiver: string; number: string; date: string; orderRef?: string | null; lines: { part: string; qty: number; uom?: string }[]; now?: Date }) {
  const body = [
    seg('BGM', '351', d.number, '9'),
    seg('DTM', ['137', edDate(d.date), '102']),
    seg('DTM', ['11', edDate(d.date), '102']),
    ...(d.orderRef ? [seg('RFF', ['ON', d.orderRef])] : []),
    seg('NAD', 'BY', [d.receiver]),
    seg('NAD', 'SE', [d.sender]),
    seg('CPS', '1'),
    ...d.lines.flatMap((l, i) => [seg('LIN', String(i + 1), '', [l.part, 'IN']), seg('QTY', ['12', String(l.qty), l.uom ?? 'PCE'])]),
  ];
  return envelope('DESADV', d.sender, d.receiver, d.number.replace(/[^A-Za-z0-9]/g, '').slice(0, 14), d.now ?? new Date(), body);
}

/** Invoice (INVOIC) with GST as VAT. */
export function buildInvoic(d: { sender: string; receiver: string; number: string; date: string; currency?: string; lines: { part: string; qty: number; price: number; amount: number; gstRate: number }[]; taxable: number; tax: number; total: number; now?: Date }) {
  const body = [
    seg('BGM', '380', d.number, '9'),
    seg('DTM', ['137', edDate(d.date), '102']),
    seg('NAD', 'BY', [d.receiver]),
    seg('NAD', 'SU', [d.sender]),
    seg('CUX', ['2', d.currency ?? 'INR', '4']),
    ...d.lines.flatMap((l, i) => [seg('LIN', String(i + 1), '', [l.part, 'IN']), seg('QTY', ['47', String(l.qty)]), seg('MOA', ['203', l.amount.toFixed(2)]), seg('PRI', ['AAA', l.price.toFixed(4)]), seg('TAX', '7', ['VAT'], '', '', ['', '', '', String(l.gstRate)])]),
    seg('UNS', 'S'),
    seg('MOA', ['77', d.total.toFixed(2)]),
    seg('MOA', ['125', d.taxable.toFixed(2)]),
    seg('MOA', ['124', d.tax.toFixed(2)]),
  ];
  return envelope('INVOIC', d.sender, d.receiver, d.number.replace(/[^A-Za-z0-9]/g, '').slice(0, 14), d.now ?? new Date(), body);
}
