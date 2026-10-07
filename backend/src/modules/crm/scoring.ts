/**
 * Rule-based lead scoring (0–100) with the reasons shown to the salesperson, and the parsing of
 * enquiry exports from IndiaMART / TradeIndia / JustDial style files.
 */

export interface LeadFacts {
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  requirement: string | null;
  estimatedValue: number | null;
  activities: number;
  status: string;
}

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|rediffmail|rediff|ymail|icloud|live|aol)\./i;
const SOURCE_POINTS: Record<string, number> = { referral: 20, walk_in: 15, exhibition: 15, web: 10, whatsapp: 10, email: 10, indiamart: 5, tradeindia: 5, justdial: 5, other: 0 };

export function scoreLead(l: LeadFacts): { score: number; grade: 'A' | 'B' | 'C'; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, why: string) => {
    if (!points) return;
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`);
  };
  add(SOURCE_POINTS[l.source] ?? 0, `${l.source.replace('_', ' ')} enquiry`);
  if (l.phone) add(10, 'phone given');
  if (l.email) add(FREE_MAIL.test(l.email) ? 5 : 15, FREE_MAIL.test(l.email) ? 'personal email' : 'business email');
  if (l.company) add(10, 'company named');
  const v = l.estimatedValue ?? 0;
  if (v >= 1_000_000) add(25, 'value ₹10 lakh or more');
  else if (v >= 100_000) add(15, 'value ₹1 lakh or more');
  else if (v > 0) add(5, 'value stated');
  if ((l.requirement ?? '').trim().length >= 30) add(10, 'clear requirement');
  if (l.activities) add(Math.min(15, l.activities * 5), `${l.activities} interaction(s)`);
  if (l.status === 'qualified') add(10, 'qualified');
  if (l.status === 'unqualified') add(-30, 'marked unqualified');
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score >= 70 ? 'A' : score >= 40 ? 'B' : 'C', reasons };
}

/** Last ten digits of an Indian phone number, for matching duplicates. */
export function phoneKey(phone: string | null | undefined) {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

export interface ImportedLead {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  product: string | null;
  requirement: string | null;
  sourceRef: string | null;
}

/** One row of a lead export (headers normalised to lower_snake_case), in either portal or plain format. */
export function readLeadRow(v: Record<string, string>): ImportedLead | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (v[k]?.trim()) return v[k].trim();
    return null;
  };
  const name = pick('sender_name', 'name', 'contact_name', 'contact', 'buyer_name', 'customer_name');
  const phone = pick('sender_mobile', 'mobile', 'phone', 'sender_phone', 'contact_number', 'mobile_no');
  const email = pick('sender_email', 'email', 'email_id');
  if (!name && !phone && !email) return null;
  return {
    name: name ?? phone ?? email!,
    company: pick('sender_company', 'company', 'company_name', 'organisation', 'organization'),
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.toLowerCase() : null,
    phone,
    city: pick('sender_city', 'city'),
    state: pick('sender_state', 'state'),
    product: pick('query_product_name', 'product', 'product_name', 'subject'),
    requirement: pick('query_message', 'message', 'requirement', 'enquiry', 'description'),
    sourceRef: pick('unique_query_id', 'query_id', 'enquiry_id', 'lead_id', 'rn'),
  };
}

/** GST state code from a state name as written in enquiry exports. */
const STATES: Record<string, string> = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05', haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10',
  sikkim: '11', 'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16', meghalaya: '17', assam: '18', 'west bengal': '19', jharkhand: '20',
  odisha: '21', orissa: '21', chhattisgarh: '22', 'madhya pradesh': '23', gujarat: '24', 'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29', goa: '30', lakshadweep: '31',
  kerala: '32', 'tamil nadu': '33', puducherry: '34', pondicherry: '34', 'andaman and nicobar islands': '35', telangana: '36', 'andhra pradesh': '37', ladakh: '38',
};
export function stateCodeOf(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
  if (/^\d{2}$/.test(s)) return s;
  return STATES[s] ?? null;
}
