import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JournalCheck, JournalMistake, JournalSentence } from '../../src/reader/api';
import {
  afterEntriesSent,
  asksAnotherTry,
  firstTry,
  holdEntry,
  JOURNAL_MAX,
  journalHeadline,
  kindPractice,
  markedParts,
  parseDrafts,
  parseHeldEntries,
  preview,
  withDraft,
  type HeldEntry,
} from '../../src/reader/journal';

const mistake = (was: string, hint: string, over: Partial<JournalMistake> = {}): JournalMistake => ({
  was, now: '', kind: 'other', name: 'Something else', case: null, governor: null, note: '', hint, ...over,
});
const sentence = (written: string, mistakes: JournalMistake[] = [], corrected = written): JournalSentence => ({
  written, corrected, english: '', verdict: mistakes.length ? 'almost' : 'right', mistakes,
});
const check = (sentences: JournalSentence[], verdict: JournalCheck['verdict'] = 'almost'): JournalCheck => ({ verdict, sentences, filled: [] });

describe('the first try', () => {
  it('picks out each mistake and numbers them in the order they come', () => {
    // Claude listed the later mistake first: the marks still read left to right.
    const s = sentence('Wieczorem oglądałem film z moja siostra.', [mistake('siostra', 'second'), mistake('moja', 'first')]);
    const { parts, marks, next } = markedParts(s, 3);
    expect(parts).toEqual([
      { text: 'Wieczorem oglądałem film z ' },
      { text: 'moja', mark: 3 },
      { text: ' ' },
      { text: 'siostra', mark: 4 },
      { text: '.' },
    ]);
    expect(marks).toEqual([4, 3]);
    expect(next).toBe(5);
  });

  it('marks the same words twice in two places, and a missing word at the end', () => {
    const s = sentence('to jest to', [mistake('to', 'a'), mistake('to', 'b'), mistake('', 'missing')]);
    const { parts, marks } = markedParts(s, 1);
    expect(parts.filter((p) => p.mark !== undefined)).toEqual([{ text: 'to', mark: 1 }, { text: 'to', mark: 2 }, { text: '', mark: 3 }]);
    expect(marks).toEqual([1, 2, 3]);
  });

  it('numbers hints across the whole entry, as the marks are', () => {
    const got = firstTry(check([
      sentence('Wczoraj ja idę do sklepu.', [mistake('idę', 'tense')]),
      sentence('Kupiłem chleb.'),
      sentence('Nie mam czas.', [mistake('czas', 'case')]),
    ]));
    expect(got.hints).toEqual([{ mark: 1, hint: 'tense' }, { mark: 2, hint: 'case' }]);
    expect(got.sentences[1]).toEqual([{ text: 'Kupiłem chleb.' }]);
  });
});

describe('what the check says', () => {
  const some = check([sentence('a', [mistake('a', 'x')]), sentence('b'), sentence('c', [mistake('c', 'y')])]);

  it('counts the sentences to fix, then how many were right', () => {
    expect(journalHeadline(some, false)).toBe('Almost. 2 sentences to fix.');
    expect(journalHeadline({ ...some, verdict: 'wrong' }, false)).toBe('Not quite. 2 sentences to fix.');
    expect(journalHeadline(some, true)).toBe('1 of 3 sentences right');
    expect(journalHeadline(check([sentence('a'), sentence('b')], 'right'), true)).toBe('All 2 sentences right.');
    expect(journalHeadline(check([sentence('a')], 'right'), false)).toBe("Right. This is how it's said.");
  });

  it('asks for one more try only the first time, and only with something to fix', () => {
    expect(asksAnotherTry({ tries: 1, check: some })).toBe(true);
    expect(asksAnotherTry({ tries: 2, check: some })).toBe(false);
    expect(asksAnotherTry({ tries: 1, check: check([sentence('a')], 'right') })).toBe(false);
  });

  it('offers Which case for a case ending where it has one, and a point its page', () => {
    expect(kindPractice({ group: 'case:genitive', point: null }, ['pl', 'ru'], 'pl')).toBe('cases');
    expect(kindPractice({ group: 'case:genitive', point: null }, ['pl', 'ru'], 'es')).toBeNull();
    expect(kindPractice({ group: 'pl.past', point: 'pl.past' }, ['pl'], 'pl')).toBe('point');
    expect(kindPractice({ group: 'word_order', point: null }, ['pl'], 'pl')).toBeNull();
  });

  it('shortens an entry to one line for the list', () => {
    expect(preview('  Wczoraj\n\nposzedłem  do sklepu.  ')).toBe('Wczoraj poszedłem do sklepu.');
    expect(preview('a'.repeat(80), 10)).toBe('aaaaaaaaa…');
  });

  it('allows as long an entry as the server checks', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '../../server/reader/openapi.json'), 'utf8'));
    expect(schema.components.schemas.JournalCheckIn.properties.text.maxLength).toBe(JOURNAL_MAX);
  });
});

describe('entries held offline', () => {
  const held = (key: string, over: Partial<HeldEntry> = {}): HeldEntry => ({ key, language: 'pl', text: key, prompt: '', at: 1, ...over });

  it('holds each entry once, the newest writing of it', () => {
    const list = holdEntry(holdEntry([], held('a')), held('b', { entryId: 7 }));
    expect(holdEntry(list, held('a', { text: 'again' })).map((h) => h.text)).toEqual(['b', 'again']);
    // Written again for the same kept entry, under a new key: still one.
    expect(holdEntry(list, held('c', { entryId: 7 })).map((h) => h.key)).toEqual(['a', 'c']);
  });

  it('drops what was checked, keeps what wasn\'t sent and marks what was refused', () => {
    const [a, b, c] = [held('a'), held('b'), held('c')];
    const later = held('d');
    expect(afterEntriesSent([a, b, c, later], [a, b, c], [b], [{ item: c, problem: 'No.' }])).toEqual([b, { ...c, problem: 'No.' }, later]);
  });

  it('reads back only well-formed entries and drafts', () => {
    expect(parseHeldEntries([held('a'), { key: 1 }, null])).toEqual([held('a')]);
    expect(parseHeldEntries('x')).toEqual([]);
    const draft = { language: 'pl', text: 'x', prompt: '', key: 'k' };
    expect(parseDrafts([draft, { language: 'pl' }])).toEqual([draft]);
  });

  it('keeps one draft a language', () => {
    const one = withDraft([], 'pl', { language: 'pl', text: 'a', prompt: '', key: '1' });
    const two = withDraft(one, 'pl', { language: 'pl', text: 'b', prompt: '', key: '1' });
    expect(two.map((d) => d.text)).toEqual(['b']);
    expect(withDraft(two, 'pl', null)).toEqual([]);
  });
});
