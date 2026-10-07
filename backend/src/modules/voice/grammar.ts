/**
 * Voice command grammar for the shop floor and the office, in English, Hindi (Devanagari) and
 * Hinglish. Pure and unit tested with an evaluation set (eval-set.ts).
 *
 * A transcript is normalised first: Devanagari digits and keywords become Latin, number words
 * ("paanch hazaar", "पांच हजार", "five thousand") become digits, and Indian digit grouping is
 * removed. Then one of three commands is recognised: a production (work) order, a purchase
 * requisition, or a stock question. Anything else goes to the copilot.
 */

export type VoiceCommand = 'work_order' | 'requisition' | 'stock';

export interface ParsedCommand {
  command: VoiceCommand | null;
  qty: number | null;
  unit: string | null;
  item: string | null;
  line: string | null;
  normalised: string;
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** Devanagari words people use in these commands, mapped to the Latin words the parser knows. */
const DEVANAGARI_WORDS: [RegExp, string][] = [
  [/प्रोडक्शन|उत्पादन/g, 'production'],
  [/ऑर्डर|आर्डर|आदेश/g, 'order'],
  [/बनाओ|बनाइए|बनाना|बना दो|बनाएं/g, 'banao'],
  [/बनाने/g, 'banane'],
  [/लाइन|लाईन/g, 'line'],
  [/यूनिट्स|यूनिट/g, 'units'],
  [/पीस|नग/g, 'pieces'],
  [/किलो|किलोग्राम/g, 'kg'],
  [/लीटर|लिटर/g, 'litre'],
  [/स्टॉक|स्टाक|माल/g, 'stock'],
  [/कितना|कितने|कितनी/g, 'kitna'],
  [/मंगवाओ|मँगवाओ|मंगाओ|मँगाओ|मंगवा दो|खरीदो/g, 'mangwao'],
  [/इंडेंट|मांग पत्र/g, 'indent'],
  [/ पर | पे /g, ' par '],
  [/ का | की | के /g, ' ka '],
  [/ है/g, ' hai'],
  [/में/g, 'mein'],
];

/** Number words, Latin and Devanagari. Multipliers combine: "paanch hazaar" = 5000. */
const UNITS: Record<string, number> = {
  zero: 0, one: 1, ek: 1, एक: 1, two: 2, do: 2, दो: 2, three: 3, teen: 3, तीन: 3, four: 4, char: 4, chaar: 4, चार: 4,
  five: 5, paanch: 5, panch: 5, pach: 5, पांच: 5, पाँच: 5, six: 6, chhe: 6, chhah: 6, छह: 6, छः: 6, seven: 7, saat: 7, सात: 7,
  eight: 8, aath: 8, आठ: 8, nine: 9, nau: 9, नौ: 9, ten: 10, das: 10, दस: 10, twelve: 12, barah: 12, बारह: 12,
  fifteen: 15, pandrah: 15, पंद्रह: 15, twenty: 20, bees: 20, बीस: 20, twentyfive: 25, pachchis: 25, पच्चीस: 25,
  thirty: 30, tees: 30, तीस: 30, forty: 40, chalis: 40, चालीस: 40, fifty: 50, pachaas: 50, pachas: 50, पचास: 50,
  hundred: 100, sau: 100, सौ: 100, dedh: 1.5, डेढ़: 1.5, dhai: 2.5, ढाई: 2.5,
};
const MULTIPLIERS: Record<string, number> = { hundred: 100, sau: 100, सौ: 100, thousand: 1000, hazaar: 1000, hazar: 1000, हज़ार: 1000, हजार: 1000, lakh: 100_000, लाख: 100_000 };

/** Replaces spoken numbers ("paanch hazaar", "do sau pachaas", "2.5 thousand") with digits. */
export function wordsToNumbers(text: string): string {
  const tokens = text.split(/\s+/);
  const out: string[] = [];
  let acc: number | null = null;
  let cur: number | null = null;
  const flush = () => {
    if (acc !== null || cur !== null) out.push(String((acc ?? 0) + (cur ?? 0)));
    acc = null;
    cur = null;
  };
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    const num = /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
    if (num !== null) {
      if (cur !== null) flush();
      cur = num;
      continue;
    }
    if (t in UNITS && !(t in MULTIPLIERS && cur !== null)) {
      if (cur !== null && UNITS[t] >= 100) cur = cur * UNITS[t];
      else if (cur !== null && cur < 100 && UNITS[t] < 10 && cur % 10 === 0) cur = cur + UNITS[t];
      else if (cur !== null && cur >= 100 && cur % 100 === 0 && UNITS[t] < 100) cur = cur + UNITS[t];
      else {
        if (cur !== null) flush();
        cur = UNITS[t];
      }
      continue;
    }
    if (t in MULTIPLIERS) {
      const m = MULTIPLIERS[t];
      if (m >= 1000) {
        acc = (acc ?? 0) + (cur ?? 1) * m;
        cur = null;
      } else cur = (cur ?? 1) * m;
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return out.join(' ');
}

export function normalise(text: string): string {
  let t = ` ${text} `;
  t = t.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  t = t.replace(/(\d),(?=\d)/g, '$1');
  for (const [re, to] of DEVANAGARI_WORDS) t = t.replace(re, ` ${to} `);
  t = t.replace(/[।?!.,;:"']/g, (c) => (c === '.' ? '.' : ' '));
  t = t.replace(/(\d)\.(?!\d)/g, '$1');
  t = wordsToNumbers(t.toLowerCase().replace(/\s+/g, ' ').trim());
  return t.replace(/\s+/g, ' ').trim();
}

const UNIT_WORDS: [RegExp, string][] = [
  [/^(units?|pieces?|pcs|nos?|numbers?|nag)$/, 'units'],
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/, 'kg'],
  [/^(litres?|liters?|ltrs?|l)$/, 'litre'],
  [/^(tons?|tonnes?|mt)$/, 'tonne'],
  [/^(boxes|box|cartons?|peti)$/, 'box'],
  [/^(bags?|bori|boriyan)$/, 'bag'],
  [/^(metres?|meters?|mtrs?)$/, 'metre'],
];
const unitOf = (w: string | undefined) => (w ? (UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null) : null);

const STOP = new Set(['ka', 'ki', 'ke', 'of', 'for', 'the', 'a', 'an', 'par', 'pe', 'on', 'in', 'mein', 'please', 'jaldi', 'abhi', 'hai', 'hain', 'karo', 'kar', 'do', 'dijiye', 'some', 'aur', 'and', 'me', 'mera', 'hamara', 'hamare', 'our', 'check', 'batao', 'bataiye', 'dikhao', 'show', 'tell', 'what', 'is', 'whats', 'current', 'available', 'left', 'bacha', 'baki', 'kitna', 'how', 'much', 'many', 'stock', 'inventory', 'level', 'position', 'quantity', 'qty', 'kya', 'ye', 'yeh', 'woh', 'wo', 'u', 'ji', 'sir']);

function cleanItem(words: string[]): string | null {
  const w = words.filter((x) => !STOP.has(x) && !/^\d/.test(x) && !unitOf(x));
  return w.length ? w.join(' ') : null;
}

const WO_WORDS = /\b(production|utpadan|manufacturing|manufacture|work order|wo|banane|produce|make)\b/;
const ORDERISH = /\b(order|banao|create|make|start|chalu|lagao|produce|manufacture|bana)\b/;
const PR_WORDS = /\b(mangwao|mangao|mangwa|mangva|purchase|indent|requisition|kharido|kharidna|buy|procure|reorder)\b/;
const STOCK_WORDS = /\b(stock|inventory|kitna|kitne|how much|how many|bacha|available)\b/;

/** Recognises a command and pulls out quantity, unit, item and production line. */
export function parseCommand(text: string): ParsedCommand {
  const n = normalise(text);
  const words = n.split(' ');
  const lineM = /\bline\s*(?:number|no|nambar)?\s*([0-9]+|[a-z])\b/.exec(n);
  const line = lineM ? `Line ${lineM[1].toUpperCase()}` : null;
  // Quantity: the first number that is not the line number.
  let qty: number | null = null;
  let qtyAt = -1;
  for (let i = 0; i < words.length; i++) {
    if (!/^\d+(\.\d+)?$/.test(words[i])) continue;
    if (lineM && i > 0 && words[i - 1] === 'line') continue;
    if (lineM && i > 1 && words[i - 2] === 'line' && /^(number|no|nambar)$/.test(words[i - 1])) continue;
    qty = Number(words[i]);
    qtyAt = i;
    break;
  }
  const unit = qtyAt >= 0 ? unitOf(words[qtyAt + 1]) : null;
  const afterQty = qtyAt >= 0 ? words.slice(qtyAt + (unit ? 2 : 1)) : words;

  const isStockQ = STOCK_WORDS.test(n) && !ORDERISH.test(n.replace(/\bmake\b/, ''));
  const isWo = !isStockQ && (WO_WORDS.test(n) || (!!line && ORDERISH.test(n))) && !PR_WORDS.test(n);
  const isPr = !isStockQ && !isWo && PR_WORDS.test(n);

  if (isWo) {
    // Item: "of <item>", or "<item> ka production", or the words right after the quantity.
    const of = /\b(?:of|for)\s+([a-z0-9][a-z0-9 -]*?)(?:\s+(?:on|par|pe|in)\s+line\b|$)/.exec(n.replace(/\b(production|work) order\b/, ' '));
    let item = of ? cleanItem(of[1].split(' ')) : null;
    if (!item) {
      const until = afterQty.findIndex((w) => /^(ka|ki|ke|production|utpadan|order|banao|banane|on|par|pe|for|wo)$/.test(w));
      item = cleanItem(until >= 0 ? afterQty.slice(0, until) : afterQty.filter((w) => !WO_WORDS.test(w) && !ORDERISH.test(w)));
    }
    return { command: 'work_order', qty, unit: unit ?? (qty !== null ? 'units' : null), item, line, normalised: n };
  }
  if (isPr) {
    const until = afterQty.findIndex((w) => PR_WORDS.test(w) || /^(ka|ki|ke|for|order)$/.test(w));
    let item = cleanItem(until >= 0 ? afterQty.slice(0, until) : afterQty);
    if (!item) {
      const of = /\b(?:of|for)\s+([a-z][a-z0-9 -]*)$/.exec(n);
      item = of ? cleanItem(of[1].split(' ')) : null;
    }
    return { command: 'requisition', qty, unit, item, line: null, normalised: n };
  }
  if (isStockQ) {
    const item = cleanItem(words.filter((w) => !STOCK_WORDS.test(w)));
    return { command: 'stock', qty: null, unit: null, item, line: null, normalised: n };
  }
  return { command: null, qty, unit, item: null, line, normalised: n };
}

/** Speech recognition languages offered (browser Web Speech API codes). */
export const VOICE_LANGUAGES = [
  { code: 'en-IN', name: 'English' },
  { code: 'hi-IN', name: 'हिन्दी' },
  { code: 'te-IN', name: 'తెలుగు' },
  { code: 'ta-IN', name: 'தமிழ்' },
  { code: 'mr-IN', name: 'मराठी' },
  { code: 'kn-IN', name: 'ಕನ್ನಡ' },
  { code: 'gu-IN', name: 'ગુજરાતી' },
  { code: 'bn-IN', name: 'বাংলা' },
];
