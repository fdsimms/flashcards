import { describe, expect, it } from 'vitest';
import { isGap, showSentence } from '../../../src/tools/contrasts';
import { THAI_CONTRASTS, unromanized } from '../../../src/tools/thai/contrasts';

describe("Thai's Which word fits sets", () => {
  it('romanizes every word a sentence uses', () => {
    expect(unromanized(THAI_CONTRASTS)).toEqual([]);
    for (const set of THAI_CONTRASTS) for (const s of set.sentences) expect(s.roman, s.tokens.join(' ')).not.toContain('?');
  });

  it('gives each set at least two words, each with a rule, and about ten sentences that use every word', () => {
    for (const set of THAI_CONTRASTS) {
      expect(set.words.length, set.id).toBeGreaterThanOrEqual(2);
      for (const w of set.words) expect(w.rule.trim(), w.word).not.toBe('');
      expect(set.sentences.length, set.id).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < set.words.length; i++) expect(set.sentences.some((s) => s.answer === i), `${set.id}: ${set.words[i].word}`).toBe(true);
    }
  });

  it('puts exactly one gap in each sentence, and an answer that is one of the set', () => {
    for (const set of THAI_CONTRASTS) {
      for (const s of set.sentences) {
        expect(s.tokens.filter(isGap), s.tokens.join(' ')).toHaveLength(1);
        expect(set.words[s.answer], s.tokens.join(' ')).toBeDefined();
        expect(s.english.trim()).not.toBe('');
      }
    }
  });

  it('never repeats a sentence within a set', () => {
    for (const set of THAI_CONTRASTS) {
      const texts = set.sentences.map((s) => s.tokens.join(' '));
      expect(new Set(texts).size, set.id).toBe(texts.length);
    }
  });

  it('has ids that start with th- and are unique', () => {
    const ids = THAI_CONTRASTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('th-')).toBe(true);
  });

  it('keeps em dashes out of what is shown', () => {
    for (const set of THAI_CONTRASTS) {
      for (const w of set.words) expect(w.rule).not.toContain('—');
      for (const s of set.sentences) expect(s.english).not.toContain('—');
    }
  });

  it('writes a sentence without spaces between words, with the gap where the answer goes', () => {
    const jon = THAI_CONTRASTS.find((s) => s.id === 'th-jon')!;
    expect(showSentence(jon, 0, 'th')).toMatchObject({ before: 'ฉันจะรอ', after: 'เขาจะมา', filled: 'ฉันจะรอจนกว่าเขาจะมา', roman: 'chǎn jà raaw jon-gwàa khǎo jà maa' });
  });

  it('keeps the space Thai puts between phrases', () => {
    const cold = THAI_CONTRASTS.find((s) => s.id === 'th-cold')!;
    expect(showSentence(cold, 0, 'th')).toMatchObject({ before: 'ฉัน', after: 'จัง ขอผ้าห่มหน่อย', filled: 'ฉันหนาวจัง ขอผ้าห่มหน่อย' });
    const kha = THAI_CONTRASTS.find((s) => s.id === 'th-kha')!;
    expect(showSentence(kha, 6, 'th')).toMatchObject({ before: '', after: ' ฉันเข้าใจแล้ว', filled: 'ค่ะ ฉันเข้าใจแล้ว' });
  });

  it('repeats the word before ๆ in the romanization', () => {
    const cold = THAI_CONTRASTS.find((s) => s.id === 'th-cold')!;
    expect(cold.sentences[5].roman).toBe('sài sûea nǎa nǎa ná dǐao nǎao');
    expect(showSentence(cold, 5, 'th')!.filled).toBe('ใส่เสื้อหนาๆนะ เดี๋ยวหนาว');
  });
});
