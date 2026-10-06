import { Decimal } from '../../common/decimal';

/**
 * TDS on purchases (Income-tax Act 1961, rates for FY 2025-26 onwards).
 * The rate can depend on whether the deductee is an individual / HUF (4th PAN character P or H).
 * TDS is worked out on the value before GST (CBDT circular 23/2017) and rounded to the rupee (s. 288B).
 */
export const TDS_SECTIONS: Record<string, { label: string; individual: string; other: string }> = {
  '194C': { label: '194C · Contractors (job work, transport, labour)', individual: '1', other: '2' },
  '194J': { label: '194J · Professional / technical services', individual: '10', other: '10' },
  '194J(a)': { label: '194J(a) · Technical services (not professional)', individual: '2', other: '2' },
  '194H': { label: '194H · Commission or brokerage', individual: '2', other: '2' },
  '194I(a)': { label: '194I(a) · Rent of plant & machinery', individual: '2', other: '2' },
  '194I(b)': { label: '194I(b) · Rent of land, building, furniture', individual: '10', other: '10' },
  '194Q': { label: '194Q · Purchase of goods (buyer turnover > ₹10 cr, above ₹50 lakh a year)', individual: '0.1', other: '0.1' },
};

/** Default TDS rate for a section and the vendor's PAN. */
export function tdsRate(section: string | null | undefined, pan: string | null | undefined): string | null {
  if (!section) return null;
  const s = TDS_SECTIONS[section];
  if (!s) return null;
  const kind = pan?.[3]?.toUpperCase();
  return kind === 'P' || kind === 'H' ? s.individual : s.other;
}

/** TDS amount on a base, rounded to the nearest rupee. */
export function tdsAmount(base: string, rate: string | null | undefined): string {
  if (!rate || Decimal.from(rate).isZero()) return '0.00';
  return Decimal.from(base).mul(Decimal.from(rate)).div(Decimal.from('100')).toFixed(0) + '.00';
}

/**
 * Payment due date. Micro and small enterprises (MSMED Act s.15, Income-tax s.43B(h)) must be paid
 * within the agreed credit period but never later than 45 days; 15 days when nothing was agreed.
 */
export function dueDate(invoiceDate: string, creditDays: number | null | undefined, msme: string | null | undefined): { dueDate: string; msmeCapped: boolean } {
  let days = creditDays ?? null;
  let capped = false;
  if (msme === 'micro' || msme === 'small') {
    if (days === null) days = 15;
    if (days > 45) {
      days = 45;
      capped = true;
    }
  }
  const d = new Date(`${invoiceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (days ?? 0));
  return { dueDate: d.toISOString().slice(0, 10), msmeCapped: capped };
}
