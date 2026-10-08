/**
 * Notification event catalog. Each event declares which channels are on by
 * default and how to render its message. Users can opt out per event+channel
 * (except `mandatory` events such as security alerts).
 */

export type Channel = 'in_app' | 'email' | 'whatsapp';

export interface Rendered {
  title: string;
  body: string;
  /** Path inside the web app, e.g. /purchase/requisitions/<id>. */
  link?: string;
  /** Call-to-action label for email buttons. */
  action?: string;
}

export interface EventDefinition<D = Record<string, string>> {
  label: string;
  description: string;
  group: 'Approvals' | 'Documents' | 'Account & security' | 'Team' | 'Vendors' | 'Customers' | 'Service' | 'Shop floor';
  defaults: Record<Channel, boolean>;
  /** Users can't turn these off (security). */
  mandatory?: boolean;
  render(data: D): Rendered;
}

type DocData = {
  docTypeLabel: string;
  number: string;
  title: string;
  amount: string;
  actorName: string;
  link: string;
  stepName?: string;
  comment?: string;
};

const docLine = (d: DocData) => `${d.docTypeLabel} ${d.number}${d.title ? `: ${d.title}` : ''}${d.amount ? ` (${d.amount})` : ''}`;

export const NOTIFICATION_EVENTS = {
  'document.approval_requested': {
    label: 'Approval needed',
    description: 'A document is waiting for your approval',
    group: 'Approvals',
    defaults: { in_app: true, email: true, whatsapp: true },
    render: (d: DocData) => ({
      title: `Approval needed: ${d.number}`,
      body: `${d.actorName} submitted ${docLine(d)} for your approval${d.stepName ? ` (${d.stepName})` : ''}.`,
      link: d.link,
      action: 'Review and approve',
    }),
  },
  'document.approved': {
    label: 'Your document was approved',
    description: 'A document you submitted is fully approved',
    group: 'Documents',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: DocData) => ({
      title: `Approved: ${d.number}`,
      body: `${docLine(d)} was approved by ${d.actorName}.`,
      link: d.link,
      action: 'View document',
    }),
  },
  'document.rejected': {
    label: 'Your document was rejected',
    description: 'A document you submitted was rejected',
    group: 'Documents',
    defaults: { in_app: true, email: true, whatsapp: true },
    render: (d: DocData) => ({
      title: `Rejected: ${d.number}`,
      body: `${d.actorName} rejected ${docLine(d)}.${d.comment ? ` Reason: “${d.comment}”` : ''}`,
      link: d.link,
      action: 'Edit and resubmit',
    }),
  },
  'document.commented': {
    label: 'New comment',
    description: 'Someone commented on a document you created',
    group: 'Documents',
    defaults: { in_app: true, email: false, whatsapp: false },
    render: (d: DocData) => ({
      title: `${d.actorName} commented on ${d.number}`,
      body: d.comment ?? '',
      link: d.link,
      action: 'Open document',
    }),
  },
  'iam.invitation': {
    label: 'Workspace invitation',
    description: 'Invitation email to a new team member',
    group: 'Team',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { workspace: string; inviter: string; link: string; expires: string }) => ({
      title: `${d.inviter} invited you to ${d.workspace} on NextGen ERP`,
      body: `You've been invited to join ${d.workspace}. The link works once and expires on ${d.expires}.`,
      link: d.link,
      action: 'Accept invitation',
    }),
  },
  'billing.payment_received': {
    label: 'Subscription payment received',
    description: 'Receipt when your subscription is paid or renewed',
    group: 'Account & security',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { plan: string; amount: string; invoice: string; until: string }) => ({
      title: `Payment received: ${d.plan} plan`,
      body: `We received ${d.amount} for your ${d.plan} plan, active until ${d.until}. GST invoice ${d.invoice} is available under Settings → Billing.`,
      link: '/settings/billing',
      action: 'View invoice',
    }),
  },
  'account.mfa_changed': {
    label: 'Two-step verification changed',
    description: 'Security alert when two-step verification is turned on or off',
    group: 'Account & security',
    defaults: { in_app: true, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { action: string; when: string; ip: string }) => ({
      title: `Two-step verification ${d.action}`,
      body: `Two-step verification was ${d.action} for your account on ${d.when} from IP ${d.ip}. If this wasn't you, contact your administrator immediately.`,
      link: '/account',
      action: 'Review your account',
    }),
  },
  'privacy.request_raised': {
    label: 'Data protection request',
    description: 'A team member raised a DPDP correction / erasure / grievance request',
    group: 'Team',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { type: string }) => ({
      title: `New data protection request (${d.type})`,
      body: `A ${d.type} request was raised under the DPDP Act. Please review and respond.`,
      link: '/settings/privacy',
      action: 'Review request',
    }),
  },
  'privacy.request_resolved': {
    label: 'Your data request was answered',
    description: 'Outcome of a data protection request you raised',
    group: 'Account & security',
    defaults: { in_app: true, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { type: string; status: string; resolution: string }) => ({
      title: `Your ${d.type} request was ${d.status}`,
      body: d.resolution,
      link: '/account',
      action: 'View details',
    }),
  },
  'account.password_changed': {
    label: 'Password changed',
    description: 'Security alert when your password changes',
    group: 'Account & security',
    defaults: { in_app: true, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { when: string; ip: string }) => ({
      title: 'Your NextGen ERP password was changed',
      body: `Your password was changed on ${d.when} from IP ${d.ip}. Other devices were signed out. If this wasn't you, contact your administrator immediately.`,
      link: '/account',
      action: 'Review your account',
    }),
  },
  /** Sent to a vendor's email (not a user), so in-app is off. */
  'purchase.rfq_sent': {
    label: 'Request for quotation',
    description: 'An RFQ emailed to a vendor',
    group: 'Vendors',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { companyName: string; number: string; dueDate: string; items: string; contact: string }) => ({
      title: `Request for quotation ${d.number} from ${d.companyName}`,
      body: `Please quote your best rates, delivery time and terms for:
${d.items}

Kindly reply by ${d.dueDate}, quoting ${d.number}. ${d.contact}`,
    }),
  },
  'jobwork.return_due': {
    label: 'Job-work return deadline',
    description: 'Material at a job worker is close to (or past) the 1-year / 3-year return limit',
    group: 'Documents',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { number: string; jobWorker: string; dueDate: string; pending: string; overdue: string; link: string }) => ({
      title: d.overdue === 'yes' ? `Job work ${d.number}: return deadline passed` : `Job work ${d.number}: material due back by ${d.dueDate}`,
      body:
        d.overdue === 'yes'
          ? `Material sent to ${d.jobWorker} on challan ${d.number} was not received back by ${d.dueDate}. Under section 143 it is now treated as a supply on the day it was sent: pay GST on it, or record the receipt if it came back. Pending: ${d.pending}.`
          : `Material sent to ${d.jobWorker} on challan ${d.number} must come back by ${d.dueDate}, or it is treated as a supply. Pending: ${d.pending}.`,
      link: d.link,
      action: 'Open the challan',
    }),
  },
  'service.ticket_assigned': {
    label: 'Service ticket assigned',
    description: 'A customer ticket was assigned to you',
    group: 'Service',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { number: string; subject: string; customer: string; priority: string; due: string; link: string }) => ({
      title: `Ticket ${d.number} (${d.priority}) assigned to you`,
      body: `${d.customer}: ${d.subject}. Resolve by ${d.due}.`,
      link: d.link,
      action: 'Open the ticket',
    }),
  },
  'service.sla_breached': {
    label: 'Service SLA breached',
    description: 'A ticket missed its response or resolution time and was escalated',
    group: 'Service',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { number: string; subject: string; customer: string; what: string; due: string; level: string; link: string }) => ({
      title: `Ticket ${d.number}: ${d.what} overdue (escalation level ${d.level})`,
      body: `${d.customer}: ${d.subject}. The ${d.what} was due by ${d.due}.`,
      link: d.link,
      action: 'Open the ticket',
    }),
  },
  /** Sent to a customer's email (not a user). */
  'service.customer_message': {
    label: 'Customer wrote on a ticket',
    description: 'A customer replied on the portal to a ticket assigned to you',
    group: 'Service',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { number: string; subject: string; customer: string; link: string }) => ({
      title: `${d.customer} wrote on ticket ${d.number}`,
      body: d.subject,
      link: d.link,
      action: 'Open the ticket',
    }),
  },
  'portal.order_placed': {
    label: 'Order placed on the portal',
    description: 'A customer or dealer placed an order on the portal for you to accept',
    group: 'Customers',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { number: string; customer: string; lines: string; by: string; link: string }) => ({
      title: `Portal order ${d.number} from ${d.customer}`,
      body: `${d.by} ordered ${d.lines} item(s). Accept it into a sales order or reject it.`,
      link: d.link,
      action: 'Review the order',
    }),
  },
  /** Sent to a customer or dealer contact's email (not a user). */
  /** Sent to a party's email when a person approves an agent's message (or within its guardrails). */
  'iot.alarm': {
    label: 'Machine alarm',
    description: 'A machine or sensor signal crossed its alarm limit',
    group: 'Shop floor',
    defaults: { in_app: true, email: false, whatsapp: false },
    render: (d: { title: string; body: string; link: string }) => ({ title: d.title, body: d.body, link: d.link, action: 'Open alarms' }),
  },
  'mes.andon_call': {
    label: 'Andon call',
    description: 'Someone on the line asked for maintenance, quality, material or a supervisor',
    group: 'Shop floor',
    defaults: { in_app: true, email: false, whatsapp: false },
    render: (d: { title: string; body: string; link: string }) => ({ title: d.title, body: d.body, link: d.link, action: 'Open the Andon board' }),
  },
  'plant.peak_demand': {
    label: 'Peak demand warning',
    description: 'The electrical demand of the current interval is heading for the contract demand',
    group: 'Shop floor',
    defaults: { in_app: true, email: false, whatsapp: false },
    render: (d: { title: string; body: string; link: string }) => ({ title: d.title, body: d.body, link: d.link, action: 'Open energy' }),
  },
  'plant.anomaly': {
    label: 'Machine condition anomaly',
    description: 'Condition monitoring found unusual vibration, temperature or current on a machine',
    group: 'Shop floor',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { title: string; body: string; link: string }) => ({ title: d.title, body: d.body, link: d.link, action: 'Open condition monitoring' }),
  },
  'automation.message': {
    label: 'Workflow automation message',
    description: 'A message sent by a workflow automation set up in this workspace',
    group: 'Documents',
    defaults: { in_app: true, email: true, whatsapp: false },
    render: (d: { title: string; body: string; link: string | null }) => ({ title: d.title, body: d.body, link: d.link ?? undefined }),
  },
  'agent.message': {
    label: 'Message from an AI agent',
    description: 'A follow-up an agent drafted and someone approved, such as asking a vendor for a delivery date',
    group: 'Vendors',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { subject: string; body: string }) => ({ title: d.subject, body: d.body }),
  },
  'portal.invite': {
    label: 'Portal invitation',
    description: 'Link for a customer or dealer contact to set their portal password',
    group: 'Customers',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { companyName: string; name: string; party: string; url: string; workspace: string }) => ({
      title: `Your ${d.companyName} portal login`,
      body: `Dear ${d.name},

${d.companyName} has given you a login to its portal for ${d.party}: see your orders, invoices, payments and statement, and raise service requests.

Set your password here (the link works for 7 days):
${d.url}

To sign in later, use the workspace code "${d.workspace}" and this email address.`,
    }),
  },
  'service.ticket_reply': {
    label: 'Reply on a service ticket',
    description: 'A reply to the customer on their ticket',
    group: 'Customers',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { companyName: string; number: string; subject: string; reply: string }) => ({
      title: `[${d.number}] ${d.subject}`,
      body: `${d.reply}

${d.companyName} service desk. Please keep ${d.number} in the subject when you reply.`,
    }),
  },
  /** Sent to a customer's email (not a user). */
  'accounting.payment_reminder': {
    label: 'Payment reminder',
    description: 'Overdue invoices reminder emailed to a customer',
    group: 'Customers',
    defaults: { in_app: false, email: true, whatsapp: false },
    mandatory: true,
    render: (d: { companyName: string; customerName: string; total: string; lines: string; contact: string }) => ({
      title: `Payment reminder from ${d.companyName}: ${d.total} overdue`,
      body: `Dear ${d.customerName},

Our records show these invoices are past their due date:
${d.lines}

Total overdue: ${d.total}. If you have already paid, please share the payment details so we can update our books. ${d.contact}`,
    }),
  },
} satisfies Record<string, EventDefinition<any>>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export type EventData<E extends NotificationEvent> = Parameters<(typeof NOTIFICATION_EVENTS)[E]['render']>[0];

export function eventDefinition(event: string): EventDefinition<any> | undefined {
  return (NOTIFICATION_EVENTS as Record<string, EventDefinition<any>>)[event];
}
