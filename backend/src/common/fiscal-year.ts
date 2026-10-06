/** Indian fiscal year helpers (default April–March; company may configure the start month). */

export interface FiscalYear {
  /** "26-27" */
  label: string;
  /** "2026-27" */
  label4: string;
  startYear: number;
  start: string;
  end: string;
}

/** `date` is an ISO date string (YYYY-MM-DD). */
export function fiscalYearOf(date: string, startMonth = 4): FiscalYear {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return {
    label: startMonth === 1 ? yy(startYear) : `${yy(startYear)}-${yy(endYear)}`,
    label4: startMonth === 1 ? String(startYear) : `${startYear}-${yy(endYear)}`,
    startYear,
    start: `${startYear}-${pad(startMonth)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

/** Today's date in India (IST) as YYYY-MM-DD. */
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
