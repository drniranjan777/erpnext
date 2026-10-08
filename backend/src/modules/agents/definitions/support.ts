import { sql } from 'drizzle-orm';
import { suggestReply } from '../../service/reply';
import { triage } from '../../service/sla';
import type { AgentDefinition, Finding } from '../framework';
import { many } from '../../../common/sql';

const fmt = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/**
 * Customer support agent: new tickets nobody has answered get a drafted first reply (from the
 * ticket's category, coverage and the best knowledge-base article) to send in one click, and
 * tickets whose wording suggests a different priority are flagged.
 */
export const supportAgent: AgentDefinition = {
  code: 'support',
  name: 'Customer support agent',
  description: 'Drafts first replies to new service tickets and flags tickets that look more urgent than logged.',
  watches: ['Tickets with no reply yet', 'Ticket wording vs the priority set'],
  defaultSchedule: 'hourly',
  params: { waitMinutes: { default: 30, label: 'Draft a reply after (minutes) unanswered' } },
  async run({ tx, params }) {
    const out: Finding[] = [];
    const [co] = await many<{ name: string }>(tx, sql`select name from companies where deleted_at is null order by created_at limit 1`);
    const tickets = await many<{ id: string; number: string; subject: string; description: string | null; category: string; priority: string; contactName: string | null; customer: string | null; serialNo: string | null; warrantyId: string | null; contract: string | null; resolutionDueAt: string | null; email: string | null; minutes: number }>(
      tx,
      sql`select t.id, t.number, t.subject, t.description, t.category, t.priority, t.contact_name as "contactName", p.name as customer, t.serial_no as "serialNo", t.warranty_id as "warrantyId", c.number as contract,
                 t.resolution_due_at::text as "resolutionDueAt", coalesce(t.contact_email::text, p.email::text) as email, (extract(epoch from now() - t.created_at) / 60)::int as minutes
          from svc_tickets t left join parties p on p.id = t.party_id left join svc_contracts c on c.id = t.contract_id
          where t.status in ('open', 'in_progress') and t.first_response_at is null`,
    );
    for (const t of tickets) {
      const text = `${t.subject} ${t.description ?? ''}`;
      const suggested = triage(t.subject, t.description ?? '');
      const order = ['low', 'medium', 'high', 'urgent'];
      if (order.indexOf(suggested.priority) > order.indexOf(t.priority)) {
        out.push({
          kind: 'ticket_priority',
          severity: suggested.priority === 'urgent' ? 'critical' : 'warning',
          title: `Ticket ${t.number} reads ${suggested.priority}, logged as ${t.priority}`,
          body: `"${t.subject}" ${suggested.reasons.length ? `(${suggested.reasons.join(', ')})` : ''}. Raising the priority tightens its response and resolution targets.`,
          evidence: { logged: t.priority, suggested: suggested.priority },
          dedupeKey: `tprio:${t.id}`,
          entityType: 'ticket',
          entityId: t.id,
          link: `/service/tickets/${t.id}`,
          confidence: 0.6,
          permission: 'service.tickets.manage',
          expiresInDays: 2,
        });
      }
      if (t.minutes < params.waitMinutes || !t.email) continue;
      const [article] = await many<{ title: string; body: string }>(
        tx,
        sql`select title, body from svc_articles where to_tsvector('simple', title || ' ' || body || ' ' || array_to_string(tags, ' ')) @@ plainto_tsquery('simple', ${text.slice(0, 200)}) order by views desc limit 1`,
      );
      const body = suggestReply(
        { number: t.number, contactName: t.contactName ?? t.customer, subject: t.subject, category: t.category, priority: t.priority, serialNo: t.serialNo, underWarranty: !!t.warrantyId, contract: t.contract, resolutionDue: t.resolutionDueAt, companyName: co?.name ?? '', agentName: null },
        article ? [article] : [],
        fmt,
      );
      out.push({
        kind: 'ticket_first_reply',
        severity: t.minutes > 120 ? 'warning' : 'info',
        title: `Ticket ${t.number} has waited ${t.minutes} minutes for a reply`,
        body: `${t.customer ?? t.contactName ?? 'The customer'}: "${t.subject}". A first reply is drafted; send it as is or edit it on the ticket.`,
        evidence: { waitingMinutes: t.minutes, category: t.category, article: article?.title ?? null },
        dedupeKey: `treply:${t.id}`,
        entityType: 'ticket',
        entityId: t.id,
        link: `/service/tickets/${t.id}`,
        action: { type: 'reply_ticket', label: 'Send the drafted reply', params: { ticketId: t.id, body }, amount: null },
        confidence: 0.7,
        permission: 'service.tickets.manage',
        expiresInDays: 1,
      });
    }
    return out;
  },
};
