import { describe, expect, it } from 'vitest';
import type { QueuedNote } from '../../src/reader/api';
import { approvalDraft, bannerOf, counts, firstReady, needsChoice, queuedFor, quickAddDecks, reviewTarget } from '../../src/reader/noteQueue';
import { createNoteQueueStore } from '../../src/reader/noteQueueStore';

const note = (over: Partial<QueuedNote> = {}): QueuedNote => ({
  id: 1, language: 'fr', deck: 'Languages::Français', entry: 'ricane', meaning: '', state: 'ready', fields: {}, error: '', ...over,
});

describe('the queue', () => {
  const items = [note({ id: 1, state: 'failed' }), note({ id: 2 }), note({ id: 3, state: 'waiting' }), note({ id: 4 })];

  it('counts each state and finds the first ready word', () => {
    expect(counts(items)).toEqual({ ready: 2, waiting: 1, failed: 1 });
    expect(firstReady(items)?.id).toBe(2);
    expect(firstReady([note({ state: 'waiting' })])).toBeUndefined();
  });

  it("starts a note from the entry and what Claude wrote, in the word's own deck", () => {
    expect(reviewTarget(note({ fields: { Meaning: 'sniggers', Context: 'Il <b>ricane</b>.' } }))).toEqual({
      deck: 'Languages::Français',
      model: 'Omnilanguage',
      fields: { Entry: 'ricane', Meaning: 'sniggers', Context: 'Il <b>ricane</b>.' },
    });
  });

  it("leaves a noun's article off the Entry when its Gender gives it, and on when it doesn't", () => {
    const noun = (entry: string, language: string, gender: string) => reviewTarget(note({ entry, language: language as never, fields: { Gender: gender } })).fields.Entry;
    expect(noun('der Tisch', 'de', 'm')).toBe('Tisch');
    expect(noun("l'amertume", 'fr', 'f')).toBe('amertume');
    expect(noun('el agua', 'es', 'f')).toBe('el agua');
  });

  it("leaves å off a Norwegian verb's Entry, since the card puts it before a verb", () => {
    const entry = (word: string, language: string, part: string) => reviewTarget(note({ entry: word, language: language as never, fields: { PartOfSpeech: part } })).fields.Entry;
    expect(entry('å huske', 'nb', 'verb')).toBe('huske');
    expect(entry('å gå seg vill', 'nb', 'phrase')).toBe('å gå seg vill');
    expect(entry('huske', 'nb', 'verb')).toBe('huske');
  });

  it('tags the note with its part of speech', () => {
    expect(reviewTarget(note({ fields: { PartOfSpeech: 'verb' } })).tags).toEqual(['verb']);
    expect(reviewTarget(note()).tags).toBeUndefined();
  });

  it('never lets a written field replace the entry', () => {
    expect(reviewTarget(note({ fields: { Entry: 'other' } })).fields.Entry).toBe('other');
  });
});

describe('queuedFor', () => {
  it("finds a cram request's note by the text sent, a ready one first, and nothing for a word not queued", () => {
    const items = [note({ id: 1, entry: 'เนิน', state: 'waiting' }), note({ id: 2, entry: 'เขา', state: 'failed' }), note({ id: 3, entry: 'เขา' })];
    expect(queuedFor(items, 'เขา')?.id).toBe(3);
    expect(queuedFor(items, 'เนิน')?.state).toBe('waiting');
    expect(queuedFor(items, 'ภูเขา')).toBeUndefined();
  });
});

describe('approvalDraft', () => {
  const names = ['Entry', 'Meaning', 'Context', 'Audio'];

  it('saves what the editor would: stored fields in the note type\'s order, blanks filled in', () => {
    const draft = approvalDraft(note({ fields: { Meaning: 'sniggers', Context: 'Il ricane.\nElle aussi.' } }), names, []);
    expect(draft).toEqual({
      deck: 'Languages::Français',
      model: 'Omnilanguage',
      fields: { Entry: 'ricane', Meaning: 'sniggers', Context: 'Il ricane.<br>Elle aussi.', Audio: '' },
      tags: [],
    });
    expect(Object.keys(draft.fields)).toEqual(names);
  });

  it("drops a field the note type doesn't have", () => {
    expect(approvalDraft(note({ fields: { Meaning: 'sniggers', Mystery: 'x' } }), names, []).fields).not.toHaveProperty('Mystery');
  });

  it('tags the note with its part of speech and a running cram, once each', () => {
    const draft = approvalDraft(note({ fields: { PartOfSpeech: 'verb' } }), [...names, 'PartOfSpeech'], ['verb', 'cram::trip-2026-11-20']);
    expect(draft.tags).toEqual(['verb', 'cram::trip-2026-11-20']);
  });
});

describe('bannerOf', () => {
  const queue = (...items: QueuedNote[]) => ({ available: true, items });

  it('says nothing for an empty or unloaded queue', () => {
    expect(bannerOf(null)).toBeNull();
    expect(bannerOf(queue())).toBeNull();
  });

  it('offers a review as soon as one word is ready, whatever else is waiting', () => {
    expect(bannerOf(queue(note({ id: 1 }), note({ id: 2, state: 'waiting' })))).toEqual({
      tone: 'ready', message: '1 new note written by Claude', hint: 'Tap to review and add',
    });
    expect(bannerOf(queue(note({ id: 1 }), note({ id: 2 })))?.message).toBe('2 new notes written by Claude');
  });

  it('says it is filling in while nothing is ready yet', () => {
    expect(bannerOf(queue(note({ state: 'waiting' }), note({ id: 2, state: 'failed' })))).toMatchObject({ tone: 'waiting', message: 'Filling in 1 note' });
  });

  it('says what failed when that is all there is', () => {
    expect(bannerOf(queue(note({ state: 'failed' })))).toMatchObject({ tone: 'failed', message: "Couldn't fill in 1 note" });
  });

  it('counts the words held offline, even before the queue has loaded', () => {
    expect(bannerOf(null, { waiting: 2, refused: 0 })).toEqual({
      tone: 'waiting', message: '2 words waiting for Claude', hint: "They'll be sent when you're back online",
    });
    expect(bannerOf(queue(note({ state: 'waiting' })), { waiting: 2, refused: 1 })).toMatchObject({ tone: 'failed', message: "Couldn't send 1 word to Claude" });
    expect(bannerOf(null, { waiting: 1, refused: 0 }, true)?.hint).toBe("They'll be sent once your server answers");
    // A ready note still comes first: it's the one thing to do now.
    expect(bannerOf(queue(note({ id: 1 })), { waiting: 2, refused: 0 })?.tone).toBe('ready');
  });
});

describe('the store', () => {
  it('tells listeners about each change and forgets on clear', () => {
    const store = createNoteQueueStore();
    let calls = 0;
    const off = store.subscribe(() => { calls++; });
    store.set({ queue: { available: true, items: [note()] }, error: null });
    expect(store.get().queue?.items).toHaveLength(1);
    store.clear();
    expect(store.get()).toEqual({ queue: null, error: null });
    off();
    store.set({ queue: null, error: 'x' });
    expect(calls).toBe(2);
  });
});

describe('quickAddDecks', () => {
  const decks = { th: 'ภาษาไทย', fr: 'Languages::Français', pl: 'Polski' };

  it('offers only the languages whose deck is in the collection', () => {
    expect(quickAddDecks(decks, ['Polski', 'Languages', 'Languages::Français', 'Trivia'])).toEqual([
      { deck: 'Languages::Français', language: 'fr' },
      { deck: 'Polski', language: 'pl' },
    ]);
  });

  it('offers nothing when no language deck is in the collection, or the settings have no decks', () => {
    expect(quickAddDecks(decks, ['Trivia'])).toEqual([]);
    expect(quickAddDecks(undefined, ['Polski'])).toEqual([]);
  });

  it('puts the language being read first', () => {
    expect(quickAddDecks(decks, ['Polski', 'Languages::Français', 'ภาษาไทย'], 'pl').map((d) => d.language)).toEqual(['pl', 'th', 'fr']);
  });
});

describe('a word typed the way it sounds', () => {
  const typed = (over: Partial<QueuedNote>) => note({ language: 'ru', deck: 'Languages::Русский', entry: 'ogurets', fields: { Meaning: 'cucumber' }, ...over });

  it('opens on how the word is really written, saying what was typed', () => {
    expect(reviewTarget(typed({ spelling: 'огурец' }))).toEqual({
      deck: 'Languages::Русский',
      model: 'Omnilanguage',
      fields: { Entry: 'огурец', Meaning: 'cucumber' },
      fieldNotes: { Entry: 'You typed ogurets.' },
    });
  });

  it('asks which word was meant when it could be more than one, the filled-in one first', () => {
    const bit = typed({ entry: 'bit', spelling: 'быть', fields: { Meaning: 'to be' }, alternatives: [{ spelling: 'бить', meaning: 'to beat' }] });
    expect(needsChoice(bit)).toBe(true);
    expect(reviewTarget(bit).choice).toEqual({
      typed: 'bit',
      words: [{ entry: 'быть', meaning: 'to be' }, { entry: 'бить', meaning: 'to beat' }],
    });
    expect(reviewTarget(bit).fields.Entry).toBe('быть');
  });

  it('has nothing to choose or say for a word typed as it is written, or from an older server', () => {
    expect(needsChoice(note())).toBe(false);
    expect(needsChoice(note({ alternatives: [] }))).toBe(false);
    expect(needsChoice(note({ state: 'failed', alternatives: [{ spelling: 'x', meaning: 'y' }] }))).toBe(false);
    expect(reviewTarget(note({ spelling: '' }))).not.toHaveProperty('fieldNotes');
  });

  it('is approved under its spelling', () => {
    expect(approvalDraft(typed({ spelling: 'огурец' }), ['Entry', 'Meaning'], []).fields).toEqual({ Entry: 'огурец', Meaning: 'cucumber' });
  });
});
