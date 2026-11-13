import { describe, expect, it } from 'vitest';
import { WaniKaniError } from '../../src/wanikani/api';
import {
  asksReading, madeOf, missingComponentIds, mnemonicParts, otherMeanings, parseAssignment, parseSubject, primaryMeaning, primaryReading, readingGroups,
  withComponents, type Subject,
} from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, kanjiResource, partResource, radicalResource, vocabResource } from './fixtures';

describe('reading subjects', () => {
  it('reads a vocabulary item with its meanings, readings, sentences and recordings', () => {
    const s = parseSubject(vocabResource)!;
    expect(s).toMatchObject({ id: 2467, type: 'vocabulary', level: 3, characters: '大人', srsId: 1, hidden: false });
    expect(primaryMeaning(s)).toBe('Adult');
    expect(otherMeanings(s)).toEqual(['Grown Up']);
    expect(primaryReading(s)).toBe('おとな');
    expect(s.auxiliaryMeanings).toEqual([{ meaning: 'Big Person', type: 'blacklist' }, { meaning: 'Mature Person', type: 'whitelist' }]);
    expect(s.contextSentences[0]).toEqual({ en: 'I want to be an adult soon.', ja: '早く大人になりたい。' });
    expect(s.audio.map((a) => a.contentType)).toEqual(['audio/webm', 'audio/mpeg']);
    expect(s.componentIds).toEqual([453, 440]);
    expect(asksReading(s)).toBe(true);
  });

  it("groups a kanji's readings by type, the type WaniKani teaches first", () => {
    const s = parseSubject(kanjiResource)!;
    expect(readingGroups(s)).toEqual([
      { type: 'onyomi', readings: ['りょく', 'りき'], primary: true },
      { type: 'kunyomi', readings: ['ちから'], primary: false },
    ]);
    expect(s.meaningHint).toBe('Strong.');
    expect(s.readingHint).toBeUndefined();
  });

  it('draws a radical with no characters from its image, and asks no reading', () => {
    const s = parseSubject(radicalResource)!;
    expect(s.characters).toBeNull();
    expect(s.image).toEqual({ url: 'https://files.wanikani.com/gun.svg', svg: true });
    expect(asksReading(s)).toBe(false);
  });

  it('asks a kana-only word its meaning only', () => {
    const s = parseSubject(kanaVocabResource)!;
    expect(s.type).toBe('kana_vocabulary');
    expect(asksReading(s)).toBe(false);
    expect(readingGroups(s)).toEqual([]);
  });

  it('drops what is not a subject', () => {
    expect(parseSubject(null)).toBeNull();
    expect(parseSubject({ id: 1, object: 'assignment', data: {} })).toBeNull();
    expect(parseSubject({ ...vocabResource, data: { ...vocabResource.data, meanings: [] } })).toBeNull();
  });

  it('reads an assignment', () => {
    expect(parseAssignment(assignmentResource(7, 2467, { srs_stage: 5, passed_at: '2026-11-10T00:00:00Z' }))).toEqual({
      id: 7, subjectId: 2467, subjectType: 'vocabulary', srsStage: 5,
      availableAt: '2026-11-12T10:00:00.000000Z', startedAt: '2026-11-01T10:00:00.000000Z',
      unlockedAt: '2026-10-31T10:00:00.000000Z', passedAt: '2026-11-10T00:00:00Z', hidden: false,
    });
    expect(parseAssignment({ id: 1, data: { subject_type: 'nope', subject_id: 1, srs_stage: 1 } })).toBeNull();
  });
});

describe('mnemonics', () => {
  it('splits out the marked-up words', () => {
    expect(mnemonicParts('A <kanji>big</kanji> <kanji>person</kanji> is an <vocabulary>adult</vocabulary>.')).toEqual([
      { text: 'A ' }, { text: 'big', mark: 'kanji' }, { text: ' ' }, { text: 'person', mark: 'kanji' },
      { text: ' is an ' }, { text: 'adult', mark: 'vocabulary' }, { text: '.' },
    ]);
  });

  it('drops tags it does not know', () => {
    expect(mnemonicParts('<i>Very</i> <reading>おとな</reading>')).toEqual([{ text: 'Very ' }, { text: 'おとな', mark: 'reading' }]);
  });
});

describe('what a subject is made of', () => {
  const vocab = parseSubject(vocabResource)!; // 大人, made of 453 and 440
  const kanji = parseSubject(kanjiResource)!; // 力, made of radical 12
  const big = parseSubject(partResource(453, 'kanji', '大', 'Big'))!;
  const person = parseSubject(partResource(440, 'kanji', '人', 'Person'))!;
  const power = parseSubject(partResource(12, 'radical', '力', 'Power'))!;
  const gun = parseSubject(radicalResource)!; // no characters, an SVG picture
  const nameOnly = parseSubject(partResource(77, 'radical', null, 'Stick'))!;

  it('asks for each part once, leaving out those already read', () => {
    expect(missingComponentIds([vocab, kanji])).toEqual([453, 440, 12]);
    // 大 is in the session itself, and a second word made of 人 doesn't ask for it twice.
    const other = { ...vocab, id: 9, componentIds: [440, 453] };
    expect(missingComponentIds([vocab, other, big])).toEqual([440]);
    expect(missingComponentIds([gun, parseSubject(kanaVocabResource)!])).toEqual([]);
  });

  it('reads the parts in one batched call, after the subjects', async () => {
    const calls: number[][] = [];
    const read = async (ids: number[]) => { calls.push(ids); return [big, person, power].filter((s) => ids.includes(s.id)); };
    const all = await withComponents([vocab, kanji], read);
    expect(calls).toEqual([[453, 440, 12]]);
    expect(all.map((s) => s.id)).toEqual([2467, 450, 453, 440, 12]);
  });

  it('makes no call when nothing is missing, and gives the subjects alone when the parts cannot be read', async () => {
    let called = false;
    expect(await withComponents([gun], async () => { called = true; return []; })).toEqual([gun]);
    expect(called).toBe(false);
    expect(await withComponents([vocab], async () => { throw new WaniKaniError('unavailable'); })).toEqual([vocab]);
  });

  it('builds the row in WaniKani\'s order, with each part\'s characters or picture and its meaning', () => {
    const map = new Map<number, Subject>([big, person, power, gun, nameOnly].map((s) => [s.id, s]));
    expect(madeOf(vocab, map)).toEqual([
      { id: 453, type: 'kanji', characters: '大', meaning: 'Big' },
      { id: 440, type: 'kanji', characters: '人', meaning: 'Person' },
    ]);
    const drawn = { ...kanji, componentIds: [8762, 77, 12] };
    expect(madeOf(drawn, map)).toEqual([
      { id: 8762, type: 'radical', characters: null, image: { url: 'https://files.wanikani.com/gun.svg', svg: true }, meaning: 'Gun' },
      { id: 77, type: 'radical', characters: null, meaning: 'Stick' },
      { id: 12, type: 'radical', characters: '力', meaning: 'Power' },
    ]);
  });

  it('leaves out a part that was not read, and has nothing for a radical', () => {
    expect(madeOf(vocab, new Map([[440, person]]))).toEqual([{ id: 440, type: 'kanji', characters: '人', meaning: 'Person' }]);
    expect(madeOf(gun, new Map())).toEqual([]);
  });
});
