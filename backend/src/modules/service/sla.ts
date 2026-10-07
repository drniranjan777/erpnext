/**
 * Service-level targets: response and resolution due times, counted round the clock or in IST
 * business hours, and where a ticket stands against them.
 */

export interface BusinessHours {
  /** HH:MM, IST. */
  start: string;
  end: string;
  /** Working days, 0 = Sunday. */
  days: number[];
}

const IST = 330 * 60_000;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Adds working minutes to an instant: round the clock, or only inside business hours. */
export function addWorkingMinutes(from: Date, minutes: number, hours: BusinessHours | null): Date {
  if (!hours) return new Date(from.getTime() + minutes * 60_000);
  const open = minutesOf(hours.start);
  const close = minutesOf(hours.end);
  if (close <= open || !hours.days.length) throw new Error('Business hours must end after they start, on at least one day');
  let left = minutes;
  // Walk in IST wall-clock minutes, day by day.
  let t = new Date(from.getTime() + IST);
  for (let guard = 0; guard < 3700; guard++) {
    const day = t.getUTCDay();
    const now = t.getUTCHours() * 60 + t.getUTCMinutes();
    const startOfDay = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    if (hours.days.includes(day) && now < close) {
      const begin = Math.max(now, open);
      const available = close - begin;
      if (left <= available) return new Date(startOfDay + (begin + left) * 60_000 - IST);
      left -= available;
    }
    t = new Date(startOfDay + 24 * 3_600_000);
  }
  throw new Error('Could not place the due time');
}

export type SlaState = 'met' | 'missed' | 'due' | 'at_risk' | 'breached';

/** met / missed once done; otherwise due, at risk (in the last fifth of the time) or breached. */
export function slaState(startIn: Date | string, dueIn: Date | string | null, doneIn: Date | string | null, now: Date): SlaState | null {
  if (!dueIn) return null;
  // Raw SQL rows carry timestamps as strings.
  const start = new Date(startIn);
  const due = new Date(dueIn);
  const doneAt = doneIn ? new Date(doneIn) : null;
  if (doneAt) return doneAt <= due ? 'met' : 'missed';
  if (now > due) return 'breached';
  const total = due.getTime() - start.getTime();
  return due.getTime() - now.getTime() <= total * 0.2 ? 'at_risk' : 'due';
}

/** Default targets in minutes by priority, when no policy is set. */
export const DEFAULT_TARGETS = {
  urgent: { response: 60, resolution: 240 },
  high: { response: 240, resolution: 1440 },
  medium: { response: 480, resolution: 2880 },
  low: { response: 1440, resolution: 7200 },
} as const;
export type Priority = keyof typeof DEFAULT_TARGETS;

/** Rule-based ticket triage: category and priority from the words used (used when no AI key is set). */
export function triage(subject: string, description: string): { category: string; priority: Priority; reasons: string[] } {
  const t = `${subject} ${description}`.toLowerCase();
  const reasons: string[] = [];
  let category = 'query';
  if (/\b(install|installation|commission|setup|set up)\b/.test(t)) category = 'installation';
  else if (/\b(breakdown|not working|stopped|dead|failed|failure|tripping|leak|leaking|noise|overheat)/.test(t)) category = 'breakdown';
  else if (/\b(warranty|guarantee|replace|replacement)\b/.test(t)) category = 'warranty';
  else if (/\b(complain|complaint|bad service|unhappy|poor quality|damaged|broken)/.test(t)) category = 'complaint';
  if (category !== 'query') reasons.push(`mentions ${category}`);
  let priority: Priority = category === 'breakdown' ? 'high' : 'medium';
  if (/\b(urgent|immediately|asap|emergency|production (stopped|down|halted)|line (stopped|down)|fire|smoke|shock)\b/.test(t)) {
    priority = 'urgent';
    reasons.push('urgent wording');
  } else if (category === 'query' && !/\?/.test(t)) priority = 'low';
  return { category, priority, reasons };
}
