const IST_MS = 5.5 * 3_600_000;

export interface ScheduleRule {
  frequency: 'daily' | 'weekly' | 'monthly';
  /** Hour of the day in India. */
  hour: number;
  /** Weekly: ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday?: number | null;
  /** Monthly: day 1 … 28. */
  monthDay?: number | null;
}

/** The first run strictly after `now`, at the rule's hour in India (returned as a UTC instant). */
export function nextRun(now: Date, r: ScheduleRule): Date {
  const ist = new Date(now.getTime() + IST_MS);
  for (let i = 0; i <= 62; i++) {
    const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + i, r.hour));
    const at = new Date(day.getTime() - IST_MS);
    if (at <= now) continue;
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1;
    if (r.frequency === 'weekly' && isoWeekday !== (r.weekday ?? 1)) continue;
    if (r.frequency === 'monthly' && day.getUTCDate() !== (r.monthDay ?? 1)) continue;
    return at;
  }
  throw new Error('No run time found for the schedule');
}

/** Relative dates usable as scheduled report parameters, resolved against today in India. */
export function relativeDate(token: string, today: string): string {
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (token) {
    case 'yesterday':
      return add(today, -1);
    case 'week_start': {
      const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return add(today, -wd);
    }
    case 'prev_month_start': {
      const t = new Date(`${monthStart}T00:00:00Z`);
      t.setUTCMonth(t.getUTCMonth() - 1);
      return t.toISOString().slice(0, 10);
    }
    case 'prev_month_end':
      return add(monthStart, -1);
    default:
      return token;
  }
}
