/**
 * Rule-based sales assistance: why a lead scored what it did, what would raise it, and the next best
 * action on a lead or an opportunity. Pure functions so they can be unit tested.
 */
import { scoreLead, type LeadFacts } from './scoring';

export interface ActivityFacts {
  kind: string;
  dueAt: Date | string | null;
  doneAt: Date | string | null;
  outcome?: string | null;
}

export interface NextAction {
  action: 'call' | 'meeting' | 'email' | 'quote' | 'follow_up' | 'qualify' | 'close' | 'update' | 'none';
  label: string;
  why: string;
  /** IST date the action should happen by. */
  by: string | null;
  urgency: 'now' | 'soon' | 'later';
}

const DAY = 86_400_000;
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (d: Date, n: number) => ist(new Date(d.getTime() + n * DAY));
const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

function activityState(activities: ActivityFacts[], now: Date) {
  const done = activities.map((a) => toDate(a.doneAt)).filter((d): d is Date => !!d);
  const lastDone = done.length ? new Date(Math.max(...done.map((d) => d.getTime()))) : null;
  const open = activities.filter((a) => !a.doneAt && a.dueAt).map((a) => ({ ...a, due: toDate(a.dueAt)! }));
  const overdue = open.filter((a) => a.due < now).sort((x, y) => x.due.getTime() - y.due.getTime());
  const upcoming = open.filter((a) => a.due >= now).sort((x, y) => x.due.getTime() - y.due.getTime());
  return { lastDone, idleDays: lastDone ? Math.floor((now.getTime() - lastDone.getTime()) / DAY) : null, overdue, upcoming };
}

/** What the score is made of, what is missing, and a one-line summary for the salesperson. */
export function leadInsight(l: LeadFacts & { createdAt: Date | string }, activities: ActivityFacts[], now: Date) {
  const { score, grade, reasons } = scoreLead({ ...l, activities: activities.filter((a) => a.doneAt).length });
  const missing: string[] = [];
  if (!l.phone) missing.push('+10 with a phone number');
  if (!l.email) missing.push('+15 with a business email');
  if (!l.company) missing.push('+10 with the company name');
  if (!l.estimatedValue) missing.push('up to +25 with an estimated value');
  if ((l.requirement ?? '').trim().length < 30) missing.push('+10 with a clear requirement');
  if (l.status !== 'qualified' && l.status !== 'unqualified') missing.push('+10 once qualified');
  const strongest = reasons.filter((r) => r.startsWith('+')).sort((a, b) => parseInt(b.slice(1)) - parseInt(a.slice(1))).slice(0, 2).map((r) => r.replace(/^\+\d+ /, ''));
  const summary =
    grade === 'A'
      ? `Hot lead (${score}/100): ${strongest.join(' and ')}. Prioritise it.`
      : grade === 'B'
        ? `Warm lead (${score}/100)${strongest.length ? `: ${strongest.join(' and ')}` : ''}. ${missing.length ? `Find out more to raise it.` : ''}`.trim()
        : `Cold lead (${score}/100)${l.status === 'unqualified' ? ', marked unqualified' : missing.length ? `: little is known yet` : ''}.`;
  return { score, grade, reasons, missing, summary, nextAction: leadNextAction(l, activities, now) };
}

export function leadNextAction(l: Pick<LeadFacts, 'phone' | 'email' | 'status'> & { createdAt: Date | string }, activities: ActivityFacts[], now: Date): NextAction {
  if (['unqualified', 'lost', 'converted'].includes(l.status)) return { action: 'none', label: 'Nothing to do', why: `The lead is ${l.status}.`, by: null, urgency: 'later' };
  const s = activityState(activities, now);
  if (s.overdue.length) {
    const a = s.overdue[0];
    return { action: a.kind === 'meeting' ? 'meeting' : a.kind === 'email' ? 'email' : 'call', label: `Do the overdue ${a.kind}`, why: `A ${a.kind} was due on ${ist(a.due)} and is not done.`, by: ist(now), urgency: 'now' };
  }
  if (s.upcoming.length) {
    const a = s.upcoming[0];
    return { action: 'follow_up', label: `${a.kind[0].toUpperCase()}${a.kind.slice(1)} planned`, why: `Already scheduled for ${ist(a.due)}.`, by: ist(a.due), urgency: 'later' };
  }
  const created = new Date(l.createdAt);
  if (!s.lastDone) {
    const ageHours = (now.getTime() - created.getTime()) / 3_600_000;
    const how = l.phone ? 'call' : 'email';
    return { action: how, label: l.phone ? 'Call the enquirer' : 'Email the enquirer', why: ageHours > 24 ? `No contact in ${Math.floor(ageHours / 24)} day(s) since the enquiry; leads go cold fast.` : 'New enquiry: first contact within a few hours converts best.', by: ist(now), urgency: 'now' };
  }
  if (l.status === 'new' || l.status === 'contacted') {
    return { action: 'qualify', label: 'Qualify the lead', why: 'Contacted but not yet qualified: confirm need, budget and timing, then qualify it or mark it unqualified.', by: plusDays(now, 2), urgency: 'soon' };
  }
  if ((s.idleDays ?? 0) >= 7) return { action: 'call', label: 'Follow up', why: `No interaction for ${s.idleDays} days.`, by: ist(now), urgency: 'now' };
  return { action: 'meeting', label: 'Convert to an opportunity', why: 'Qualified: open an opportunity and arrange a meeting or demo.', by: plusDays(now, 3), urgency: 'soon' };
}

export interface OpportunityFacts {
  status: string;
  stage: string;
  stageProbability: number;
  amount: string | number | null;
  closeDate: string | null;
  quotationId: string | null;
  quotationStatus: string | null;
  competitor: string | null;
}

export function opportunityNextAction(o: OpportunityFacts, activities: ActivityFacts[], now: Date): NextAction {
  if (o.status !== 'open') return { action: 'none', label: 'Nothing to do', why: `The opportunity is ${o.status}.`, by: null, urgency: 'later' };
  const today = ist(now);
  const s = activityState(activities, now);
  if (s.overdue.length) {
    const a = s.overdue[0];
    return { action: a.kind === 'meeting' ? 'meeting' : a.kind === 'email' ? 'email' : 'call', label: `Do the overdue ${a.kind}`, why: `A ${a.kind} was due on ${ist(a.due)} and is not done.`, by: today, urgency: 'now' };
  }
  if (o.closeDate && o.closeDate < today) return { action: 'update', label: 'Update the close date', why: `The expected close date ${o.closeDate} has passed. Re-forecast it or close the deal as won or lost.`, by: today, urgency: 'now' };
  if (!o.quotationId && o.stageProbability >= 30) return { action: 'quote', label: 'Send a quotation', why: `At ${o.stage} (${o.stageProbability} %) with no quotation yet.`, by: plusDays(now, 2), urgency: 'soon' };
  if (o.quotationStatus === 'draft' || o.quotationStatus === 'pending_approval') return { action: 'quote', label: o.quotationStatus === 'draft' ? 'Finish and send the quotation' : 'Chase the quotation approval', why: `The quotation is still ${o.quotationStatus.replace('_', ' ')}.`, by: plusDays(now, 1), urgency: 'soon' };
  if ((s.idleDays ?? 99) >= 7 && !s.upcoming.length) {
    return { action: 'call', label: o.quotationId ? 'Follow up on the quotation' : 'Follow up', why: `${s.idleDays === null ? 'No interaction recorded yet' : `No interaction for ${s.idleDays} days`}${o.competitor ? `; ${o.competitor} is also in the running` : ''}.`, by: today, urgency: 'now' };
  }
  if (o.closeDate && o.stageProbability >= 70) {
    const days = Math.round((Date.parse(o.closeDate) - Date.parse(today)) / DAY);
    if (days <= 14) return { action: 'close', label: 'Ask for the order', why: `${o.stage} (${o.stageProbability} %) and due to close in ${days} day(s).`, by: o.closeDate, urgency: 'soon' };
  }
  if (s.upcoming.length) return { action: 'follow_up', label: `${s.upcoming[0].kind[0].toUpperCase()}${s.upcoming[0].kind.slice(1)} planned`, why: `Next step is scheduled for ${ist(s.upcoming[0].due)}.`, by: ist(s.upcoming[0].due), urgency: 'later' };
  return { action: 'follow_up', label: 'Plan the next step', why: 'No next step is scheduled. Book a call or meeting so the deal keeps moving.', by: plusDays(now, 3), urgency: 'soon' };
}
