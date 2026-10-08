import { inflateSync } from 'node:zlib';

/**
 * PLM and document rules: lifecycle stages and their gates, revisions, engineering vs manufacturing
 * BOM comparison, CAD formats, text extraction for search, and retention.
 */

export const STAGES = ['concept', 'design', 'prototype', 'released', 'phase_out', 'obsolete'] as const;
export type Stage = (typeof STAGES)[number];

/** Allowed moves: forward one step, back to design from prototype or released (for a redesign), and phase-out back to released. */
const MOVES: Record<Stage, Stage[]> = {
  concept: ['design', 'obsolete'],
  design: ['prototype', 'concept', 'obsolete'],
  prototype: ['released', 'design', 'obsolete'],
  released: ['phase_out', 'design'],
  phase_out: ['obsolete', 'released'],
  obsolete: [],
};

/** What stops an item moving to a stage. Release needs a released engineering BOM (for made items) and a released CAD file or drawing. */
export function gateProblems(from: Stage, to: Stage, facts: { made: boolean; releasedEbom: boolean; releasedCad: boolean; openDemand: number }) {
  const out: string[] = [];
  if (!MOVES[from].includes(to)) out.push(`An item cannot go from ${from.replace('_', '-')} to ${to.replace('_', '-')}`);
  if (to === 'released') {
    if (facts.made && !facts.releasedEbom) out.push('Release the engineering BOM first');
    if (!facts.releasedCad) out.push('Release a CAD file or drawing for the item first');
  }
  if (to === 'obsolete' && facts.openDemand > 0) out.push(`${facts.openDemand} open order line(s) still use the item`);
  return out;
}

/** Stages in which an item may be bought or sold. */
export const canBuy = (s: Stage) => s !== 'obsolete' && s !== 'phase_out';
export const canSell = (s: Stage) => s !== 'obsolete';

/** Next revision letter: A → B, Z → AA, AZ → BA. Numeric revisions count up. */
export function nextRevision(rev: string) {
  if (/^\d+$/.test(rev)) return String(Number(rev) + 1).padStart(rev.length, '0');
  const chars = rev.toUpperCase().split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }
  return `A${chars.join('')}`;
}

/**
 * Engineering BOM against the manufacturing BOM: parts only in the design, parts only in
 * manufacturing (packaging, consumables, phantoms), and quantity differences.
 */
export function compareBoms(ebom: { itemId: string; qty: number }[], mbom: { itemId: string; qty: number }[]) {
  const sum = (l: { itemId: string; qty: number }[]) => l.reduce((m, x) => m.set(x.itemId, (m.get(x.itemId) ?? 0) + x.qty), new Map<string, number>());
  const e = sum(ebom);
  const m = sum(mbom);
  const onlyDesign = [...e.keys()].filter((k) => !m.has(k)).map((itemId) => ({ itemId, qty: e.get(itemId)! }));
  const onlyManufacturing = [...m.keys()].filter((k) => !e.has(k)).map((itemId) => ({ itemId, qty: m.get(itemId)! }));
  const qtyDiffers = [...e.keys()].filter((k) => m.has(k) && Math.abs(e.get(k)! - m.get(k)!) > 1e-9).map((itemId) => ({ itemId, design: e.get(itemId)!, manufacturing: m.get(itemId)! }));
  return { onlyDesign, onlyManufacturing, qtyDiffers, matches: !onlyDesign.length && !qtyDiffers.length };
}

const FORMATS: Record<string, string> = { sldprt: 'sldprt', sldasm: 'sldasm', slddrw: 'slddrw', dwg: 'dwg', dxf: 'dxf', step: 'step', stp: 'step', igs: 'iges', iges: 'iges', stl: 'stl', pdf: 'pdf' };
export const cadFormat = (fileName: string) => FORMATS[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'other';

/** Metadata readable from text CAD formats: DXF header variables and STEP file description. */
export function cadMetadata(fileName: string, buf: Buffer): Record<string, string> {
  const f = cadFormat(fileName);
  const head = buf.subarray(0, 64 * 1024).toString('latin1');
  if (f === 'dxf') {
    const v = /\$ACADVER\s*\r?\n\s*1\s*\r?\n([^\r\n]+)/.exec(head);
    const u = /\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(\d+)/.exec(head);
    const units: Record<string, string> = { '1': 'inches', '4': 'millimetres', '5': 'centimetres', '6': 'metres' };
    return { ...(v ? { acadVersion: v[1].trim() } : {}), ...(u ? { units: units[u[1]] ?? u[1] } : {}) };
  }
  if (f === 'step') {
    const d = /FILE_DESCRIPTION\s*\(\s*\(\s*'([^']*)'/.exec(head);
    const n = /FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(\s*'([^']*)'/.exec(head);
    const s = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/.exec(head);
    return { ...(d ? { description: d[1] } : {}), ...(n ? { modelName: n[1], exportedAt: n[2], author: n[3] } : {}), ...(s ? { schema: s[1] } : {}) };
  }
  return {};
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-ndjson))/;

/** Text of a PDF: strings shown by Tj / TJ in its content streams (inflated when Flate-compressed). */
export function pdfText(buf: Buffer) {
  const src = buf.toString('latin1');
  const parts: string[] = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    const s = data.toString('latin1');
    const unescape = (x: string) => x.replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[c] ?? c);
    // Tj shows one string, TJ an array of strings with spacing; keep them in page order.
    for (const t of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      if (t[1] !== undefined) parts.push(unescape(t[1]));
      else parts.push([...t[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => unescape(x[1])).join(''));
    }
    re.lastIndex = end;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Searchable text of a file, if it can be read without OCR. */
export function extractText(fileName: string, contentType: string, buf: Buffer): string | null {
  if (TEXT_TYPES.test(contentType) || /\.(txt|csv|md|json|xml|html?)$/i.test(fileName)) return buf.toString('utf8').slice(0, 1_000_000);
  if (contentType === 'application/pdf' || /\.pdf$/i.test(fileName)) {
    const t = pdfText(buf);
    return t ? t.slice(0, 1_000_000) : null;
  }
  return null;
}

/** Retention: the date a file may be disposed of. */
export function retentionUntil(created: string, years: number | null) {
  if (years === null || years === undefined) return null;
  const [y, m, d] = created.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

export function disposalProblem(f: { legalHold: boolean; retentionUntil: string | null; status: string }, today: string) {
  if (f.status === 'disposed') return 'Already disposed of';
  if (f.legalHold) return 'The file is under legal hold';
  if (!f.retentionUntil) return 'The folder keeps files for ever';
  if (f.retentionUntil > today) return `Keep until ${f.retentionUntil}`;
  return null;
}
