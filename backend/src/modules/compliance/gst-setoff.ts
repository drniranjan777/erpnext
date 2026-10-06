import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const ZERO = D('0');
const min = (a: Decimal, b: Decimal) => (a.cmp(b) <= 0 ? a : b);
const pos = (a: Decimal) => (a.isNegative() ? ZERO : a);

export interface Heads {
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  cess: Decimal;
}

export interface SetOff {
  /** Paid from each credit: utilised[liability][credit] */
  utilised: Record<'igst' | 'cgst' | 'sgst' | 'cess', Record<'igst' | 'cgst' | 'sgst' | 'cess', string>>;
  cash: Record<'igst' | 'cgst' | 'sgst' | 'cess', string>;
  creditLeft: Record<'igst' | 'cgst' | 'sgst' | 'cess', string>;
}

/**
 * Utilisation of input tax credit against output tax (CGST Act s.49, 49A, 49B; rule 88A):
 * IGST credit first, against IGST, then CGST / SGST (placed where own credit falls short, to
 * keep cash outgo lowest); then CGST credit against CGST, then IGST; SGST credit against SGST,
 * then IGST. CGST and SGST credit never cross. Cess credit only against cess.
 */
export function computeSetOff(liability: Heads, credit: Heads): SetOff {
  const L = { ...liability };
  const C = { ...credit };
  const u = { igst: { igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO }, cgst: { igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO }, sgst: { igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO }, cess: { igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO } };
  const use = (liab: keyof Heads, cred: keyof Heads, amount: Decimal) => {
    const a = min(pos(amount), min(L[liab], C[cred]));
    if (a.isZero() || a.isNegative()) return;
    L[liab] = L[liab].sub(a);
    C[cred] = C[cred].sub(a);
    u[liab][cred] = u[liab][cred].add(a);
  };
  // 1. IGST credit: IGST liability first.
  use('igst', 'igst', L.igst);
  // 2. Leftover IGST credit to CGST / SGST, first where their own credit will not cover them.
  use('cgst', 'igst', L.cgst.sub(C.cgst));
  use('sgst', 'igst', L.sgst.sub(C.sgst));
  use('cgst', 'igst', L.cgst);
  use('sgst', 'igst', L.sgst);
  // 3. CGST credit: CGST, then IGST. 4. SGST credit: SGST, then IGST.
  use('cgst', 'cgst', L.cgst);
  use('igst', 'cgst', L.igst);
  use('sgst', 'sgst', L.sgst);
  use('igst', 'sgst', L.igst);
  // 5. Cess.
  use('cess', 'cess', L.cess);
  const f = (h: Heads) => ({ igst: h.igst.toFixed(2), cgst: h.cgst.toFixed(2), sgst: h.sgst.toFixed(2), cess: h.cess.toFixed(2) });
  return {
    utilised: { igst: f(u.igst), cgst: f(u.cgst), sgst: f(u.sgst), cess: f(u.cess) },
    cash: f(L),
    creditLeft: f(C),
  };
}

/** "SP/0012", "sp-12", "SP 012" → "SP12": how invoice numbers are compared with GSTR-2B. */
export function normaliseInvoiceNo(v: string) {
  return v
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((seg) => seg.replace(/^0+(\d)/, '$1').replace(/([A-Z])0+(\d)/g, '$1$2'))
    .join('');
}
