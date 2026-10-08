import type { AutomationCondition } from '@nextgen/database';

/** Events an automation can start from (the same events webhooks carry). */
export const AUTOMATION_EVENTS: Record<string, string> = {
  'document.submitted': 'A document was submitted',
  'document.approved': 'A document was fully approved',
  'document.rejected': 'A document was rejected',
  'document.cancelled': 'A document was cancelled',
  'member.joined': 'A user joined the workspace',
  'connector.orders_imported': 'A connector imported online orders',
  'connector.leads_imported': 'A connector imported leads',
};

/** Value at a dotted path ("data.amount", "docType"). */
export function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : NaN);

export function holds(c: AutomationCondition, payload: unknown) {
  const v = pick(payload, c.field);
  switch (c.op) {
    case 'exists':
      return v !== undefined && v !== null && v !== '';
    case 'eq':
      return String(v ?? '') === String(c.value ?? '');
    case 'ne':
      return String(v ?? '') !== String(c.value ?? '');
    case 'gt':
      return num(v) > num(c.value);
    case 'gte':
      return num(v) >= num(c.value);
    case 'lt':
      return num(v) < num(c.value);
    case 'lte':
      return num(v) <= num(c.value);
    case 'in':
      return (Array.isArray(c.value) ? c.value : String(c.value ?? '').split(',')).map((x) => String(x).trim()).includes(String(v ?? ''));
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase());
    default:
      return false;
  }
}

/** All conditions must hold (an empty list always matches). */
export const matches = (conditions: AutomationCondition[], payload: unknown) => conditions.every((c) => holds(c, payload));

/** Fills {{path}} placeholders from the payload; unknown paths become empty. */
export function render(template: string, payload: unknown) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p: string) => {
    const v = pick(payload, p);
    return v === undefined || v === null ? '' : String(v);
  });
}
