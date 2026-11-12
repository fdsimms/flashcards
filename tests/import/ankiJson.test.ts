import { describe, expect, it } from 'vitest';
import { ankiDueDate, deckParamsFromPresets, importAnkiJson } from '../../src/import/ankiJson';
import { omnilanguageFieldNames } from '../../src/import/models';
import { NOW } from '../support/fixtures';

describe('Anki JSON import', () => {
  const created = Math.floor(new Date(2025, 0, 1, 4).getTime() / 1000);
  const noteInfo = (id: number, over: Record<string, string> = {}) => ({
    noteId: id,
    modelName: 'Omnilanguage',
    tags: ['verb'],
    fields: Object.fromEntries(
      omnilanguageFieldNames.map((n, i) => [n, { value: ({ Entry: 'gehen', Meaning: 'to go', GenerateReverse: 'y', ...over } as Record<string, string>)[n] ?? '', order: i }]),
    ),
  });

  it('carries over interval, ease, due date and suspension', () => {
    const res = importAnkiJson({
      collectionCreated: created,
      notes: [noteInfo(1)],
      cards: [
        { cardId: 10, note: 1, deckName: 'Deutsch', ord: 0, type: 2, queue: 2, due: 400, interval: 30, factor: 2500, reps: 8, lapses: 1 },
        { cardId: 11, note: 1, deckName: 'Deutsch', ord: 1, type: 0, queue: -1 },
      ],
    }, { now: NOW });
    const fwd = res.cards.find((c) => c.kind === 'forward')!;
    const rev = res.cards.find((c) => c.kind === 'reverse')!;
    expect(fwd.sched.state).toBe(2);
    expect(fwd.sched.stability).toBe(30);
    expect(fwd.sched.difficulty).toBe(5);
    expect(fwd.sched.lapses).toBe(1);
    expect(fwd.sched.due).toBe(new Date((created + 400 * 86400) * 1000).toISOString());
    expect(rev.suspended).toBe(true);
    expect(res.notes[0].deck).toBe('Deutsch');
  });
  it('prefers a real FSRS memory state and warns when collectionCreated is missing', () => {
    const res = importAnkiJson({
      notes: [noteInfo(2)],
      cards: [{ cardId: 20, note: 2, deckName: 'D', ord: 0, type: 2, due: 5, interval: 10, memoryState: { stability: 42.5, difficulty: 6.1 } }],
    }, { now: NOW });
    expect(res.cards[0].sched.stability).toBe(42.5);
    expect(res.cards[0].sched.difficulty).toBe(6.1);
    expect(res.warnings.join(' ')).toMatch(/collectionCreated/);
  });

  it('reads each deck\'s FSRS settings from AnkiMCP get_fsrs_params output', () => {
    const res = importAnkiJson({
      notes: [], cards: [],
      fsrsParams: { presets: [
        { preset_name: 'Tier 1', fsrs_weights: [0.1, 0.2], desired_retention: 0.82, max_interval: 36500, decks: ['Languages::Español', 'Languages::Français'] },
        { preset_name: 'Unused', fsrs_weights: [], desired_retention: 0.9, max_interval: 36500, decks: [] },
      ] },
    }, { now: NOW });
    expect([...res.deckParams!.keys()]).toEqual(['Languages::Español', 'Languages::Français']);
    expect(res.deckParams!.get('Languages::Español')).toEqual({ weights: [0.1, 0.2], desiredRetention: 0.82, maxInterval: 36500 });
  });
  it('defaults a preset with no weights or retention', () => {
    expect(deckParamsFromPresets([{ decks: ['D'] }]).get('D')).toEqual({ weights: [], desiredRetention: 0.9, maxInterval: 36500 });
  });

  it('maps Anki ordinals to Omnilanguage templates whichever cards a note generates', () => {
    // Only the audio card on: Anki's ord 2 is still the audio card.
    const res = importAnkiJson({
      collectionCreated: created,
      notes: [noteInfo(3, { GenerateReverse: '', GenerateAudioCard: 'y', SuppressFrontCard: 'y' })],
      cards: [{ cardId: 30, note: 3, deckName: 'Thai', ord: 2, type: 2, queue: 2, due: 400, interval: 12 }],
    }, { now: NOW });
    expect(res.cards.map((c) => c.kind)).toEqual(['audio']);
    expect(res.cards[0].sched.state).toBe(2);
    expect(res.warnings).toEqual([]);
  });
  it('reads a learning card\'s due as a timestamp and a review card\'s as a day number', () => {
    const at = Math.floor(new Date(2026, 10, 11, 12, 10).getTime() / 1000);
    expect(ankiDueDate({ cardId: 1, note: 1, deckName: 'D', type: 1, queue: 1, due: at }, created, NOW).getTime()).toBe(at * 1000);
    expect(ankiDueDate({ cardId: 1, note: 1, deckName: 'D', type: 1, queue: 3, due: 10 }, created, NOW).getTime()).toBe((created + 10 * 86400) * 1000);
  });
  it('uses the real last-review time when the export has it', () => {
    const lrt = Math.floor(new Date(2026, 10, 1, 9).getTime() / 1000);
    const res = importAnkiJson({
      collectionCreated: created, notes: [noteInfo(4)],
      cards: [{ cardId: 40, note: 4, deckName: 'D', ord: 0, type: 2, queue: 2, due: 680, interval: 20, lastReview: lrt }],
    }, { now: NOW });
    expect(res.cards.find((c) => c.kind === 'forward')!.sched.lastReview).toBe(new Date(lrt * 1000).toISOString());
  });
  it('sums skipped cards per note type instead of one warning per card', () => {
    const basic = (id: number) => ({ noteId: id, modelName: 'Ultimate Geography', fields: { Country: 'Peru', Capital: 'Lima' } });
    const res = importAnkiJson({
      collectionCreated: created, notes: [basic(5), basic(6)],
      cards: [5, 6].flatMap((n) => [0, 1, 2].map((ord) => ({ cardId: n * 10 + ord, note: n, deckName: 'Geo', ord, type: 0 }))),
    }, { now: NOW });
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/^4 cards of note type "Ultimate Geography" were skipped: its card templates weren't in the file/);
  });
  it("keeps a card in another deck than its note's first card in its own deck", () => {
    const res = importAnkiJson({
      notes: [{ noteId: 9, modelName: 'Basic (and reversed card)', fields: { Front: 'kot', Back: 'cat' } }],
      cards: [
        { cardId: 2, note: 9, deckName: 'Polski::Extra', ord: 1, type: 0, due: 7 },
        { cardId: 1, note: 9, deckName: 'Polski', ord: 0, type: 0, due: 6 },
      ],
      noteTypes: [{
        name: 'Basic (and reversed card)', kind: 'normal', fields: ['Front', 'Back'], css: '',
        templates: [0, 1].map((ord) => ({ ord, name: `Card ${ord + 1}`, front: '{{Front}}', back: '{{Back}}' })),
      }],
    }, { now: NOW });
    expect(res.notes[0].deck).toBe('Polski');
    const byAnki = new Map(res.cards.map((c) => [c.ankiId, c]));
    expect(byAnki.get('1')).toMatchObject({ position: 6 });
    expect(byAnki.get('1')!.deck).toBeUndefined();
    expect(byAnki.get('2')).toMatchObject({ deck: 'Polski::Extra', position: 7 });
  });

  it("places a today-only limit on its study day, counted from the collection's creation", () => {
    const created = new Date(2026, 0, 1, 4, 0).getTime() / 1000;
    const res = importAnkiJson({
      notes: [], cards: [], collectionCreated: created,
      deckConfigs: { Thai: { newPerDay: 10, reviewsPerDay: 100, newLimitToday: { limit: 25, today: 31 } } },
    }, { now: NOW });
    expect(res.deckParams!.get('Thai')!.newLimitToday).toEqual({ limit: 25, day: '2026-02-01' });
  });

  it('takes per-deck limits and FSRS settings from deckConfigs over fsrsParams', () => {
    const res = importAnkiJson({
      notes: [], cards: [],
      deckConfigs: { Thai: { newPerDay: 10, reviewsPerDay: 150, desiredRetention: 0.85, weights: [0.1], maxInterval: 3650, buryNew: true } },
      fsrsParams: { presets: [{ decks: ['Thai'], desired_retention: 0.9 }] },
    }, { now: NOW });
    expect(res.deckParams!.get('Thai')).toEqual({
      weights: [0.1], desiredRetention: 0.85, maxInterval: 3650, newPerDay: 10, reviewsPerDay: 150,
      bury: { new: true, reviews: false, interdayLearning: false },
    });
  });

  it('makes exactly the cards Anki has when the note type comes with its templates', () => {
    const geo = { noteId: 7, modelName: 'Ultimate Geography', fields: { Country: 'Peru', Capital: 'Lima', Flag: '' } };
    const noteTypes = [{
      name: 'Ultimate Geography', kind: 'normal' as const, fields: ['Country', 'Capital', 'Flag'], css: '',
      templates: [0, 1, 2].map((ord) => ({ ord, name: `Card ${ord + 1}`, front: '{{Country}}', back: '{{Capital}}' })),
    }];
    const res = importAnkiJson({
      collectionCreated: created, noteTypes, notes: [geo],
      cards: [
        { cardId: 70, note: 7, deckName: 'Geo', ord: 0, type: 2, queue: 2, due: 400, interval: 9 },
        { cardId: 72, note: 7, deckName: 'Geo', ord: 2, type: 0 },
      ],
    }, { now: NOW });
    expect(res.cards.map((c) => [c.id, c.sched.state])).toEqual([['7:t0', 2], ['7:t2', 0]]);
    expect(res.warnings).toEqual([]);
    expect(res.noteTypes).toBe(noteTypes);
  });

});
