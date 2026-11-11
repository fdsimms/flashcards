import { describe, expect, it } from 'vitest';
import { cardKindsFor, makeCards, renderCard } from '../src/core/cards';
import { buildQueue, nextCard } from '../src/core/queue';
import { previewIntervals, review } from '../src/core/scheduler';
import { importAnkiJson } from '../src/import/ankiJson';
import { omnilanguageFieldNames } from '../src/import/models';
import { importTsv, parseDelimited } from '../src/import/tsv';
import { MemoryRepo, summarizeDecks } from '../src/db/repo';
import type { Note } from '../src/core/types';

const NOW = new Date('2026-11-11T12:00:00Z');

function omniNote(over: Record<string, string> = {}): Note {
  const fields: Record<string, string> = Object.fromEntries(omnilanguageFieldNames.map((n) => [n, '']));
  Object.assign(fields, { Entry: 'หนังสือ', Meaning: 'book', Language: 'Thai', Transliteration: 'nǎng-sǔue' }, over);
  return { id: 'n1', deck: '👅 Languages::🐘 ภาษาไทย', model: 'Omnilanguage', fields, tags: ['noun'] };
}

describe('cards', () => {
  it('gates reverse/audio cards on the Generate* fields', () => {
    expect(cardKindsFor(omniNote())).toEqual(['forward']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y' }))).toEqual(['forward', 'reverse']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y', GenerateAudioCard: 'y' }))).toEqual(['forward', 'reverse', 'audio']);
  });
  it('renders forward front as the entry and speaks it in the right language', () => {
    const r = renderCard(omniNote(), 'forward');
    expect(r.front.blocks[0].text).toBe('หนังสือ');
    expect(r.front.speak).toBe('หนังสือ');
    expect(r.speechLang).toBe('th-TH');
    expect(r.back.blocks.map((b) => b.text)).toContain('book');
  });
  it('strips HTML and sound tags', () => {
    const r = renderCard(omniNote({ Meaning: 'a <b>book</b><br>(noun) [sound:x.mp3]' }), 'forward');
    expect(r.back.blocks.find((b) => b.text.startsWith('a book'))?.text).toBe('a book\n(noun)');
  });
  it('renders plain Front/Back notes for trivia', () => {
    const note: Note = { id: 't', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru?', Back: 'Lima' }, tags: [] };
    const r = renderCard(note, 'forward');
    expect(r.front.blocks[0].text).toBe('Capital of Peru?');
    expect(r.back.blocks[0].text).toBe('Lima');
  });
});

describe('scheduler', () => {
  it('moves a new card forward and spaces Good further than Again', () => {
    const [card] = makeCards(omniNote(), NOW);
    const good = review(card.sched, 3, NOW);
    const again = review(card.sched, 1, NOW);
    expect(good.sched.reps).toBe(1);
    expect(new Date(good.sched.due).getTime()).toBeGreaterThan(new Date(again.sched.due).getTime());
    expect(good.log.rating).toBe(3);
    const preview = previewIntervals(card.sched, NOW);
    expect(Object.keys(preview)).toHaveLength(4);
  });
});

describe('queue', () => {
  it('limits new cards and orders due cards by overdue-ness', () => {
    const notes = [1, 2, 3, 4].map((i) => ({ ...omniNote(), id: `n${i}` }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    cards[0].sched = review(cards[0].sched, 3, new Date('2026-11-01T00:00:00Z')).sched;
    cards[1].sched = review(cards[1].sched, 3, new Date('2026-10-01T00:00:00Z')).sched;
    const q = buildQueue(cards, { newPerDay: 1, now: new Date('2027-01-01T00:00:00Z') });
    expect(q.due.map((c) => c.id)).toEqual([cards[1].id, cards[0].id]);
    expect(q.fresh).toHaveLength(1);
    expect(nextCard(q)?.id).toBe(cards[1].id);
  });
  it('respects new cards already introduced today', () => {
    const cards = makeCards(omniNote(), NOW);
    expect(buildQueue(cards, { newPerDay: 5, newIntroducedToday: 5, now: NOW }).fresh).toHaveLength(0);
  });
});

describe('TSV import', () => {
  it('parses quoted multi-line fields', () => {
    expect(parseDelimited('a\t"b\nc"\td\n', '\t')).toEqual([['a', 'b\nc', 'd']]);
  });
  it('imports an Omnilanguage TSV with metadata headers and tags column', () => {
    const row = omnilanguageFieldNames.map((n) => ({ Entry: 'Haus', Meaning: 'house', GenerateReverse: 'y', Language: 'German' } as Record<string, string>)[n] ?? '');
    const text = ['#separator:tab', '#html:true', '#notetype:Omnilanguage', '#deck:👅 Languages::🥨 Deutsch', '#tags column:28', [...row, 'noun a1'].join('\t')].join('\n');
    const res = importTsv(text, { now: NOW });
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields.Entry).toBe('Haus');
    expect(res.notes[0].tags).toEqual(['noun', 'a1']);
    expect(res.notes[0].deck).toBe('👅 Languages::🥨 Deutsch');
    expect(res.cards.map((c) => c.kind)).toEqual(['forward', 'reverse']);
  });
  it('uses #columns when present and skips blank rows', () => {
    const text = '#separator:tab\n#columns:Front\tBack\tTags\n#tags column:3\n#deck:Trivia\nQ1\tA1\tgeo\n\n';
    const res = importTsv(text);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields).toEqual({ Front: 'Q1', Back: 'A1' });
    expect(res.notes[0].tags).toEqual(['geo']);
  });
});

describe('Anki JSON import', () => {
  const created = Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000);
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
});

describe('repo', () => {
  it('summarizes decks and records new-card introductions', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const s = summarizeDecks(await repo.listNotes(), await repo.listCards(), 20, NOW);
    expect(s).toEqual([{ deck: note.deck, due: 0, fresh: 1, total: 1 }]);
    const r = review(cards[0].sched, 3, NOW);
    await repo.addReview({ cardId: cards[0].id, ...r.log });
    expect(await repo.newIntroducedToday(note.deck, NOW)).toBe(1);
  });
});
