import { describe, expect, it } from 'vitest';
import {
  heldCards, lookalikeForm, lookalikeIndex, lookalikeSettings, seenEvents, seenSince, soonerOffer, whenSeen, wordsLookAlike, type SeenEvent,
} from '../../src/core/lookalikes';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note, SchedState } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const DAY_START = 4;
const ES = '👅 Languages::🌮 Español';

function word(id: string, entry: string, over: Record<string, string> = {}, deck = ES): Note {
  return { ...omniNote({ Entry: entry, Language: 'spanish', ...over }), id, deck };
}

function card(noteId: string, sched: Partial<SchedState> = {}): Card {
  return { id: `${noteId}:forward`, noteId, kind: 'forward', suspended: false, retired: false, sched: { ...newSchedState(NOW), ...sched } };
}

const review = (lastReview: Date): Partial<SchedState> => ({ state: 2, lastReview: lastReview.toISOString(), due: NOW.toISOString(), scheduledDays: 10 });

describe('lookalikeForm / wordsLookAlike', () => {
  it('compares words without case, articles or what follows a bracket or dash', () => {
    expect(lookalikeForm('La Esperanza', 'es-MX')).toBe('esperanza');
    expect(lookalikeForm('czekać (to wait) — ja', 'pl-PL')).toBe('czekać');
    expect(lookalikeForm('ten pies', 'pl-PL')).toBe('pies');
  });
  it('drops accents only where they mark stress or are routinely left off', () => {
    expect(lookalikeForm('Habló', 'es-MX')).toBe('hablo');
    expect(lookalikeForm('Μιλάω', 'el-GR')).toBe('μιλαω');
    expect(lookalikeForm('Été', 'fr-FR')).toBe('ete');
    expect(lookalikeForm('dziękuję', 'pl-PL')).toBe('dziękuję');
    expect(lookalikeForm('schön', 'de-DE')).toBe('schön');
    expect(lookalikeForm('søster', 'nb-NO')).toBe('søster');
    expect(lookalikeForm('žena', undefined)).toBe('žena');
  });
  it('takes stress marks off a Russian word, but keeps й and ё', () => {
    expect(lookalikeForm('молоко́', 'ru-RU')).toBe('молоко');
    expect(lookalikeForm('мой', 'ru-RU')).toBe('мой');
    expect(lookalikeForm('ёлка', 'ru-RU')).toBe('ёлка');
  });
  it('needs most of the shorter word in common', () => {
    expect(wordsLookAlike('esperar', 'espero')).toBe(true);
    expect(wordsLookAlike('esperar', 'esperanza')).toBe(true);
    expect(wordsLookAlike('espero', 'esperanza')).toBe(true);
    expect(wordsLookAlike('hablar', 'hacer')).toBe(false);
    expect(wordsLookAlike('casa', 'cosa')).toBe(false);
  });
  it('links a short word to its inflections, not to every longer word built on it', () => {
    expect(wordsLookAlike('haus', 'haustür')).toBe(true);
    expect(wordsLookAlike('haus', 'hausaufgabe')).toBe(false);
    expect(wordsLookAlike('nach', 'nachricht')).toBe(false);
    expect(wordsLookAlike('über', 'übermorgen')).toBe(false);
    expect(wordsLookAlike('przy', 'przyjaciel')).toBe(false);
    expect(wordsLookAlike('casa', 'casamiento')).toBe(false);
  });
  it('keeps marked letters apart in a language where they are letters of their own', () => {
    expect(wordsLookAlike(lookalikeForm('dziękuję', 'pl-PL'), lookalikeForm('dzień', 'pl-PL'))).toBe(false);
  });
});

describe('lookalikeIndex', () => {
  it('links lookalike words of one language both ways', () => {
    const notes = [word('a', 'esperar'), word('b', 'la esperanza'), word('c', 'hablar')];
    const idx = lookalikeIndex(notes);
    expect([...idx.get('a')!]).toEqual(['b']);
    expect([...idx.get('b')!]).toEqual(['a']);
    expect(idx.has('c')).toBe(false);
  });
  it("links a word to one listed among another's forms, however different it looks", () => {
    const tener = word('t', 'tener', { Forms: 'present · yo: tengo' });
    const tengo = word('g', 'tengo');
    const ser = word('s', 'ser', { KeyForms: 'fui, era' });
    const fui = word('f', 'fui');
    const idx = lookalikeIndex([tener, tengo, ser, fui]);
    expect(idx.get('t')).toEqual(new Set(['g']));
    expect(idx.get('s')).toEqual(new Set(['f']));
  });
  it('links German words by their umlauts as written', () => {
    const de = (id: string, entry: string) => word(id, entry, { Language: 'german' }, '👅 Languages::Deutsch');
    const idx = lookalikeIndex([de('h', 'das Haus'), de('t', 'die Haustür'), de('a', 'die Hausaufgabe'), de('u', 'über'), de('m', 'übermorgen')]);
    expect(idx.get('h')).toEqual(new Set(['t']));
    expect(idx.has('u')).toBe(false);
  });
  it("does not link a word to its counting word or gender, which are other words", () => {
    const bike = word('m', 'motorcycle', { Classifier: 'คัน', Gender: 'f' });
    const kan = word('k', 'คัน');
    expect(lookalikeIndex([bike, kan]).size).toBe(0);
  });
  it('never links words of different languages, or notes of other note types', () => {
    const pl = { ...word('p', 'esperar'), fields: { ...word('p', 'esperar').fields, Language: 'polish' } };
    const generic: Note = { id: 'g', deck: ES, model: 'Basic', fields: { Front: 'esperar', Back: 'x' }, tags: [] };
    const idx = lookalikeIndex([word('a', 'esperar'), pl, generic]);
    expect(idx.size).toBe(0);
  });
});

describe('heldCards', () => {
  const notes = [word('a', 'esperar'), word('b', 'la esperanza'), word('c', 'hablar')];
  const index = lookalikeIndex(notes);
  const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
  const seen = (noteId: string, at: Date, how: SeenEvent['how'] = 'review'): SeenEvent => ({ noteId, at, how });
  const base = { deckOf, index, settings: new Map(), now: NOW, dayStartsAtHour: DAY_START };

  it("holds a New or Review card back the day a lookalike was seen, and lets it through tomorrow", () => {
    const cards = [card('b'), card('c')];
    const events = [seen('a', new Date(2026, 10, 11, 9))];
    expect(heldCards({ ...base, cards, events })).toEqual(new Set(['b:forward']));
    const tomorrow = new Date(2026, 10, 12, 9);
    expect(heldCards({ ...base, cards, events, now: tomorrow })).toEqual(new Set());
  });
  it('counts practice as seeing the word', () => {
    expect(heldCards({ ...base, cards: [card('b')], events: [seen('a', new Date(2026, 10, 11, 9), 'practice')] }).size).toBe(1);
  });
  it('keeps the window in study days: a 1 AM answer belongs to the day before', () => {
    const events = [seen('a', new Date(2026, 10, 11, 1))];
    expect(heldCards({ ...base, cards: [card('b')], events }).size).toBe(0);
  });
  it('holds for as many study days as the deck says', () => {
    const settings = new Map([['👅 Languages', { lookalikeDays: 2 }]]);
    const events = [seen('a', new Date(2026, 10, 10, 9))];
    expect(heldCards({ ...base, settings, cards: [card('b')], events }).size).toBe(1);
    expect(heldCards({ ...base, cards: [card('b')], events }).size).toBe(0);
  });
  it('never holds a learning card, a card answered since, or a deck that turned it off', () => {
    const events = [seen('a', new Date(2026, 10, 11, 9))];
    expect(heldCards({ ...base, cards: [card('b', { state: 1 })], events }).size).toBe(0);
    expect(heldCards({ ...base, cards: [card('b', review(new Date(2026, 10, 11, 10)))], events }).size).toBe(0);
    const off = new Map([[ES, { keepLookalikesApart: false }]]);
    expect(heldCards({ ...base, settings: off, cards: [card('b')], events }).size).toBe(0);
  });
});

describe('lookalikeSettings', () => {
  it('defaults to keeping lookalikes apart until tomorrow and offering to show sooner', () => {
    expect(lookalikeSettings(ES, new Map())).toEqual({ keepApart: true, days: 1, offerSooner: true });
  });
});

describe('seenEvents', () => {
  it("takes answers by their card's note, and practice as it is", () => {
    const events = seenEvents(
      [{ cardId: 'a:forward', rating: 3, reviewedAt: '2026-11-11T09:00:00.000Z', state: 2, due: '', stability: 1, difficulty: 1 },
        { cardId: 'gone:forward', rating: 3, reviewedAt: '2026-11-11T09:00:00.000Z', state: 2, due: '', stability: 1, difficulty: 1 }],
      new Map([['a:forward', 'a']]),
      [{ noteId: 'b', key: 'present · yo', correct: true, practicedAt: '2026-11-11T10:00:00.000Z' }],
    );
    expect(events.map((e) => [e.noteId, e.how])).toEqual([['a', 'review'], ['b', 'practice']]);
  });
});

describe('soonerOffer', () => {
  const notes = [word('a', 'esperar'), word('b', 'la esperanza')];
  const index = lookalikeIndex(notes);
  const base = { index, now: NOW, dayStartsAtHour: DAY_START };
  const yesterday = new Date(2026, 10, 10, 18);

  it('offers when a lookalike was seen since the card was last reviewed', () => {
    const c = card('b', review(new Date(2026, 9, 25)));
    expect(soonerOffer({ ...base, card: c, events: [{ noteId: 'a', at: yesterday, how: 'practice' }] })).toEqual({ noteId: 'a', at: yesterday, how: 'practice' });
  });
  it('does not for a lookalike seen before the last review, or long ago, or for a card not in review', () => {
    const events: SeenEvent[] = [{ noteId: 'a', at: yesterday, how: 'review' }];
    expect(soonerOffer({ ...base, card: card('b', review(new Date(2026, 10, 10, 20))), events })).toBeUndefined();
    expect(soonerOffer({ ...base, card: card('b', review(new Date(2026, 9, 1))), events: [{ noteId: 'a', at: new Date(2026, 10, 5), how: 'review' }] })).toBeUndefined();
    expect(soonerOffer({ ...base, card: card('b', { state: 1 }), events })).toBeUndefined();
  });
  it('does not for a lookalike its deck already kept it apart from, only one inside the hold', () => {
    const c = card('b', review(new Date(2026, 9, 25)));
    const seenYesterday: SeenEvent[] = [{ noteId: 'a', at: yesterday, how: 'review' }];
    expect(soonerOffer({ ...base, card: c, events: seenYesterday, heldDays: 1 })).toBeUndefined();
    expect(soonerOffer({ ...base, card: c, events: seenYesterday, heldDays: 2 })).toEqual(seenYesterday[0]);
    const seenToday: SeenEvent[] = [{ noteId: 'a', at: new Date(2026, 10, 11, 9), how: 'review' }];
    expect(soonerOffer({ ...base, card: c, events: seenToday, heldDays: 1 })).toEqual(seenToday[0]);
  });
});

describe('whenSeen', () => {
  it('names the study day', () => {
    expect(whenSeen(new Date(2026, 10, 11, 9), NOW, DAY_START)).toBe('earlier today');
    expect(whenSeen(new Date(2026, 10, 11, 2), NOW, DAY_START)).toBe('yesterday');
    expect(whenSeen(new Date(2026, 10, 9, 9), NOW, DAY_START)).toBe('2 days ago');
  });
});

describe('seenSince', () => {
  it('starts at the beginning of the study day two days before today', () => {
    expect(seenSince(NOW, DAY_START)).toEqual(new Date(2026, 10, 9, 4));
    expect(seenSince(new Date(2026, 10, 11, 1), DAY_START)).toEqual(new Date(2026, 10, 8, 4));
  });
});
