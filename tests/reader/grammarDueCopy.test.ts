import { describe, expect, it } from 'vitest';
import { decodeGrammarDue, encodeGrammarDue } from '../../src/reader/grammarDueCopy';

const due = { total: 6, languages: [{ language: 'th' as const, count: 4 }, { language: 'el' as const, count: 2 }] };

describe('grammar due copy', () => {
  it('reads back what was saved for the same study day', () => {
    expect(decodeGrammarDue(encodeGrammarDue(due, '2026-11-18'), '2026-11-18')).toEqual(due);
  });

  it('ignores a copy from another study day', () => {
    expect(decodeGrammarDue(encodeGrammarDue(due, '2026-11-17'), '2026-11-18')).toBeNull();
  });

  it('ignores a missing, damaged or unrecognized copy', () => {
    expect(decodeGrammarDue(null, '2026-11-18')).toBeNull();
    expect(decodeGrammarDue('{', '2026-11-18')).toBeNull();
    expect(decodeGrammarDue(JSON.stringify({ day: '2026-11-18', due: { languages: [{ language: 'xx', count: 1 }] } }), '2026-11-18')).toBeNull();
    expect(decodeGrammarDue(JSON.stringify({ day: '2026-11-18', due: { languages: [{ language: 'th', count: -1 }] } }), '2026-11-18')).toBeNull();
  });

  it('works the total out from the languages', () => {
    const raw = JSON.stringify({ day: 'd', due: { total: 99, languages: [{ language: 'th', count: 1 }] } });
    expect(decodeGrammarDue(raw, 'd')?.total).toBe(1);
  });
});
