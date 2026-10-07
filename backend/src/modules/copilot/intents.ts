/**
 * Without an AI key the copilot still answers the common questions: a small rule-based router
 * (English, Hindi and Hinglish) that maps a message to one tool call. With a key, the model
 * chooses tools itself and this is only the fallback.
 */

export type Lang = 'en' | 'hi';

export interface Intent {
  tool: string;
  input: Record<string, unknown>;
  /** Short description of what was understood, for the reply. */
  topic: string;
}

const DOC_NUMBER = /\b([A-Z]{2,5}\/(?:[\w-]+\/)*\d{1,6})\b/i;
const KIND: [RegExp, string][] = [
  [/\b(po|purchase orders?)\b/i, 'purchase_order'],
  [/\b(so|sales orders?)\b/i, 'sales_order'],
  [/\b(wo|work orders?)\b/i, 'work_order'],
  [/\b(grn|goods receipts?)\b/i, 'goods_receipt'],
  [/\b(pr|requisitions?)\b/i, 'purchase_requisition'],
  [/\b(bills?|purchase invoices?)\b/i, 'purchase_invoice'],
  [/\b(invoices?)\b/i, 'sales_invoice'],
  [/\b(quotations?|quotes?)\b/i, 'sales_quotation'],
];

export const isHindi = (text: string) => /[ऀ-ॿ]/.test(text);

/** Period words → report parameters (relative tokens the report runner resolves). */
export function periodOf(text: string): { from: string; to: string; label: { en: string; hi: string } } {
  const t = text.toLowerCase();
  if (/last month|pichhle mahine|पिछले महीने|पिछला महीना/.test(t)) return { from: 'prev_month_start', to: 'prev_month_end', label: { en: 'last month', hi: 'पिछले महीने' } };
  if (/this year|financial year|\bfy\b|is saal|इस साल|वित्त वर्ष/.test(t)) return { from: 'fy_start', to: 'today', label: { en: 'this financial year', hi: 'इस वित्त वर्ष' } };
  if (/today|aaj|आज/.test(t)) return { from: 'today', to: 'today', label: { en: 'today', hi: 'आज' } };
  if (/yesterday|kal|कल/.test(t)) return { from: 'yesterday', to: 'yesterday', label: { en: 'yesterday', hi: 'कल' } };
  if (/this week|is hafte|इस हफ्ते/.test(t)) return { from: 'week_start', to: 'today', label: { en: 'this week', hi: 'इस हफ्ते' } };
  return { from: 'month_start', to: 'today', label: { en: 'this month', hi: 'इस महीने' } };
}

const DRAFT_KIND: [RegExp, string][] = [
  [/purchase orders?|\bpo\b/i, 'purchase_order'],
  [/sales orders?|\bso\b/i, 'sales_order'],
  [/requisitions?|\bpr\b|indent/i, 'purchase_requisition'],
  [/work orders?|\bwo\b/i, 'work_order'],
];

/** "draft a purchase order from Deccan Steels: 100 hex bolt, 50 hex nut by 2026-10-20" */
export function parseDraft(text: string): Intent | null {
  const m = /^\s*(?:please\s+)?(?:draft|create|make|prepare|raise|banao|बनाओ)\s+(?:an?\s+)?(.+)$/i.exec(text);
  if (!m) return null;
  const rest = m[1];
  const kind = DRAFT_KIND.find(([re]) => re.test(rest));
  if (!kind) return null;
  const date = /\b(?:by|on|for)\s+(\d{4}-\d{2}-\d{2})\b/i.exec(rest)?.[1];
  const body = rest.replace(/\s*\b(?:by|on|for)\s+\d{4}-\d{2}-\d{2}\b/i, '');
  const [head, list] = body.includes(':') ? [body.slice(0, body.indexOf(':')), body.slice(body.indexOf(':') + 1)] : [body, ''];
  const party = /\b(?:from|for|to)\s+(.+)$/i.exec(head.replace(kind[0], ''))?.[1]?.trim();
  const source = list || head.replace(kind[0], '').replace(/^\s*(?:for|of)\s+/i, '');
  const lines = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(?:x\s+|nos?\.?\s+|pcs\s+|kg\s+)?([^,;]+?)(?=\s*(?:,|;|\band\b|$))/gi)]
    .map((l) => ({ qty: l[1], item: l[2].trim().replace(/^(of|x)\s+/i, '') }))
    .filter((l) => l.item.length >= 2);
  if (!lines.length) return null;
  return { tool: 'draft_document', input: { type: kind[1], ...(party && list && kind[1] !== 'work_order' && kind[1] !== 'purchase_requisition' ? { party } : {}), lines, ...(date ? { date } : {}) }, topic: 'draft' };
}

export function parseIntent(raw: string): Intent | null {
  const text = raw.trim();
  const draft = parseDraft(text);
  if (draft) return draft;
  const t = text.toLowerCase();
  const number = DOC_NUMBER.exec(text)?.[1];
  const kind = KIND.find(([re]) => re.test(text))?.[1];
  const digits = /\b(\d{1,6})\b/.exec(text)?.[1];

  if (/\b(why|how come)\b|kyu|kyon|क्यों|अटका|रुका/.test(t) && (number || (kind && digits))) {
    return { tool: 'explain_document', input: number ? { number } : { number: digits, docType: kind }, topic: 'explain' };
  }
  if (number) return { tool: 'find_document', input: { query: number }, topic: 'open' };
  if (/\b(open|show|go to|find)\b|kholo|dikhao|खोलो|दिखाओ/.test(t) && kind && digits) return { tool: 'find_document', input: { query: digits, docType: kind }, topic: 'open' };

  const p = periodOf(text);
  if (/\b(overdue|receivables?|outstanding from|owe us|to collect)\b|baki|bakaya|udhaar|बकाया|उधार|वसूली/.test(t)) return { tool: 'run_report', input: { key: 'receivables-outstanding' }, topic: 'receivables' };
  if (/\b(payables?|bills? (due|to pay)|we owe|pay vendors?)\b|dena hai|देना|भुगतान/.test(t)) return { tool: 'run_report', input: { key: 'payables-outstanding' }, topic: 'payables' };
  if (/\b(reorder|low stock|running out|below reorder)\b|kam stock|कम स्टॉक/.test(t)) return { tool: 'run_report', input: { key: 'reorder' }, topic: 'reorder' };
  if (/\b(late|delayed|overdue)\b.*\b(work orders?|production|wo)\b|\bwork orders?\b.*\b(late|status|open)\b|उत्पादन/.test(t)) return { tool: 'run_report', input: { key: 'work-order-status' }, topic: 'work-orders' };
  if (/\b(pending|open)\b.*\bpurchase orders?\b|\bpurchase orders?\b.*\b(pending|open)\b/.test(t)) return { tool: 'run_report', input: { key: 'pending-purchase-orders' }, topic: 'pending-pos' };
  if (/\b(pending|open)\b.*\b(sales )?orders?\b|\borders? to deliver\b/.test(t)) return { tool: 'run_report', input: { key: 'pending-sales-orders' }, topic: 'pending-sos' };
  if (/\b(reject|rejects|rejection|scrap|defects?)\b|रिजेक्ट|खराब/.test(t)) {
    return { tool: 'query_data', input: { dataset: 'job_cards', fields: ['reason', 'rejected', 'good'], group: true, period: { preset: 'last_30' }, filters: [{ field: 'rejected', op: 'gt', value: '0' }], sort: { field: 'rejected', dir: 'desc' } }, topic: 'rejects' };
  }
  if (/\b(purchases?|bought|buying)\b|khareed|खरीद/.test(t)) return { tool: 'run_report', input: { key: 'purchases-by-vendor', params: { from: p.from, to: p.to } }, topic: 'purchases' };
  if (/\b(sales|sold|revenue|turnover|selling)\b|bikri|बिक्री|बेचा/.test(t)) return { tool: 'run_report', input: { key: 'sales-by-customer', params: { from: p.from, to: p.to } }, topic: 'sales' };
  // People questions come before the stock check, which also matches "how many".
  const lang = isHindi(raw) ? 'hi' : 'en';
  const hr = (topic: string): Intent => ({ tool: 'hr_info', input: { topic, lang }, topic: 'hr' });
  if (/\b(leave balance|my leaves?|leaves? left|how many leaves?)\b|chhutti|chutti|छुट्टी|छुट्टियाँ/.test(t)) return hr('my_leave');
  if (/\b(payslip|pay slip|salary slip|my salary|my pay)\b|vetan|tankhwah|वेतन|तनख्वाह|सैलरी/.test(t)) return hr('my_payslip');
  if (/\b(who is|who's|who are)\b.*\b(absent|on leave|not in)\b|\babsent today\b|kaun nahi aaya|कौन नहीं आया|अनुपस्थित|गैरहाजिर/.test(t)) return hr('absent_today');
  if (/\b(my attendance|attendance this month|how many days)\b|hajri|हाज़िरी|हाजिरी/.test(t)) return hr('my_attendance');
  if (/\b(headcount|how many (employees|people|staff))\b|kitne log|कितने कर्मचारी|कर्मचारी संख्या/.test(t)) return hr('headcount');
  if (/\b(pending approvals?|to approve|waiting for (me|my approval))\b|मंज़ूरी|अनुमोदन/.test(t)) return hr('pending_approvals');
  const stock = /\b(stock|inventory|on hand|how many|kitna)\b|स्टॉक|माल|कितना/.test(t);
  if (stock) {
    const term = text
      .replace(/\b(stock|inventory|on hand|of|for|the|how many|do we have|is there|what is|show|me|kitna|hai|ka|ki|ke)\b/gi, ' ')
      .replace(/स्टॉक|माल|कितना|है|का|की|के|\?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (term.length >= 2) return { tool: 'query_data', input: { dataset: 'stock_on_hand', fields: ['itemCode', 'item', 'warehouse', 'qty', 'value'], filters: [{ field: 'item', op: 'contains', value: term }] }, topic: 'stock-item' };
    return { tool: 'run_report', input: { key: 'stock-summary' }, topic: 'stock' };
  }
  return null;
}

export const HELP: Record<Lang, string> = {
  en: 'I can look things up for you. Try: “sales this month”, “overdue invoices”, “stock of hex bolt”, “late work orders”, “rejects by reason”, “open PO 45”, “why is WO/26-27/0003 stuck?”, or “draft purchase order from Deccan Steels: 100 hex bolt, 50 hex nut”. With an AI key configured I can also answer free-form questions.',
  hi: 'मैं आपके लिए जानकारी निकाल सकता हूँ। पूछ कर देखें: “इस महीने की बिक्री”, “बकाया बिल”, “hex bolt का स्टॉक”, “देर से चल रहे work orders”, “रिजेक्ट का कारण”, “PO 45 खोलो”, या “WO/26-27/0003 क्यों रुका है?”।',
};
