/**
 * Document AI without a model: recognises the kind of document from its text and reads its
 * fields. Covers delivery challans, e-way bills, certificates of analysis, vendor quotations and
 * bank statements (supplier bills use the Phase 4 bill capture). Pure, unit tested; scans and
 * handwriting need the AI path.
 */
import { extractFromText, money, parseDate } from '../purchase/capture/text-extractor';

export type DocKind = 'delivery_challan' | 'eway_bill' | 'coa' | 'quotation' | 'bank_statement' | 'invoice' | 'unknown';

export interface Extracted {
  kind: DocKind;
  confidence: number;
  fields: Record<string, string | number | boolean | null>;
  lines: Record<string, string | number | boolean | null>[];
  warnings: string[];
}

const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
const VEHICLE = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{3,4})\b/;
/** The value after a label like "Challan No:" (a "No" word or a colon is required, and the value has a digit). */
const after = (text: string, labels: string, pattern = '([A-Z0-9/\\-]*\\d[A-Z0-9/\\-]*)') => new RegExp(`(?:${labels})\\s*(?:(?:no\\.?|number|#)\\s*[:.\\-]?|[:\\-])\\s*${pattern}`, 'i').exec(text)?.[1] ?? null;
const dateAfter = (text: string, labels: string) => {
  const m = new RegExp(`(?:${labels})\\s*[:.\\-]?\\s*(\\d{1,2}[/.\\-][A-Za-z0-9]{1,9}[/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, 'i').exec(text);
  return m ? parseDate(m[1]) : null;
};

export function detectKind(text: string): { kind: DocKind; confidence: number } {
  const t = text.toLowerCase();
  const score: [DocKind, number][] = [
    ['eway_bill', (/e-?way\s*bill/.test(t) ? 3 : 0) + (/\bewb\b|e-?way bill no/.test(t) ? 2 : 0) + (/valid (?:upto|until|till)/.test(t) ? 1 : 0)],
    ['coa', (/certificate of analysis|\bc\.?o\.?a\.?\b/.test(t) ? 3 : 0) + (/specification|\bspec\b/.test(t) ? 1 : 0) + (/\bresult\b/.test(t) ? 1 : 0) + (/batch|lot/.test(t) ? 1 : 0)],
    ['delivery_challan', (/delivery challan|\bchallan\b/.test(t) ? 3 : 0) + (/not for sale|returnable|job work/.test(t) ? 1 : 0)],
    ['quotation', (/quotation|\bquote\b|proforma|our offer|price offer/.test(t) ? 3 : 0) + (/valid(?:ity)? (?:for|till|upto|until)|validity/.test(t) ? 1 : 0)],
    ['bank_statement', (/statement of account|account statement|bank statement/.test(t) ? 3 : 0) + (/opening balance|closing balance/.test(t) ? 1 : 0) + (/withdrawal|deposit|\bdr\b|\bcr\b/.test(t) ? 1 : 0)],
    ['invoice', (/tax invoice|\binvoice no/.test(t) ? 3 : 0)],
  ];
  score.sort((a, b) => b[1] - a[1]);
  const [kind, s] = score[0];
  return s >= 3 ? { kind, confidence: Math.min(0.95, 0.5 + s * 0.1) } : { kind: 'unknown', confidence: 0.2 };
}

function vehicle(text: string) {
  const m = VEHICLE.exec(text.toUpperCase());
  return m ? `${m[1]}${m[2].padStart(2, '0')}${m[3]}${m[4]}` : null;
}

function challan(text: string): Extracted {
  const bill = extractFromText(text);
  return {
    kind: 'delivery_challan',
    confidence: 0.7,
    fields: {
      challanNo: after(text, 'challan|dc|d\\.c\\.'),
      date: dateAfter(text, 'date|dated|challan date') ?? bill.invoiceDate,
      fromGstin: bill.supplierGstin,
      toGstin: bill.buyerGstin,
      fromName: bill.supplierName,
      vehicleNo: vehicle(text),
      purpose: /job\s*work/i.test(text) ? 'job work' : /returnable/i.test(text) ? 'returnable' : /approval/i.test(text) ? 'on approval' : 'supply',
      poRef: after(text, 'p\\.?o\\.?|purchase order|order ref'),
    },
    lines: bill.lines.map((l) => ({ description: l.description, hsnCode: l.hsnCode, qty: l.qty, unit: l.unit })),
    warnings: bill.lines.length ? [] : ['No item lines were found.'],
  };
}

function ewayBill(text: string): Extracted {
  const gstins = [...new Set(text.toUpperCase().match(GSTIN) ?? [])];
  const ewb = /\b(\d{4}\s?\d{4}\s?\d{4})\b/.exec(/e-?way bill no[^0-9]*([0-9 ]{12,14})/i.exec(text)?.[1] ?? text)?.[1]?.replace(/\s/g, '') ?? null;
  const validUntil = dateAfter(text, 'valid upto|valid until|valid till|validity');
  const generated = dateAfter(text, 'generated date|generated on|date of generation|gen\\.? date');
  const value = money(/(?:total (?:invoice )?value|value of goods|taxable amount)\s*[:₹Rs.\s]*([\d,]+(?:\.\d+)?)/i.exec(text)?.[1]);
  const warnings: string[] = [];
  if (!ewb || ewb.length !== 12) warnings.push('E-way bill number (12 digits) not found.');
  if (validUntil && generated && validUntil < generated) warnings.push('Valid-until is before the generation date.');
  return {
    kind: 'eway_bill',
    confidence: ewb ? 0.85 : 0.5,
    fields: {
      ewbNo: ewb,
      generatedOn: generated,
      validUntil,
      fromGstin: gstins[0] ?? null,
      toGstin: gstins[1] ?? null,
      documentNo: after(text, 'doc(?:ument)?\\.?') ?? after(text, 'invoice'),
      documentDate: dateAfter(text, 'doc(?:ument)? date|invoice date'),
      vehicleNo: vehicle(text),
      value: value ? Number(value) : null,
      distanceKm: Number(/(?:approx(?:imate)?\s*)?distance[^0-9]*(\d{1,4})/i.exec(text)?.[1] ?? '') || null,
    },
    lines: [],
    warnings,
  };
}

/** "6.5 - 7.5", "NLT 98", "≤ 0.5", "max 0.2", "Complies": whether a result meets it. */
export function meetsSpec(spec: string, result: string): boolean | null {
  const s = spec.toLowerCase().replace(/\s+/g, ' ').trim();
  const r = result.toLowerCase().trim();
  if (/complies|conforms|passes|absent|clear/.test(s) || /^(complies|conforms|passes|ok|pass)$/.test(r)) return /complies|conforms|pass|ok|absent|clear|nil/.test(r) ? true : /does not|fail|not complies/.test(r) ? false : null;
  const v = Number(/-?\d+(\.\d+)?/.exec(r)?.[0]);
  if (Number.isNaN(v)) return null;
  const range = /(-?\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (range) return v >= Number(range[1]) && v <= Number(range[2]);
  const min = /(?:nlt|not less than|min(?:imum)?|≥|>=)\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (min) return v >= Number(min[1]);
  const max = /(?:nmt|not more than|max(?:imum)?|≤|<=)\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (max) return v <= Number(max[1]);
  return null;
}

function coa(text: string): Extracted {
  const lines: Extracted['lines'] = [];
  for (const raw of text.split(/\r?\n/)) {
    // "pH   6.5 - 7.5   6.9" or "Assay | NLT 98.0 % | 99.2 %" (spec then result, separated by 2+ spaces, tabs or bars).
    const cells = raw.split(/\s{2,}|\t|\|/).map((c) => c.trim()).filter(Boolean);
    // Header rows like "Batch No: X   Mfg. Date: Y" are label: value pairs, not results.
    if (cells.length < 3 || cells.some((c) => /^[A-Za-z .]+:\s*\S/.test(c))) continue;
    const [name, spec, result] = cells.length > 3 ? [cells[cells.length - 3], cells[cells.length - 2], cells[cells.length - 1]] : (cells as [string, string, string]);
    if (/^(parameter|test|tests|characteristic|s\.?\s?no)/i.test(name) || !/[\d]|complies|conforms|nil|absent/i.test(spec + result)) continue;
    lines.push({ parameter: name.replace(/^\d+[.)]\s*/, ''), specification: spec, result, pass: meetsSpec(spec, result) });
  }
  const failed = lines.filter((l) => l.pass === false);
  return {
    kind: 'coa',
    confidence: lines.length ? 0.8 : 0.5,
    fields: {
      product: /(?:product|material|name of (?:the )?product)\s*(?:name)?\s*[:\-]\s*(.+)/i.exec(text)?.[1]?.trim() ?? null,
      batchNo: after(text, 'batch|lot|b\\.\\s?no'),
      mfgDate: dateAfter(text, 'mfg\\.? date|manufactur(?:ing|ed) (?:date|on)|date of manufacture'),
      expiryDate: dateAfter(text, 'exp(?:iry)?\\.? date|expir(?:y|es) (?:date|on)|use before|retest date'),
      supplierGstin: (text.toUpperCase().match(GSTIN) ?? [])[0] ?? null,
      conclusion: failed.length ? 'fails' : lines.length ? (/does not comply|rejected/i.test(text) ? 'fails' : 'complies') : null,
    },
    lines,
    warnings: [...(lines.length ? [] : ['No test results were found.']), ...failed.map((f) => `${f.parameter}: ${f.result} is outside ${f.specification}`)],
  };
}

function quotation(text: string): Extracted {
  const bill = extractFromText(text);
  const validDays = Number(/valid(?:ity)?\s*[:-]?\s*(?:for)?\s*(\d{1,3})\s*days/i.exec(text)?.[1] ?? '') || null;
  return {
    kind: 'quotation',
    confidence: bill.lines.length ? 0.75 : 0.5,
    fields: {
      quoteNo: after(text, 'quotation|quote|ref(?:erence)?|offer'),
      date: dateAfter(text, 'date|dated') ?? bill.invoiceDate,
      vendorName: bill.supplierName,
      vendorGstin: bill.supplierGstin,
      validUntil: dateAfter(text, 'valid (?:till|upto|until)|validity'),
      validDays,
      deliveryDays: Number(/deliver(?:y)?[^0-9]{0,30}(\d{1,3})\s*(?:days|working days)/i.exec(text)?.[1] ?? '') || null,
      paymentTerms: /payment(?: terms)?\s*[:\-]\s*(.+)/i.exec(text)?.[1]?.trim().slice(0, 120) ?? null,
      total: bill.grandTotal ? Number(bill.grandTotal) : null,
    },
    lines: bill.lines.map((l) => ({ description: l.description, hsnCode: l.hsnCode, qty: l.qty, unit: l.unit, rate: l.rate, gstRate: l.gstRate })),
    warnings: bill.lines.length ? [] : ['No priced lines were found.'],
  };
}

function bankStatement(text: string): Extracted {
  const lines: Extracted['lines'] = [];
  for (const raw of text.split(/\r?\n/)) {
    const d = /^\s*(\d{1,2}[/.\-][A-Za-z0-9]{1,9}[/.\-]\d{2,4})\s+(.+)$/.exec(raw);
    if (!d) continue;
    const date = parseDate(d[1]);
    if (!date) continue;
    const nums = [...d[2].matchAll(/(-?[\d,]+\.\d{2})(?:\s*(Dr|Cr))?/gi)];
    if (!nums.length) continue;
    const narration = d[2].slice(0, nums[0].index).trim();
    const balance = money(nums[nums.length - 1][1]);
    let debit: string | null = null;
    let credit: string | null = null;
    if (nums.length >= 3) {
      debit = money(nums[0][1]) === '0.00' ? null : money(nums[0][1]);
      credit = money(nums[1][1]) === '0.00' ? null : money(nums[1][1]);
    } else if (nums.length === 2) {
      const amt = money(nums[0][1]);
      if (/\bcr\b|credit|neft cr|by /i.test(narration) || nums[0][2]?.toLowerCase() === 'cr') credit = amt;
      else debit = amt;
    }
    lines.push({ date, narration, debit: debit ? Number(debit) : null, credit: credit ? Number(credit) : null, balance: balance ? Number(balance) : null });
  }
  // Running balances check: previous balance − debit + credit should equal the next balance.
  const warnings: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1].balance as number | null;
    const c = lines[i];
    if (p === null || c.balance === null) continue;
    const expect = Math.round((p - Number(c.debit ?? 0) + Number(c.credit ?? 0)) * 100) / 100;
    if (Math.abs(expect - Number(c.balance)) > 0.5) {
      warnings.push(`Row ${i + 1} (${c.date}): balance does not follow from the row before; check debit / credit columns.`);
      break;
    }
  }
  return {
    kind: 'bank_statement',
    confidence: lines.length ? 0.8 : 0.4,
    fields: { account: /a\/?c(?:count)?\s*(?:no|number)?\.?\s*[:\-]?\s*([X\d*]{6,20})/i.exec(text)?.[1] ?? null, ifsc: /\b([A-Z]{4}0[A-Z0-9]{6})\b/.exec(text.toUpperCase())?.[1] ?? null, rows: lines.length },
    lines,
    warnings: lines.length ? warnings : ['No transactions were found.'],
  };
}

export function extractDocument(text: string, forced?: DocKind): Extracted {
  const d = forced && forced !== 'unknown' ? { kind: forced, confidence: 0.9 } : detectKind(text);
  const r =
    d.kind === 'delivery_challan' ? challan(text)
    : d.kind === 'eway_bill' ? ewayBill(text)
    : d.kind === 'coa' ? coa(text)
    : d.kind === 'quotation' ? quotation(text)
    : d.kind === 'bank_statement' ? bankStatement(text)
    : d.kind === 'invoice'
      ? { kind: 'invoice' as const, confidence: d.confidence, fields: {}, lines: [], warnings: ['This is a supplier bill: use Purchase → bill capture to book it.'] }
      : { kind: 'unknown' as const, confidence: d.confidence, fields: {}, lines: [], warnings: ['The document type was not recognised. Choose the type, or use AI capture for scans.'] };
  return { ...r, confidence: Math.round(Math.min(r.confidence, d.confidence + 0.2) * 100) / 100 };
}
