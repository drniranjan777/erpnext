import type { VoiceCommand } from './grammar';

/**
 * Evaluation set for voice commands on the ERP vocabulary: what people say on the shop floor and
 * in the office, in English, Hindi (Devanagari) and Hinglish, with what must be understood.
 * The target is 90 % or better (Phase 12 exit criterion); `item` is compared loosely (contains).
 */
export interface EvalCase {
  text: string;
  lang: 'en' | 'hi' | 'hinglish';
  expect: { command: VoiceCommand | null; qty?: number | null; line?: string | null; item?: string | null; unit?: string | null };
}

export const VOICE_EVAL: EvalCase[] = [
  // ---- production orders ----
  { text: 'Line 2 par 5,000 units ka production order banao', lang: 'hinglish', expect: { command: 'work_order', qty: 5000, line: 'Line 2', item: null } },
  { text: 'line 3 pe paanch hazaar pieces ka production order banao', lang: 'hinglish', expect: { command: 'work_order', qty: 5000, line: 'Line 3' } },
  { text: 'लाइन 2 पर 5000 यूनिट का प्रोडक्शन ऑर्डर बनाओ', lang: 'hi', expect: { command: 'work_order', qty: 5000, line: 'Line 2' } },
  { text: 'लाइन २ पर पांच हजार यूनिट का उत्पादन ऑर्डर बनाओ', lang: 'hi', expect: { command: 'work_order', qty: 5000, line: 'Line 2' } },
  { text: 'Create a production order for 1200 hex bolts on line 1', lang: 'en', expect: { command: 'work_order', qty: 1200, line: 'Line 1', item: 'hex bolt' } },
  { text: 'Make a work order of 300 units of ceiling fan', lang: 'en', expect: { command: 'work_order', qty: 300, item: 'ceiling fan' } },
  { text: 'line 4 par 800 ceiling fan ka production order banao', lang: 'hinglish', expect: { command: 'work_order', qty: 800, line: 'Line 4', item: 'ceiling fan' } },
  { text: 'do hazaar crate banane ka order line 1 pe', lang: 'hinglish', expect: { command: 'work_order', qty: 2000, line: 'Line 1', item: 'crate' } },
  { text: 'start production of 450 PVC pipes on line 5', lang: 'en', expect: { command: 'work_order', qty: 450, line: 'Line 5', item: 'pvc pipe' } },
  { text: 'Line B par dedh hazaar units banao', lang: 'hinglish', expect: { command: 'work_order', qty: 1500, line: 'Line B' } },
  { text: 'production order for 750 brackets', lang: 'en', expect: { command: 'work_order', qty: 750, item: 'bracket' } },
  { text: 'लाइन 1 पर 250 क्रेट का प्रोडक्शन ऑर्डर बनाओ', lang: 'hi', expect: { command: 'work_order', qty: 250, line: 'Line 1' } },
  { text: 'line 2 pe 10 hazaar caps ka production chalu karo', lang: 'hinglish', expect: { command: 'work_order', qty: 10000, line: 'Line 2', item: 'caps' } },
  { text: 'create work order 600 units line 3', lang: 'en', expect: { command: 'work_order', qty: 600, line: 'Line 3' } },
  { text: 'Line 2 par do lakh units ka order banao', lang: 'hinglish', expect: { command: 'work_order', qty: 200000, line: 'Line 2' } },
  // ---- requisitions ----
  { text: '50 kg resin mangwao', lang: 'hinglish', expect: { command: 'requisition', qty: 50, unit: 'kg', item: 'resin' } },
  { text: 'paanch sau kilo HDPE granules mangwa do', lang: 'hinglish', expect: { command: 'requisition', qty: 500, unit: 'kg', item: 'hdpe granules' } },
  { text: '50 किलो रेज़िन मंगवाओ', lang: 'hi', expect: { command: 'requisition', qty: 50, unit: 'kg' } },
  { text: 'Raise an indent for 200 bags of cement', lang: 'en', expect: { command: 'requisition', qty: 200, unit: 'bag', item: 'cement' } },
  { text: 'purchase 20 boxes of hex bolts', lang: 'en', expect: { command: 'requisition', qty: 20, unit: 'box', item: 'hex bolt' } },
  { text: 'buy 100 litres of hydraulic oil', lang: 'en', expect: { command: 'requisition', qty: 100, unit: 'litre', item: 'hydraulic oil' } },
  { text: 'teen ton steel coil kharido', lang: 'hinglish', expect: { command: 'requisition', qty: 3, unit: 'tonne', item: 'steel coil' } },
  { text: '1000 pieces bearing 6205 ka indent banao', lang: 'hinglish', expect: { command: 'requisition', qty: 1000, unit: 'units', item: 'bearing' } },
  { text: 'requisition for 75 kg copper wire', lang: 'en', expect: { command: 'requisition', qty: 75, unit: 'kg', item: 'copper wire' } },
  { text: 'das bori cement mangao', lang: 'hinglish', expect: { command: 'requisition', qty: 10, unit: 'bag', item: 'cement' } },
  { text: '२०० किलो कॉपर वायर मंगवाओ', lang: 'hi', expect: { command: 'requisition', qty: 200, unit: 'kg' } },
  // ---- stock questions ----
  { text: 'hex bolt ka stock kitna hai', lang: 'hinglish', expect: { command: 'stock', item: 'hex bolt' } },
  { text: 'How much stock of resin do we have', lang: 'en', expect: { command: 'stock', item: 'resin' } },
  { text: 'रेज़िन का स्टॉक कितना है', lang: 'hi', expect: { command: 'stock' } },
  { text: 'copper wire kitna bacha hai', lang: 'hinglish', expect: { command: 'stock', item: 'copper wire' } },
  { text: 'what is the stock of ceiling fan', lang: 'en', expect: { command: 'stock', item: 'ceiling fan' } },
  { text: 'PVC pipe ka stock batao', lang: 'hinglish', expect: { command: 'stock', item: 'pvc pipe' } },
  { text: 'how many brackets are available', lang: 'en', expect: { command: 'stock', item: 'bracket' } },
  { text: 'cement kitne bag hai', lang: 'hinglish', expect: { command: 'stock', item: 'cement' } },
  { text: 'show inventory of hydraulic oil', lang: 'en', expect: { command: 'stock', item: 'hydraulic oil' } },
  { text: 'स्टॉक कितना है हेक्स बोल्ट का', lang: 'hi', expect: { command: 'stock' } },
  // ---- not commands (go to the copilot) ----
  { text: 'aaj ki sales kitni hui', lang: 'hinglish', expect: { command: null } },
  { text: 'show my pending approvals', lang: 'en', expect: { command: null } },
  { text: 'PO 123 kholo', lang: 'hinglish', expect: { command: null } },
  { text: 'why is invoice 45 stuck', lang: 'en', expect: { command: null } },
  { text: 'मेरी अप्रूवल दिखाओ', lang: 'hi', expect: { command: null } },
  { text: 'who are the top customers this month', lang: 'en', expect: { command: null } },
];

const singular = (s: string) => s.replace(/(es|s)$/, '');

/** Scores the parser against the set; an item is right when either text contains the other (singular). */
export function scoreEval(parse: (text: string) => { command: VoiceCommand | null; qty: number | null; line: string | null; item: string | null; unit: string | null }) {
  const results = VOICE_EVAL.map((c) => {
    const p = parse(c.text);
    const misses: string[] = [];
    if (p.command !== c.expect.command) misses.push(`command ${p.command} ≠ ${c.expect.command}`);
    if (c.expect.qty !== undefined && p.qty !== c.expect.qty) misses.push(`qty ${p.qty} ≠ ${c.expect.qty}`);
    if (c.expect.line !== undefined && p.line !== c.expect.line) misses.push(`line ${p.line} ≠ ${c.expect.line}`);
    if (c.expect.unit !== undefined && p.unit !== c.expect.unit) misses.push(`unit ${p.unit} ≠ ${c.expect.unit}`);
    if (c.expect.item !== undefined) {
      if (c.expect.item === null ? p.item !== null : !p.item || !(singular(p.item).includes(singular(c.expect.item)) || singular(c.expect.item).includes(singular(p.item)))) misses.push(`item ${p.item} ≠ ${c.expect.item}`);
    }
    return { text: c.text, lang: c.lang, ok: !misses.length, misses };
  });
  const by = (lang: string) => {
    const r = results.filter((x) => x.lang === lang);
    return r.length ? Math.round((r.filter((x) => x.ok).length / r.length) * 1000) / 10 : null;
  };
  return { cases: results.length, accuracyPct: Math.round((results.filter((r) => r.ok).length / results.length) * 1000) / 10, byLanguage: { en: by('en'), hi: by('hi'), hinglish: by('hinglish') }, failures: results.filter((r) => !r.ok) };
}
