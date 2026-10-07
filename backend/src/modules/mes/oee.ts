/**
 * OEE from machine-state intervals and part counts, kept pure.
 *
 *   planned time    = time with data − planned stops (and shift breaks)
 *   operating time  = planned − downtime (stops of at least the minor-stop length, and setups)
 *   availability    = operating / planned
 *   performance     = ideal time for the parts made / operating time (at most 100 %)
 *   quality         = good / (good + rejected)
 *   OEE             = availability × performance × quality
 *
 * The six big losses are returned in seconds: breakdown and setup (availability), minor stops
 * and reduced speed (performance), defects and start-up rejects (quality). Downtime without a
 * reason is reported separately as unexplained (and counted as an availability loss).
 */

export type MachineState = 'running' | 'stopped' | 'setup' | 'planned_stop';
export type Loss = 'breakdown' | 'setup' | 'minor_stop' | 'speed' | 'defects' | 'startup' | 'planned' | 'other';

export interface Span {
  state: MachineState;
  start: number;
  /** null = still going (ends at `now`). */
  end: number | null;
  /** Loss category of the reason given, if any. */
  loss: Loss | null;
}

export interface CountRow {
  minute: number;
  good: number;
  reject: number;
  idealSeconds: number;
}

export interface OeeInput {
  from: number;
  to: number;
  now: number;
  spans: Span[];
  counts: CountRow[];
  minorStopSeconds: number;
  /** Planned breaks inside the window (seconds). */
  breakSeconds?: number;
  /** Rejects within this long after a setup ends count as start-up rejects. */
  startupSeconds?: number;
}

export interface OeeResult {
  windowSeconds: number;
  noDataSeconds: number;
  plannedStopSeconds: number;
  plannedSeconds: number;
  runSeconds: number;
  downtimeSeconds: number;
  operatingSeconds: number;
  good: number;
  reject: number;
  idealSeconds: number;
  losses: Record<'breakdown' | 'setup' | 'unexplained' | 'other' | 'minor_stop' | 'speed' | 'defects' | 'startup', number>;
  stops: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

const emptyLosses = () => ({ breakdown: 0, setup: 0, unexplained: 0, other: 0, minor_stop: 0, speed: 0, defects: 0, startup: 0 });

export function computeOee(i: OeeInput): OeeResult {
  const to = Math.min(i.to, i.now);
  const windowSeconds = Math.max(0, (to - i.from) / 1000);
  let covered = 0;
  let run = 0;
  let plannedStop = 0;
  let stops = 0;
  const losses = emptyLosses();
  const setupEnds: number[] = [];
  for (const s of i.spans) {
    const a = Math.max(s.start, i.from);
    const b = Math.min(s.end ?? i.now, to);
    if (b <= a) continue;
    const sec = (b - a) / 1000;
    const fullSec = ((s.end ?? i.now) - s.start) / 1000;
    covered += sec;
    if (s.state === 'running') run += sec;
    else if (s.state === 'planned_stop' || s.loss === 'planned') plannedStop += sec;
    else if (s.state === 'setup' || s.loss === 'setup') {
      losses.setup += sec;
      if (s.end !== null) setupEnds.push(s.end);
    } else if (fullSec < i.minorStopSeconds || s.loss === 'minor_stop') {
      losses.minor_stop += sec;
      stops++;
    } else {
      stops++;
      if (s.loss === 'breakdown') losses.breakdown += sec;
      else if (s.loss === null) losses.unexplained += sec;
      else losses.other += sec;
    }
  }
  // Breaks are planned: take them out of unexplained stops first.
  const breakSec = Math.min(i.breakSeconds ?? 0, losses.unexplained);
  losses.unexplained -= breakSec;
  plannedStop += breakSec;

  let good = 0;
  let reject = 0;
  let ideal = 0;
  const startupWindow = (i.startupSeconds ?? 600) * 1000;
  for (const c of i.counts) {
    if (c.minute < i.from || c.minute >= to) continue;
    good += c.good;
    reject += c.reject;
    ideal += c.idealSeconds;
    const perPiece = c.good + c.reject > 0 ? c.idealSeconds / (c.good + c.reject) : 0;
    const startup = setupEnds.some((e) => c.minute >= e - 60_000 && c.minute < e + startupWindow);
    if (startup) losses.startup += c.reject * perPiece;
    else losses.defects += c.reject * perPiece;
  }
  const downtime = losses.setup + losses.breakdown + losses.unexplained + losses.other;
  const planned = covered - plannedStop;
  const operating = planned - downtime;
  losses.speed = Math.max(0, run - ideal);
  const r = (v: number) => Math.round(v * 10) / 10;
  const ratio = (a: number, b: number) => (b > 0 ? Math.round(Math.min(1, a / b) * 10_000) / 10_000 : null);
  const availability = ratio(operating, planned);
  const performance = ratio(ideal, operating);
  const quality = good + reject > 0 ? Math.round((good / (good + reject)) * 10_000) / 10_000 : null;
  const oee = availability !== null && performance !== null && quality !== null ? Math.round(availability * performance * quality * 10_000) / 10_000 : null;
  return {
    windowSeconds: r(windowSeconds),
    noDataSeconds: r(Math.max(0, windowSeconds - covered)),
    plannedStopSeconds: r(plannedStop),
    plannedSeconds: r(planned),
    runSeconds: r(run),
    downtimeSeconds: r(downtime),
    operatingSeconds: r(operating),
    good,
    reject,
    idealSeconds: r(ideal),
    losses: Object.fromEntries(Object.entries(losses).map(([k, v]) => [k, r(v)])) as OeeResult['losses'],
    stops,
    availability,
    performance,
    quality,
    oee,
  };
}

/** Adds results together (e.g. all machines of a line, or all days of a month) and recomputes the ratios. */
export function combineOee(rows: OeeResult[]): OeeResult {
  const sum = (f: (r: OeeResult) => number) => rows.reduce((n, r) => n + f(r), 0);
  const losses = emptyLosses();
  for (const r of rows) for (const k of Object.keys(losses) as (keyof typeof losses)[]) losses[k] += r.losses[k];
  const planned = sum((r) => r.plannedSeconds);
  const operating = sum((r) => r.operatingSeconds);
  const ideal = sum((r) => r.idealSeconds);
  const good = sum((r) => r.good);
  const reject = sum((r) => r.reject);
  const ratio = (a: number, b: number) => (b > 0 ? Math.round(Math.min(1, a / b) * 10_000) / 10_000 : null);
  const availability = ratio(operating, planned);
  const performance = ratio(ideal, operating);
  const quality = good + reject > 0 ? Math.round((good / (good + reject)) * 10_000) / 10_000 : null;
  return {
    windowSeconds: sum((r) => r.windowSeconds),
    noDataSeconds: sum((r) => r.noDataSeconds),
    plannedStopSeconds: sum((r) => r.plannedStopSeconds),
    plannedSeconds: planned,
    runSeconds: sum((r) => r.runSeconds),
    downtimeSeconds: sum((r) => r.downtimeSeconds),
    operatingSeconds: operating,
    good,
    reject,
    idealSeconds: ideal,
    losses,
    stops: sum((r) => r.stops),
    availability,
    performance,
    quality,
    oee: availability !== null && performance !== null && quality !== null ? Math.round(availability * performance * quality * 10_000) / 10_000 : null,
  };
}

// ---- shifts ------------------------------------------------------------------------------------

export interface ShiftDef {
  code: string;
  name: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
}

const IST = 5.5 * 3_600_000;
const DAY = 86_400_000;

/** IST calendar date (YYYY-MM-DD) of an instant. */
export const istDate = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);

/** Every shift occurrence overlapping [from, to), labelled with the IST date it starts on. */
export function shiftWindows(shifts: ShiftDef[], from: number, to: number): { shift: ShiftDef; date: string; start: number; end: number }[] {
  const out: { shift: ShiftDef; date: string; start: number; end: number }[] = [];
  const firstDay = Date.parse(`${istDate(from - DAY)}T00:00:00Z`) - IST;
  for (let day = firstDay; day < to; day += DAY) {
    for (const s of shifts) {
      const start = day + s.startMinute * 60_000;
      const end = day + (s.endMinute > s.startMinute ? s.endMinute : s.endMinute + 1440) * 60_000;
      if (end > from && start < to) out.push({ shift: s, date: istDate(start), start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The shift running at `now`, with its window. */
export function currentShift(shifts: ShiftDef[], now: number) {
  return shiftWindows(shifts, now - DAY, now + 1).find((w) => w.start <= now && now < w.end) ?? null;
}

/** Counter delta: a smaller value means the counter was reset (or rolled over) and restarted from zero. */
export function counterDelta(prev: number | null, value: number): number {
  if (prev === null) return 0;
  return value >= prev ? value - prev : value;
}
