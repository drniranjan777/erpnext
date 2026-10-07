import { describe, expect, it } from 'vitest';
import { VOICE_EVAL, scoreEval } from '../../src/modules/voice/eval-set';
import { normalise, parseCommand, wordsToNumbers } from '../../src/modules/voice/grammar';

describe('number words', () => {
  it('reads Hindi, Hinglish and English numbers', () => {
    expect(wordsToNumbers('paanch hazaar units')).toBe('5000 units');
    expect(wordsToNumbers('do sau pachaas kg')).toBe('250 kg');
    expect(wordsToNumbers('dedh hazaar')).toBe('1500');
    expect(wordsToNumbers('do lakh')).toBe('200000');
    expect(wordsToNumbers('five thousand')).toBe('5000');
    expect(wordsToNumbers('10 hazaar caps')).toBe('10000 caps');
    expect(normalise('लाइन २ पर पांच हजार यूनिट')).toBe('line 2 par 5000 units');
    expect(normalise('5,000 units')).toBe('5000 units');
  });
});

describe('commands', () => {
  it('understands the headline example', () => {
    expect(parseCommand('Line 2 par 5,000 units ka production order banao')).toMatchObject({ command: 'work_order', qty: 5000, unit: 'units', line: 'Line 2', item: null });
  });
  it('meets 90 % on the evaluation set, in each language', () => {
    const r = scoreEval(parseCommand);
    expect(r.cases).toBe(VOICE_EVAL.length);
    if (r.accuracyPct < 90) console.log(JSON.stringify(r.failures, null, 2));
    expect(r.accuracyPct).toBeGreaterThanOrEqual(90);
    expect(r.byLanguage.en!).toBeGreaterThanOrEqual(90);
    expect(r.byLanguage.hi!).toBeGreaterThanOrEqual(90);
  });
});
