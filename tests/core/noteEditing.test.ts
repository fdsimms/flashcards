import { describe, expect, it } from 'vitest';
import { deckChipRows, duplicateOf, editTextToField, fieldToEditText, matchesNoteFilter, notePreview, parseTags, searchNotes } from '../../src/core/noteEditing';
import type { Card, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const basic = (id: string, front: string, back: string, deck = 'Trivia', tags: string[] = []): Note =>
  ({ id, deck, model: 'Basic', fields: { Front: front, Back: back }, tags });

describe('editing a note', () => {
  it('shows line breaks as new lines, keeps other HTML as it is, and stores new lines back as <br>', () => {
    expect(fieldToEditText('one<br>two<BR/>three<br />four <b>bold</b>')).toBe('one\ntwo\nthree\nfour <b>bold</b>');
    expect(editTextToField('one\ntwo\r\nthree <b>bold</b>')).toBe('one<br>two<br>three <b>bold</b>');
    expect(editTextToField(fieldToEditText('a<br>b'))).toBe('a<br>b');
  });

  it('reads typed tags once each, whatever their case', () => {
    expect(parseTags('  noun A1 noun  a1 polski::odmiana ')).toEqual(['noun', 'A1', 'polski::odmiana']);
    expect(parseTags('')).toEqual([]);
  });

  it('previews Omnilanguage by Entry and Meaning, anything else by its first two fields', () => {
    expect(notePreview(omniNote())).toEqual({ front: 'หนังสือ', back: 'book' });
    expect(notePreview(basic('1', '<b>Capital</b> of Peru?', 'Lima<br>[sound:x.mp3]'))).toEqual({ front: 'Capital of Peru?', back: 'Lima' });
  });
});

describe('finding notes', () => {
  const notes = [
    basic('1', 'Capital of Peru?', 'Lima', 'Trivia', ['geo']),
    basic('2', 'Capital of Chile?', 'Santiago', 'Trivia::South America'),
    basic('3', 'kot', 'cat', 'Polski'),
    omniNote(),
  ];

  it('matches every word, case aside, in fields, tags or deck, sorted by what shows first', () => {
    expect(searchNotes(notes, 'capital').map((n) => n.id)).toEqual(['2', '1']);
    expect(searchNotes(notes, 'CAPITAL lima').map((n) => n.id)).toEqual(['1']);
    expect(searchNotes(notes, 'geo').map((n) => n.id)).toEqual(['1']);
    expect(searchNotes(notes, 'polski').map((n) => n.id)).toEqual(['3']);
    expect(searchNotes(notes, 'book').map((n) => n.id)).toEqual(['n1']);
  });

  it('keeps to a deck and its subdecks when one is picked', () => {
    expect(searchNotes(notes, '', 'Trivia').map((n) => n.id)).toEqual(['2', '1']);
    expect(searchNotes(notes, 'capital', 'Trivia::South America').map((n) => n.id)).toEqual(['2']);
  });

  it('offers a row of chips per level of the picked deck', () => {
    const more = [...notes, basic('4', 'x', 'y', 'Trivia::South America::Peru'), basic('5', 'z', 'w', 'Polski::Odmiana')];
    const labels = (rows: ReturnType<typeof deckChipRows>) => rows.map((r) => r.map((c) => c.label + (c.selected ? '*' : '')));
    expect(labels(deckChipRows(more, null))).toEqual([expect.arrayContaining(['All decks*', 'Polski', 'Trivia'])]);
    expect(labels(deckChipRows(more, 'Trivia'))).toEqual([
      expect.arrayContaining(['All decks', 'Trivia*']),
      ['All Trivia*', 'South America'],
    ]);
    expect(deckChipRows(more, 'Trivia::South America').map((r) => r.map((c) => c.deck))).toEqual([
      expect.arrayContaining([null, 'Trivia']),
      ['Trivia', 'Trivia::South America'],
      ['Trivia::South America', 'Trivia::South America::Peru'],
    ]);
    expect(deckChipRows([basic('1', 'a', 'b', 'Trivia')], null)).toEqual([]);
  });

  it('warns of another note of the same type with the same first field', () => {
    expect(duplicateOf(notes, { model: 'Basic', fields: { Front: ' capital OF <i>peru</i>? ' } }, 'Front')?.id).toBe('1');
    expect(duplicateOf(notes, { id: '1', model: 'Basic', fields: { Front: 'Capital of Peru?' } }, 'Front')).toBeUndefined();
    expect(duplicateOf(notes, { model: 'Other', fields: { Front: 'Capital of Peru?' } }, 'Front')).toBeUndefined();
  });
});

describe('filtering notes by their cards', () => {
  const H = 4;
  const note = basic('1', 'kot', 'cat', 'Polski');
  let ids = 0;
  const card = (over: Partial<Card['sched']> & Partial<Pick<Card, 'suspended' | 'retired' | 'flag' | 'buriedAt'>> = {}): Card => {
    const { suspended = false, retired = false, flag, buriedAt, ...sched } = over;
    return {
      id: `1:t${ids++}`, noteId: '1', kind: 't0', suspended, retired, flag, buriedAt,
      sched: { due: NOW.toISOString(), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 3, lapses: 0, state: 2, lastReview: null, ...sched },
    };
  };
  const matches = (filter: Parameters<typeof matchesNoteFilter>[0], cards: Card[], n = note) => matchesNoteFilter(filter, n, cards, NOW, H);

  it('counts a review due any time before the next study day as due today, and a step only once it is due today', () => {
    // NOW is noon; the next study day starts at 4 AM tomorrow.
    expect(matches('due', [card({ due: new Date(2026, 10, 12, 3).toISOString() })])).toBe(true);
    expect(matches('due', [card({ due: new Date(2026, 10, 12, 5).toISOString() })])).toBe(false);
    expect(matches('due', [card({ state: 1, due: new Date(2026, 10, 11, 18).toISOString() })])).toBe(true);
    expect(matches('due', [card({ due: new Date(2026, 10, 1).toISOString() })])).toBe(true);
  });

  it('leaves a suspended, retired or buried-today card out of New and Due today', () => {
    const past = new Date(2026, 10, 1).toISOString();
    expect(matches('due', [card({ due: past, suspended: true })])).toBe(false);
    expect(matches('due', [card({ due: past, retired: true })])).toBe(false);
    expect(matches('due', [card({ due: past, buriedAt: new Date(2026, 10, 11, 9).toISOString() })])).toBe(false);
    // Buried on an earlier study day: Anki has unburied it.
    expect(matches('due', [card({ due: past, buriedAt: new Date(2026, 10, 10, 9).toISOString() })])).toBe(true);
    expect(matches('new', [card({ state: 0 })])).toBe(true);
    expect(matches('new', [card({ state: 0, suspended: true })])).toBe(false);
  });

  it('keeps a note with any card suspended or flagged, and a note tagged leech', () => {
    expect(matches('suspended', [card(), card({ suspended: true })])).toBe(true);
    expect(matches('suspended', [card({ suspended: true, retired: true })])).toBe(false);
    expect(matches('flagged', [card({ flag: 7 })])).toBe(true);
    expect(matches('flagged', [card({ flag: 0 })])).toBe(false);
    expect(matches('leech', [], { ...note, tags: ['Leech'] })).toBe(true);
    expect(matches('leech', [card()])).toBe(false);
  });
});
