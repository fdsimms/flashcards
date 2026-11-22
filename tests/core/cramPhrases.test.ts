import { describe, expect, it } from 'vitest';
import { cramLessonPhrases, parseCram, phraseLessonLines, phrasesSummary, practiceLabel, preparedLines, type Cram } from '../../src/core/cram';
import { isPhraseRoundId, MAX_PHRASES, phraseIsUsed, phraseOfRoundId, phraseRoundId, withPhraseEdited, withPhraseUsed, withPhrases, withoutPhrase } from '../../src/core/cramPhrases';

const cram = (over: Partial<Cram> = {}): Cram => ({
  id: 'race-2026-11-22', name: 'Race', date: '2026-11-22', createdAt: new Date(2026, 10, 20).toISOString(), addNew: true, rounds: [], ...over,
});
const run = { text: 'ฉันวิ่งแข่ง', english: 'I ran a race', reading: 'chǎn wîng kàeng' };

describe('withPhrases', () => {
  it('adds phrases in order, tidied, with the reading kept only when there is one', () => {
    const out = withPhrases(cram(), [{ text: ' ฉันวิ่ง  แข่ง ', english: ' I ran\n a race ', reading: '  ' }]);
    expect(out.phrases).toEqual([{ text: 'ฉันวิ่ง แข่ง', english: 'I ran a race' }]);
  });
  it('leaves out one already there, one repeated, and one with no meaning', () => {
    const out = withPhrases(cram({ phrases: [run] }), [run, { text: 'ซ้อม', english: 'train' }, { text: 'ซ้อม', english: 'practice' }, { text: 'x', english: ' ' }]);
    expect(out.phrases?.map((p) => p.text)).toEqual(['ฉันวิ่งแข่ง', 'ซ้อม']);
  });
  it('keeps no more than the limit', () => {
    const many = Array.from({ length: MAX_PHRASES + 3 }, (_, i) => ({ text: `ก${i}`, english: 'x' }));
    expect(withPhrases(cram(), many).phrases).toHaveLength(MAX_PHRASES);
  });
});

describe('removing, editing and checking off', () => {
  it('removes a phrase and its check mark', () => {
    const c = withPhraseUsed(cram({ phrases: [run] }), run.text, true);
    const out = withoutPhrase(c, run.text);
    expect(out.phrases).toEqual([]);
    expect(out.usedPhrases).toEqual([]);
  });
  it('edits in place, and an edited text is unchecked', () => {
    const c = withPhraseUsed(cram({ phrases: [run, { text: 'ซ้อม', english: 'train' }] }), run.text, true);
    const out = withPhraseEdited(c, run.text, { text: 'ฉันวิ่งแข่งเมื่อวาน', english: 'I ran a race yesterday' });
    expect(out.phrases?.map((p) => p.text)).toEqual(['ฉันวิ่งแข่งเมื่อวาน', 'ซ้อม']);
    expect(phraseIsUsed(out, { text: 'ฉันวิ่งแข่งเมื่อวาน' })).toBe(false);
  });
  it('keeps the check mark when only the meaning changes', () => {
    const c = withPhraseUsed(cram({ phrases: [run] }), run.text, true);
    expect(phraseIsUsed(withPhraseEdited(c, run.text, { ...run, english: 'I ran in a race' }), run)).toBe(true);
  });
  it("refuses an edit that would repeat another phrase's text", () => {
    const c = cram({ phrases: [run, { text: 'ซ้อม', english: 'train' }] });
    expect(withPhraseEdited(c, 'ซ้อม', { text: run.text, english: 'x' })).toBe(c);
  });
  it('checks off and back', () => {
    const c = cram({ phrases: [run] });
    expect(phraseIsUsed(withPhraseUsed(c, run.text, true), run)).toBe(true);
    expect(phraseIsUsed(withPhraseUsed(withPhraseUsed(c, run.text, true), run.text, false), run)).toBe(false);
  });
});

describe('round ids', () => {
  it('names a phrase apart from any note and finds it again', () => {
    const c = cram({ phrases: [run] });
    const id = phraseRoundId(run);
    expect(isPhraseRoundId(id)).toBe(true);
    expect(isPhraseRoundId('1700000000000')).toBe(false);
    expect(phraseOfRoundId(c, id)).toEqual(run);
    expect(phraseOfRoundId(cram(), id)).toBeUndefined();
  });
});

describe('where phrases reach', () => {
  it("are lines of Listen's lesson, leaving out any too long to send, ahead of the words", () => {
    const c = cram({ phrases: [run, { text: 'ก'.repeat(300), english: 'too long' }] });
    expect(phraseLessonLines(c)).toEqual([{ text: run.text, english: run.english }]);
    const lesson = cramLessonPhrases(c, [], 'th');
    expect(lesson.phrases).toEqual([{ text: run.text, english: run.english }]);
    expect(lesson.lines).toEqual([run.text]);
  });
  it("are labeled lines for the tutor of a rehearsal", () => {
    expect(preparedLines(cram({ phrases: [run] }))).toEqual(['Phrase to practice: ฉันวิ่งแข่ง (I ran a race)']);
  });
  it('survive being saved and read back', () => {
    const c = cram({ phrases: [run], usedPhrases: ['x'] });
    expect(parseCram(JSON.stringify(c))).toMatchObject({ phrases: [run], usedPhrases: ['x'] });
  });
});

describe('practice with phrases', () => {
  it('names the phrases in the Practice button', () => {
    expect(practiceLabel(cram(), ['1', '2'], 3)).toBe('Practice 2 words and 3 phrases');
    expect(practiceLabel(cram(), ['1', '2'], 1)).toBe('Practice 2 words and 1 phrase');
    expect(practiceLabel(cram(), [], 2)).toBe('Practice 2 phrases');
    expect(practiceLabel(cram(), ['1', '2'])).toBe('Practice 2 words');
  });
  it('sums up a cram of phrases alone', () => {
    expect(phrasesSummary(1)).toBe('1 phrase.');
    expect(phrasesSummary(3)).toBe('3 phrases.');
  });
});
