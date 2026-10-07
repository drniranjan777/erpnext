import { extractDocument, type DocKind } from '../docai/extractors';
import { triage } from '../service/sla';
import { scoreEval } from '../voice/eval-set';
import { parseCommand } from '../voice/grammar';

/**
 * Evaluation sets for the AI features that run on rules (and are the fallback when the model is
 * off): run on demand from AI → Governance and kept as history, so a change that lowers quality
 * shows up as a drop in score.
 */

export interface EvalResult {
  cases: number;
  passed: number;
  scorePct: number;
  details: Record<string, unknown>;
}

const pct = (passed: number, cases: number) => (cases ? Math.round((passed / cases) * 1000) / 10 : 0);

const TRIAGE_EVAL: {
  subject: string;
  description: string;
  category: string;
  priority: string;
}[] = [
  {
    subject: 'Pump not working',
    description: 'The pump stopped this morning and is making noise.',
    category: 'breakdown',
    priority: 'high',
  },
  {
    subject: 'URGENT line down',
    description: 'Production stopped, motor tripping again and again.',
    category: 'breakdown',
    priority: 'urgent',
  },
  {
    subject: 'Installation of new chiller',
    description: 'Please send an engineer for installation next week.',
    category: 'installation',
    priority: 'medium',
  },
  {
    subject: 'Warranty replacement',
    description: 'Controller card needs replacement under warranty.',
    category: 'warranty',
    priority: 'medium',
  },
  {
    subject: 'Damaged on arrival',
    description: 'Two cartons came broken, very unhappy with packing.',
    category: 'complaint',
    priority: 'medium',
  },
  {
    subject: 'Price list',
    description: 'Please share your latest price list',
    category: 'query',
    priority: 'low',
  },
  {
    subject: 'Spare part availability',
    description: 'Is the impeller for model P-40 in stock?',
    category: 'query',
    priority: 'medium',
  },
  {
    subject: 'Smoke from panel',
    description: 'Smoke coming out of the control panel, emergency',
    category: 'query',
    priority: 'urgent',
  },
  {
    subject: 'Oil leak',
    description: 'Gearbox leaking oil since yesterday',
    category: 'breakdown',
    priority: 'high',
  },
  {
    subject: 'Commissioning',
    description: 'Need commissioning of the compressor at our Pune plant',
    category: 'installation',
    priority: 'medium',
  },
  {
    subject: 'Poor quality bearings',
    description: 'Complaint about bearings supplied last month',
    category: 'complaint',
    priority: 'medium',
  },
  {
    subject: 'Machine overheat',
    description: 'Extruder overheating, please attend asap',
    category: 'breakdown',
    priority: 'urgent',
  },
];

export function evalTriage(): EvalResult {
  const rows = TRIAGE_EVAL.map((c) => {
    const r = triage(c.subject, c.description);
    const misses = [r.category !== c.category ? `category ${r.category} ≠ ${c.category}` : '', r.priority !== c.priority ? `priority ${r.priority} ≠ ${c.priority}` : ''].filter(Boolean);
    return { text: c.subject, ok: !misses.length, misses };
  });
  const passed = rows.filter((r) => r.ok).length;
  return {
    cases: rows.length,
    passed,
    scorePct: pct(passed, rows.length),
    details: { failures: rows.filter((r) => !r.ok) },
  };
}

const DOC_EVAL: {
  name: string;
  text: string;
  kind: DocKind;
  fields: Record<string, unknown>;
}[] = [
  {
    name: 'e-way bill',
    kind: 'eway_bill',
    text: `e-Way Bill
E-Way Bill No: 3412 5678 9012
Generated Date: 05/10/2026  Valid Upto: 07/10/2026
GSTIN of Supplier 36AABCS1234E1ZU  GSTIN of Recipient 27AAACN0000A1ZL
Document No. INV/26/0456  Document Date 05/10/2026
Vehicle No: TS 08 UB 4455
Total Invoice Value: 2,45,600.00`,
    fields: { ewbNo: '341256789012', vehicleNo: 'TS08UB4455', value: 245600 },
  },
  {
    name: 'certificate of analysis',
    kind: 'coa',
    text: `CERTIFICATE OF ANALYSIS
Product Name: Calcium carbonate IP
Batch No: CC-2609-14     Mfg. Date: 12/09/2026     Expiry Date: 11/09/2028
S.No  Test    Specification    Result
1  pH    9.0 - 10.5    9.6
2  Assay    NLT 98.0 %    97.4 %`,
    fields: { batchNo: 'CC-2609-14', conclusion: 'fails' },
  },
  {
    name: 'vendor quotation',
    kind: 'quotation',
    text: `QUOTATION
GSTIN: 36AABCD1234E1Z9
Quotation No: Q-77   Date: 03-Oct-2026   Validity: 30 days
Sr Description HSN Qty Unit Rate Amount
1 HDPE Granules Natural 390120 1000 KGS 118.50 1,18,500.00
Delivery within 7 days.`,
    fields: { quoteNo: 'Q-77', validDays: 30, deliveryDays: 7 },
  },
  {
    name: 'bank statement',
    kind: 'bank_statement',
    text: `HDFC BANK  Statement of Account
A/c No: XXXXXX4521   IFSC: HDFC0001234
Date        Narration                          Withdrawal     Deposit        Balance
01/10/2026  Opening balance                                                1,00,000.00
02/10/2026  NEFT-DECCAN FOODS-INV 451        0.00          59,000.00      1,59,000.00`,
    fields: { ifsc: 'HDFC0001234' },
  },
  {
    name: 'delivery challan',
    kind: 'delivery_challan',
    text: 'DELIVERY CHALLAN\nChallan No: DC/112   Date: 04/10/2026\nReturnable',
    fields: {},
  },
];

export function evalDocuments(): EvalResult {
  const rows = DOC_EVAL.map((c) => {
    const r = extractDocument(c.text);
    const misses: string[] = [];
    if (r.kind !== c.kind) misses.push(`kind ${r.kind} ≠ ${c.kind}`);
    for (const [k, v] of Object.entries(c.fields)) if (r.fields[k] !== v) misses.push(`${k} ${String(r.fields[k])} ≠ ${String(v)}`);
    return { text: c.name, ok: !misses.length, misses };
  });
  const passed = rows.filter((r) => r.ok).length;
  return {
    cases: rows.length,
    passed,
    scorePct: pct(passed, rows.length),
    details: { failures: rows.filter((r) => !r.ok) },
  };
}

export function evalVoice(): EvalResult {
  const r = scoreEval(parseCommand);
  return {
    cases: r.cases,
    passed: r.cases - r.failures.length,
    scorePct: r.accuracyPct,
    details: { byLanguage: r.byLanguage, failures: r.failures },
  };
}

export const EVAL_SUITES = {
  voice: { name: 'Voice commands', run: evalVoice },
  triage: { name: 'Ticket triage', run: evalTriage },
  documents: { name: 'Document reading', run: evalDocuments },
} as const;
export type EvalSuite = keyof typeof EVAL_SUITES;
