const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ');
}

/** Whole number in the Indian system: crore, lakh, thousand. */
function indian(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  const crore = n / 10000000n;
  let rest = Number(n % 10000000n);
  if (crore) parts.push(`${indian(crore)} Crore`);
  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** "1234.50" → "Indian Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only". */
export function rupeesInWords(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const [int, frac = ''] = String(amount).replace(/^-/, '').split('.');
  const rupees = BigInt(int || '0');
  const paise = Number((frac + '00').slice(0, 2));
  return `Indian Rupees ${indian(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
}
