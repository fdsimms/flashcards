import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { review } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;

describe('repo', () => {
  it('has swipe to answer off until it is turned on', async () => {
    const repo = new MemoryRepo();
    expect(await repo.swipeToRate()).toBe(false);
    await repo.saveSwipeToRate(true);
    expect(await repo.swipeToRate()).toBe(true);
  });

  it('shows a card\'s romanization and translation only on a tap until the setting is turned on', async () => {
    const repo = new MemoryRepo();
    expect(await repo.showCardHints()).toBe(false);
    await repo.saveShowCardHints(true);
    expect(await repo.showCardHints()).toBe(true);
  });

  it('draws Thai at Large until another size is chosen', async () => {
    const repo = new MemoryRepo();
    expect(await repo.thaiTextSize()).toBe('large');
    await repo.saveThaiTextSize('largest');
    expect(await repo.thaiTextSize()).toBe('largest');
  });

  it('keeps the voices chosen for each language', async () => {
    const repo = new MemoryRepo();
    expect(await repo.voiceSettings()).toEqual({});
    await repo.saveVoiceSettings({ th: { voice: 'com.apple.voice.enhanced.th-TH.Narisa', voiceName: 'Narisa', rate: 0.8 } });
    expect(await repo.voiceSettings()).toEqual({ th: { voice: 'com.apple.voice.enhanced.th-TH.Narisa', voiceName: 'Narisa', rate: 0.8 } });
  });

  it('takes an answer back with deleteReview', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const id = await repo.addReview({ cardId: card.id, ...review(card.sched, 3, NOW).log });
    await repo.deleteReview(id);
    expect(await repo.listReviews(new Date(0))).toEqual([]);
  });

  it('lists the answers logged from a time on, oldest first', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const at = (h: number) => new Date(2026, 10, 11, h);
    for (const h of [11, 9, 7]) await repo.addReview({ cardId: card.id, ...review(card.sched, 3, at(h)).log });
    expect((await repo.listReviews(at(8))).map((r) => new Date(r.reviewedAt).getHours())).toEqual([9, 11]);
  });

  it('lists the answers of cards that have had a reason chosen, with the reason, and drops one taken back', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    const other = { ...card, id: 'other:forward' };
    await repo.upsertNotesAndCards([note], [card, other]);
    const log = review(card.sched, 1, NOW).log;
    await repo.addReview({ cardId: card.id, ...log, miss: 'tone' });
    await repo.addReview({ cardId: other.id, ...log });
    const undone = await repo.addReview({ cardId: card.id, ...log, rating: 3 });
    await repo.addReview({ cardId: card.id, ...log, rating: 3 });
    await repo.deleteReview(undone);
    expect(await repo.listMissAnswers()).toEqual([{ cardId: card.id, miss: 'tone' }, { cardId: card.id }]);
  });

  it('lists a deck with its subdecks, not decks that merely share a prefix', async () => {
    const repo = new MemoryRepo();
    const notes = [['a', 'Polski'], ['b', 'Polski::Odmiana'], ['c', 'Polski Extra']].map(([id, deck]) => ({ ...omniNote(), id, deck }));
    await repo.upsertNotesAndCards(notes, notes.flatMap((n) => makeCards(n, NOW)));
    expect((await repo.listCards('Polski')).map((c) => c.noteId).sort()).toEqual(['a', 'b']);
  });

  it('renames a deck and those under it everywhere it is named, and forgets a deleted one', async () => {
    const repo = new MemoryRepo();
    const notes = [['a', 'Polski'], ['b', 'Polski::Odmiana'], ['c', 'Polski Extra']].map(([id, deck]) => ({ ...omniNote(), id, deck }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    cards[0] = { ...cards[0], deck: 'Polski::Odmiana', filteredDeck: 'Polski::Filtered' };
    await repo.upsertNotesAndCards(notes, cards);
    for (const d of ['Polski', 'Polski::Odmiana', 'Polski Extra']) await repo.saveDeckSettings(d, { gateCap: d.length });
    await repo.saveDeckParams(new Map([['Polski::Odmiana', { weights: [], desiredRetention: 0.9, maxInterval: 365 }]]));
    await repo.renameDeck('Polski', 'Język::Polski');
    expect((await repo.listNotes()).map((n) => n.deck)).toEqual(['Język::Polski', 'Język::Polski::Odmiana', 'Polski Extra']);
    expect((await repo.listCards())[0]).toMatchObject({ deck: 'Język::Polski::Odmiana', filteredDeck: 'Język::Polski::Filtered' });
    expect([...(await repo.listDeckSettings()).keys()].sort()).toEqual(['Język::Polski', 'Język::Polski::Odmiana', 'Polski Extra']);
    expect([...(await repo.listDeckParams()).keys()]).toEqual(['Język::Polski::Odmiana']);
    await repo.forgetDeck('Język::Polski');
    expect([...(await repo.listDeckSettings()).keys()]).toEqual(['Polski Extra']);
    expect((await repo.listDeckParams()).size).toBe(0);
  });

  it('deletes notes with their cards, and single cards, with their answers', async () => {
    const repo = new MemoryRepo();
    const notes = [['a', 'Polski'], ['b', 'Polski']].map(([id, deck]) => ({ ...omniNote(), id, deck }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    await repo.upsertNotesAndCards(notes, cards);
    const kept = cards.filter((c) => c.noteId === 'b');
    for (const c of cards) await repo.addReview({ cardId: c.id, ...review(c.sched, 3, NOW).log });
    await repo.deleteNotesAndCards(['a'], [kept[0].id]);
    expect((await repo.listNotes()).map((n) => n.id)).toEqual(['b']);
    expect((await repo.listCards()).map((c) => c.id)).toEqual(kept.slice(1).map((c) => c.id));
    expect((await repo.listReviews(new Date(0))).map((r) => r.cardId)).toEqual(kept.slice(1).map((c) => c.id));
  });

  it('never resets a studied card on re-import', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const studied = { ...card, sched: review(card.sched, 3, NOW).sched };
    await repo.saveCard(studied);
    await repo.upsertNotesAndCards([note], makeCards(note, NOW));
    expect((await repo.listCards())[0].sched.reps).toBe(1);
  });

  it('retires cards a note stops generating, and brings them back with their history', async () => {
    const repo = new MemoryRepo();
    const withReverse = omniNote({ GenerateReverse: 'y' });
    const cards = makeCards(withReverse, NOW);
    await repo.upsertNotesAndCards([withReverse], cards);
    const rev = cards.find((c) => c.kind === 'reverse')!;
    await repo.saveCard({ ...rev, sched: review(rev.sched, 3, NOW).sched });

    const without = omniNote();
    await repo.upsertNotesAndCards([without], makeCards(without, NOW));
    expect((await repo.listCards()).find((c) => c.kind === 'reverse')!.retired).toBe(true);

    await repo.upsertNotesAndCards([withReverse], makeCards(withReverse, NOW));
    const back = (await repo.listCards()).find((c) => c.kind === 'reverse')!;
    expect(back.retired).toBe(false);
    expect(back.sched.reps).toBe(1);
  });

  it('keeps deck settings and note types for those a later import leaves out', async () => {
    const repo = new MemoryRepo();
    const p = (r: number) => ({ weights: [], desiredRetention: r, maxInterval: 36500 });
    await repo.saveDeckParams(new Map([['A', p(0.9)], ['B', p(0.8)]]));
    await repo.saveDeckParams(new Map([['A', p(0.85)]]));
    const all = await repo.listDeckParams();
    expect(all.get('A')!.desiredRetention).toBe(0.85);
    expect(all.get('B')!.desiredRetention).toBe(0.8);
    const type = (name: string) => ({ name, kind: 'normal' as const, fields: [], css: '', templates: [] });
    await repo.saveNoteTypes([type('Basic'), type('Geo')]);
    await repo.saveNoteTypes([{ ...type('Basic'), css: '.card {}' }]);
    const types = await repo.listNoteTypes();
    expect([...types.keys()].sort()).toEqual(['Basic', 'Geo']);
    expect(types.get('Basic')!.css).toBe('.card {}');
  });

  it("takes a whole Anki collection as the record: overwrites studied cards, retires Anki cards it dropped", async () => {
    const repo = new MemoryRepo();
    const anki = { ...omniNote(), id: 'a' };
    const local = { ...omniNote(), id: 'local' };
    const [ankiCard] = makeCards(anki, NOW).map((c) => ({ ...c, ankiId: '1001' }));
    const [gone] = makeCards({ ...omniNote(), id: 'gone' }, NOW).map((c) => ({ ...c, ankiId: '1002' }));
    const [localCard] = makeCards(local, NOW);
    await repo.upsertNotesAndCards([anki, local], [ankiCard, gone, localCard]);
    await repo.saveCard({ ...ankiCard, sched: review(ankiCard.sched, 3, NOW).sched }); // studied here

    const fromAnki = { ...ankiCard, sched: { ...ankiCard.sched, reps: 7 } };
    await repo.applyAnkiCollection([anki], [fromAnki]);
    const cards = new Map((await repo.listCards()).map((c) => [c.id, c]));
    expect(cards.get(ankiCard.id)!.sched.reps).toBe(7);
    expect(cards.get(gone.id)!.retired).toBe(true);
    expect(cards.get(localCard.id)!.retired).toBe(false);
  });

  it("keeps a card's Anki id when an import without one (a TSV) comes in, as the SQLite repo does", async () => {
    const repo = new MemoryRepo();
    const a = { ...omniNote(), id: 'a' };
    const b = { ...omniNote(), id: 'b' };
    const [fresh] = makeCards(a, NOW).map((c) => ({ ...c, ankiId: '2000' }));
    const [studied] = makeCards(b, NOW).map((c) => ({ ...c, ankiId: '2001' }));
    await repo.upsertNotesAndCards([a, b], [fresh, studied]);
    await repo.saveCard({ ...studied, sched: review(studied.sched, 3, NOW).sched });
    await repo.upsertNotesAndCards([a, b], [...makeCards(a, NOW), ...makeCards(b, NOW)]);
    const cards = new Map((await repo.listCards()).map((c) => [c.id, c]));
    expect(cards.get(fresh.id)!.ankiId).toBe('2000');
    expect(cards.get(studied.id)!.ankiId).toBe('2001');
  });
  it('keeps forms practice, lists it from a time on, and deletes it with its note', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    await repo.upsertNotesAndCards([note], makeCards(note, NOW));
    await repo.addPractice({ noteId: note.id, key: 'present · yo', correct: true, practicedAt: new Date(2026, 10, 11, 9).toISOString() });
    await repo.addPractice({ noteId: note.id, key: 'present · tú', correct: false, practicedAt: new Date(2026, 10, 10, 9).toISOString(), given: 'tu' });
    expect((await repo.listPractice()).map((p) => p.key)).toEqual(['present · tú', 'present · yo']);
    expect((await repo.listPractice())[0].given).toBe('tu');
    expect((await repo.listPractice(new Date(2026, 10, 11))).map((p) => p.key)).toEqual(['present · yo']);
    await repo.deleteNote(note.id);
    expect(await repo.listPractice()).toEqual([]);
  });
  it("keeps grammar drills' answers in the order they were given, and Not yet dates", async () => {
    const repo = new MemoryRepo();
    const answer = (correct: boolean, d: number) => ({ pointId: 'es.preterite', drillId: 'd1', kind: 'gap' as const, correct, answeredAt: new Date(2026, 10, d, 9).toISOString() });
    await repo.addGrammarAnswer(answer(true, 11));
    await repo.addGrammarAnswer(answer(false, 10));
    expect((await repo.listGrammarAnswers()).map((a) => a.correct)).toEqual([false, true]);
    await repo.saveGrammarHintsDismissed({ 'es.preterite': '2026-11-11T09:00' });
    expect(await repo.grammarHintsDismissed()).toEqual({ 'es.preterite': '2026-11-11T09:00' });
  });
});
