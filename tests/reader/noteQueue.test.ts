import { describe, expect, it } from 'vitest';
import type { QueuedNote } from '../../src/reader/api';
import { bannerOf, counts, firstReady, parseWords, reviewTarget } from '../../src/reader/noteQueue';
import { createNoteQueueStore } from '../../src/reader/noteQueueStore';

const note = (over: Partial<QueuedNote> = {}): QueuedNote => ({
  id: 1, language: 'fr', deck: 'Languages::Français', entry: 'ricane', meaning: '', state: 'ready', fields: {}, error: '', ...over,
});

describe('parseWords', () => {
  it('takes one word or phrase per line and skips blank lines', () => {
    expect(parseWords('ricane\n\n  se méfier  \n').entries).toEqual([
      { entry: 'ricane', meaning: '' },
      { entry: 'se méfier', meaning: '' },
    ]);
  });

  it("takes the owner's meaning after a spaced dash or a tab", () => {
    expect(parseWords('bouder - to sulk\nricane – sniggers\nse méfier — to distrust\nodpuścić\tto let go').entries).toEqual([
      { entry: 'bouder', meaning: 'to sulk' },
      { entry: 'ricane', meaning: 'sniggers' },
      { entry: 'se méfier', meaning: 'to distrust' },
      { entry: 'odpuścić', meaning: 'to let go' },
    ]);
  });

  it('keeps a hyphen inside a word', () => {
    expect(parseWords('peut-être').entries).toEqual([{ entry: 'peut-être', meaning: '' }]);
  });

  it('keeps a dash inside the meaning', () => {
    expect(parseWords('bouder - to sulk - pout').entries[0].meaning).toBe('to sulk - pout');
  });

  it('counts a repeated line instead of dropping it silently', () => {
    const { entries, repeated } = parseWords('ricane\nbouder\nricane - sniggers\n');
    expect(entries.map((e) => e.entry)).toEqual(['ricane', 'bouder']);
    expect(repeated).toBe(1);
  });

  it('reads Windows line endings and an empty box', () => {
    expect(parseWords('a\r\nb').entries).toHaveLength(2);
    expect(parseWords('  \n ')).toEqual({ entries: [], repeated: 0 });
  });
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

  it('never lets a written field replace the entry', () => {
    expect(reviewTarget(note({ fields: { Entry: 'other' } })).fields.Entry).toBe('other');
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
      tone: 'ready', message: '1 note ready to review', hint: 'Tap to start',
    });
    expect(bannerOf(queue(note({ id: 1 }), note({ id: 2 })))?.message).toBe('2 notes ready to review');
  });

  it('says it is filling in while nothing is ready yet', () => {
    expect(bannerOf(queue(note({ state: 'waiting' }), note({ id: 2, state: 'failed' })))).toMatchObject({ tone: 'waiting', message: 'Filling in 1 note' });
  });

  it('says what failed when that is all there is', () => {
    expect(bannerOf(queue(note({ state: 'failed' })))).toMatchObject({ tone: 'failed', message: "Couldn't fill in 1 note" });
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
