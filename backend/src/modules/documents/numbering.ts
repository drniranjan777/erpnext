import { fiscalYearOf } from '../../common/fiscal-year';

export const PATTERN_TOKENS = ['FY', 'FY4', 'YYYY', 'YY', 'MM', 'BRANCH', 'SEQ'] as const;

export interface RenderContext {
  docDate: string;
  fyStartMonth: number;
  branchCode: string | null;
  seq: number;
  padding: number;
}

/** Renders a number-series pattern, e.g. "PR/{BRANCH}/{FY}/{SEQ}" → "PR/HO/26-27/0001". */
export function renderPattern(pattern: string, ctx: RenderContext): string {
  const fy = fiscalYearOf(ctx.docDate, ctx.fyStartMonth);
  const [yyyy, mm] = ctx.docDate.split('-');
  const values: Record<string, string> = {
    FY: fy.label,
    FY4: fy.label4,
    YYYY: yyyy,
    YY: yyyy.slice(2),
    MM: mm,
    BRANCH: ctx.branchCode ?? 'HO',
    SEQ: String(ctx.seq).padStart(ctx.padding, '0'),
  };
  return pattern.replace(/\{([A-Z0-9]+)\}/g, (_, token: string) => values[token] ?? `{${token}}`);
}

/** Counter period: one sequence per FY, per month, or forever. */
export function periodKey(reset: 'yearly' | 'monthly' | 'never', docDate: string, fyStartMonth: number): string {
  if (reset === 'never') return 'all';
  if (reset === 'monthly') return docDate.slice(0, 7);
  return fiscalYearOf(docDate, fyStartMonth).label4;
}

/** Problems with a pattern, empty when valid. */
export function validatePattern(pattern: string): string[] {
  const errors: string[] = [];
  if (!pattern.includes('{SEQ}')) errors.push('Pattern must contain {SEQ}');
  for (const [, token] of pattern.matchAll(/\{([^}]*)\}/g)) {
    if (!(PATTERN_TOKENS as readonly string[]).includes(token)) errors.push(`Unknown token {${token}}`);
  }
  if (/[{}]/.test(pattern.replace(/\{[A-Z0-9]+\}/g, ''))) errors.push('Unbalanced braces');
  return errors;
}

/** CGST Rule 46(b): invoice numbers ≤16 chars of letters, digits, "-" and "/". */
export function gstNumberProblems(sample: string): string[] {
  const problems: string[] = [];
  if (sample.length > 16) problems.push(`GST documents allow at most 16 characters (this is ${sample.length})`);
  if (!/^[A-Za-z0-9/-]+$/.test(sample)) problems.push('GST documents allow only letters, digits, "-" and "/"');
  return problems;
}
