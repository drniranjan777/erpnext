/**
 * Suggested first reply to a customer ticket, built from its category, coverage and the matching
 * knowledge-base articles. Used as is without an AI key, and as the starting point with one.
 */

export interface ReplyFacts {
  number: string;
  contactName: string | null;
  subject: string;
  category: string;
  priority: string;
  serialNo: string | null;
  underWarranty: boolean;
  contract: string | null;
  resolutionDue: string | null;
  companyName: string;
  agentName: string | null;
}

export interface ArticleHint {
  title: string;
  body: string;
}

const OPENERS: Record<string, string> = {
  breakdown: 'We are sorry the equipment has stopped working, and we understand how much a breakdown disrupts your work.',
  installation: 'Thank you for choosing us. We will be glad to install and commission it for you.',
  warranty: 'Thank you for reaching out about the warranty.',
  complaint: 'We are sorry for the trouble you have had, and thank you for telling us.',
  query: 'Thank you for your question.',
};

const NEXT_STEP: Record<string, string> = {
  breakdown: 'Our service engineer will contact you to diagnose it, and visit if it cannot be fixed over the phone.',
  installation: 'Our team will call you to fix a convenient date for the installation visit.',
  warranty: 'We are checking the warranty for your unit and will confirm the next step shortly.',
  complaint: 'A senior member of our team is looking into it and will get back to you.',
  query: 'We are looking into it and will reply with the details.',
};

function firstSteps(a: ArticleHint): string {
  const lines = a.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const steps = lines.filter((l) => /^(\d+[.)]|-|\*|•)\s+/.test(l)).slice(0, 4);
  return (steps.length ? steps : lines.slice(0, 2)).map((l) => `  ${l.replace(/^(\*|•)\s+/, '- ')}`).join('\n');
}

export function suggestReply(t: ReplyFacts, articles: ArticleHint[], fmtDue: (iso: string) => string): string {
  const parts: string[] = [];
  parts.push(`Dear ${t.contactName?.trim() || 'Customer'},`);
  parts.push(`${OPENERS[t.category] ?? OPENERS.query} We have logged your request as ${t.number}${t.serialNo ? ` for serial number ${t.serialNo}` : ''}.`);
  if (t.underWarranty) parts.push('The unit is under warranty, so covered parts and labour are free of charge.');
  else if (t.contract) parts.push(`The unit is covered by your service contract ${t.contract}.`);
  if (articles.length && ['breakdown', 'query', 'installation'].includes(t.category)) {
    parts.push(`Meanwhile, these steps often help (from "${articles[0].title}"):\n${firstSteps(articles[0])}`);
  }
  const next = NEXT_STEP[t.category] ?? NEXT_STEP.query;
  parts.push(t.resolutionDue ? `${next} We aim to resolve it by ${fmtDue(t.resolutionDue)}.` : next);
  parts.push(`Please quote ${t.number} in any reply.\n\nRegards,\n${t.agentName ?? 'Service desk'}\n${t.companyName}`);
  return parts.join('\n\n');
}
