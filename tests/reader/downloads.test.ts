import { describe, expect, it } from 'vitest';
import type { AudioLesson, Shelf, ShelfStory, ShelfText } from '../../src/reader/api';
import { card, readerText, saved } from '../support/reader';
import {
  asksBeforeLesson, EMPTY_INDEX, mayKeepWhilePlaying, shelfCardFor, cardOfText, pastOverflow, PAST_KEPT, lessonsGone, lessonsRefreshed, linesWithAudio, mayDownload, offlineShelf, parseHeldReader, parseIndex, planTexts,
  languagesToKeep, readOffline, savedState, usageText, type DownloadIndex,
} from '../../src/reader/downloads';

const story = (next: ShelfText | null): ShelfStory => ({ id: 9, title: 'The flat', about: '', read: 3, last_recap: '', next, writing: true, stage: 'writing', failed: null });

const shelf = (texts: ShelfText[], next: ShelfText | null = null, language: Shelf['language'] = 'pl'): Shelf => ({
  language, languages: [], texts, writing: [{ topic: 'beach', reason: 'asked', form: 'story' }], story: next ? story(next) : null,
});

const lesson = (id: number, language: AudioLesson['language'] = 'pl'): AudioLesson => ({
  id, language, scene: 'bakery', title: 'At the bakery', state: 'ready', error: '', duration_ms: 300_000, created_at: '2026-11-14T12:00', phrases: [], dialogue: [],
});

describe('when texts download by themselves', () => {
  it('follows the setting', () => {
    expect(mayDownload('wifi', 'wifi')).toBe(true);
    expect(mayDownload('wifi', 'cellular')).toBe(false);
    expect(mayDownload('any', 'cellular')).toBe(true);
    expect(mayDownload('any', 'none')).toBe(false);
    expect(mayDownload('off', 'wifi')).toBe(false);
  });

  it('asks before a tapped lesson only on cellular, unless any connection is allowed', () => {
    expect(asksBeforeLesson('wifi', 'cellular')).toBe(true);
    expect(asksBeforeLesson('off', 'cellular')).toBe(true);
    expect(asksBeforeLesson('any', 'cellular')).toBe(false);
    expect(asksBeforeLesson('wifi', 'wifi')).toBe(false);
  });
});

describe('keeping a text as it plays', () => {
  it('ignores Wi-Fi only, since the text is streaming anyway, but not Off or no connection', () => {
    expect(mayKeepWhilePlaying('wifi', 'cellular')).toBe(true);
    expect(mayKeepWhilePlaying('any', 'cellular')).toBe(true);
    expect(mayKeepWhilePlaying('off', 'wifi')).toBe(false);
    expect(mayKeepWhilePlaying('wifi', 'none')).toBe(false);
  });

  it("finds a text's card on any shelf read, the story's next episode included", () => {
    const index = { shelves: { pl: shelf([card({ id: 1 })], card({ id: 2 })) } };
    expect(shelfCardFor(index, 1)?.id).toBe(1);
    expect(shelfCardFor(index, 2)?.id).toBe(2);
    expect(shelfCardFor(index, 3)).toBeNull();
  });
});

describe('played past texts', () => {
  const past = (id: number) => saved(id, { past: true });

  it('are left alone by the shelf plan and left off the shelf shown offline', () => {
    const index = { ...EMPTY_INDEX, texts: [past(7), saved(1)] };
    expect(planTexts(shelf([card({ id: 1 })]), index).drop).toEqual([]);
    expect(offlineShelf({ ...index, shelves: {} }, new Set(), 'pl')?.texts.map((t) => t.id)).toEqual([1]);
  });

  it('keep only the latest few, oldest dropped first', () => {
    const texts = Array.from({ length: PAST_KEPT + 2 }, (_, i) => past(100 + i));
    expect(pastOverflow({ texts: [saved(1), ...texts] })).toEqual([100, 101]);
    expect(pastOverflow({ texts: [saved(1), past(5)] })).toEqual([]);
  });

  it('get a card made from the text', () => {
    expect(cardOfText(readerText(4))).toMatchObject({ id: 4, lines: readerText(4).lines.length });
  });
});

describe('planTexts', () => {
  it('fetches what is on the shelf and not kept whole, the story episode first', () => {
    const index = { texts: [saved(2), saved(3, { complete: false })] };
    const plan = planTexts(shelf([card({ id: 2 }), card({ id: 3 })], card({ id: 7, reason: 'story' })), index);
    expect(plan.fetch.map((t) => t.id)).toEqual([7, 3]);
  });

  it("keeps the learner's own texts too, after the shelf's, and doesn't drop them as gone", () => {
    const own = card({ id: 8, reason: 'own' });
    const index = { texts: [saved(8, { card: own })] };
    const withOwn = { ...shelf([card({ id: 2 })]), own: [own, card({ id: 9, reason: 'own' })] };
    expect(planTexts(withOwn, index).fetch.map((t) => t.id)).toEqual([2, 9]);
    expect(planTexts(withOwn, index).drop).toEqual([]);
  });

  it('drops kept texts of the shelf language that left it, and leaves other languages alone', () => {
    const index = { texts: [saved(2), saved(4), saved(5, { language: 'th' })] };
    expect(planTexts(shelf([card({ id: 2 })]), index).drop).toEqual([4]);
  });
});

describe('the shelf offline', () => {
  it('keeps only what is kept whole and not read since, with nothing being written', () => {
    const index: DownloadIndex = { ...EMPTY_INDEX, texts: [saved(2), saved(3), saved(4, { complete: false }), saved(7)], shelves: { pl: shelf([card({ id: 2 }), card({ id: 3 }), card({ id: 4 })], card({ id: 7 })) } };
    const offline = offlineShelf(index, new Set([3]), 'pl')!;
    expect(offline.texts.map((t) => t.id)).toEqual([2]);
    expect(offline.writing).toEqual([]);
    expect(offline.story).toMatchObject({ next: { id: 7 }, writing: false, stage: null });
  });

  it("keeps the learner's own texts in their own row, with or without the shelf read", () => {
    const own = card({ id: 8, reason: 'own' });
    const index: DownloadIndex = { ...EMPTY_INDEX, texts: [saved(2), saved(8, { card: own })], shelves: { pl: { ...shelf([card({ id: 2 })]), own: [own, card({ id: 9, reason: 'own' })] } } };
    const offline = offlineShelf(index, new Set(), 'pl')!;
    expect(offline.texts.map((t) => t.id)).toEqual([2]);
    expect(offline.own?.map((t) => t.id)).toEqual([8]);
    const unread = offlineShelf({ ...index, shelves: {} }, new Set(), 'pl')!;
    expect(unread.texts.map((t) => t.id)).toEqual([2]);
    expect(unread.own?.map((t) => t.id)).toEqual([8]);
  });

  it("drops the story's episode when it isn't kept", () => {
    const index: DownloadIndex = { ...EMPTY_INDEX, texts: [], shelves: { pl: shelf([], card({ id: 7 })) } };
    expect(offlineShelf(index, new Set(), 'pl')?.story?.next).toBeNull();
  });

  it("makes do with a language's kept texts when its shelf wasn't read yet", () => {
    expect(offlineShelf({ ...EMPTY_INDEX, texts: [saved(2), saved(3, { language: 'th' })] }, new Set(), 'pl')?.texts.map((t) => t.id)).toEqual([2]);
    expect(offlineShelf(EMPTY_INDEX, new Set(), 'pl')).toBeNull();
  });

  it("keeps each language's shelf apart", () => {
    const index: DownloadIndex = { ...EMPTY_INDEX, texts: [saved(2), saved(5, { language: 'th' })], shelves: { pl: shelf([card({ id: 2 })]), th: shelf([card({ id: 5 })], null, 'th') } };
    expect(offlineShelf(index, new Set(), 'th')?.texts.map((t) => t.id)).toEqual([5]);
  });

  it('keeps every language with texts ready, and any with texts already kept', () => {
    const current = { language: 'pl' as const, languages: [{ code: 'pl' as const, name: 'Polish', ready: 2 }, { code: 'th' as const, name: 'Thai', ready: 1 }, { code: 'de' as const, name: 'German', ready: 0 }] };
    expect(languagesToKeep(current, { texts: [saved(9, { language: 'es' })] })).toEqual(['pl', 'th', 'es']);
  });
});

describe('what the screens show', () => {
  it('says whether a text is on this iPhone', () => {
    const index = { texts: [saved(2), saved(3, { complete: false })] };
    expect(savedState(index, 2, new Set())).toBe('saved');
    expect(savedState(index, 3, new Set([3]))).toBe('saving');
    expect(savedState(index, 3, new Set())).toBe('waiting');
  });

  it('counts what is kept', () => {
    expect(usageText({ texts: [], lessons: [] })).toBe('Nothing is on this iPhone yet.');
    expect(usageText({ texts: [saved(1), saved(2)], lessons: [{ lesson: lesson(1), complete: true, bytes: 2_000_000 }] }))
      .toBe('On this iPhone: 2 texts and 1 lesson, 2.6 MB.');
  });

  it('lists the lines a text has recordings for', () => {
    expect(linesWithAudio(readerText(1, [true, false, true]))).toEqual([0, 2]);
  });

  it('finds none in a text with no recordings at all (Toki Pona has no voice)', () => {
    expect(linesWithAudio(readerText(1, [false, false]))).toEqual([]);
  });
});

describe('lessons', () => {
  it("drops kept lessons the language's list no longer has", () => {
    const index = { lessons: [{ lesson: lesson(1), complete: true, bytes: 1 }, { lesson: lesson(2), complete: true, bytes: 1 }, { lesson: lesson(3, 'th'), complete: true, bytes: 1 }] };
    expect(lessonsGone('pl', [lesson(1)], index)).toEqual([2]);
  });

  it('brings a kept lesson up to date with the list, so pauses found since reach it offline', () => {
    const kept = { lesson: { ...lesson(1), pauses: null }, complete: true, bytes: 7 };
    const other = { lesson: lesson(2), complete: true, bytes: 1 };
    const listed = { ...lesson(1), pauses: [[2_000, 5_000]] as [number, number][] };
    expect(lessonsRefreshed([listed], { lessons: [kept, other] })).toEqual([{ ...kept, lesson: listed }, other]);
  });

  it('changes nothing when the list says what the kept copies say', () => {
    expect(lessonsRefreshed([lesson(1)], { lessons: [{ lesson: lesson(1), complete: true, bytes: 1 }] })).toBeNull();
  });
});

describe('reading back', () => {
  it('reads back only what it wrote', () => {
    expect(parseIndex({ version: 1, texts: [saved(1), { id: 'x' }], lessons: [], shelves: {} }).texts).toHaveLength(1);
    expect(parseIndex(null)).toEqual(EMPTY_INDEX);
    expect(parseHeldReader([{ kind: 'choice', textId: 1, choice: 2 }, { kind: 'reading', textId: 1 }, { kind: 'listen', textId: 3 }, { kind: 'language', language: 'th' }])).toHaveLength(3);
    expect(parseHeldReader([{ kind: 'lessonHeard', lessonId: 4 }, { kind: 'lessonHeard' }])).toEqual([{ kind: 'lessonHeard', lessonId: 4 }]);
  });

  it('knows which texts were read offline', () => {
    expect([...readOffline([{ kind: 'choice', textId: 1, choice: 0 }, { kind: 'listen', textId: 2 }, { kind: 'reading', textId: 3, log: {} as never }])]).toEqual([3]);
  });
});
