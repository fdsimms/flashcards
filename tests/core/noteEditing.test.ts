import { describe, expect, it } from 'vitest';
import { addDraftChanged, asEdited, deckChipRows, duplicateOf, editTextToField, fieldToEditText, matchesNoteFilter, notePreview, notesStillThere, parseTags, searchNotes, startModelFor, startNoteFor } from '../../src/core/noteEditing';
import { NOTE_LANGUAGES } from '../../src/core/cards';
import type { Card, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

/** Search with no cards: plain words and note searches only. */
const NO_CARDS = { byNote: new Map<string, Card[]>(), now: NOW, dayStartsAtHour: 4 };

const basic = (id: string, front: string, back: string, deck = 'Trivia', tags: string[] = []): Note =>
  ({ id, deck, model: 'Basic', fields: { Front: front, Back: back }, tags });

describe('editing a note', () => {
  it('shows line breaks as new lines, keeps other HTML as it is, and stores new lines back as <br>', () => {
    expect(fieldToEditText('one<br>two<BR/>three<br />four <b>bold</b>')).toBe('one\ntwo\nthree\nfour <b>bold</b>');
    expect(editTextToField('one\ntwo\r\nthree <b>bold</b>')).toBe('one<br>two<br>three <b>bold</b>');
    expect(editTextToField(fieldToEditText('a<br>b'))).toBe('a<br>b');
  });

  it('reads a field the editor would store back differently untouched as unchanged', () => {
    expect(asEdited('one<br/>two\nthree<BR>')).toBe('one<br>two<br>three<br>');
    expect(asEdited(editTextToField(fieldToEditText('one<br/>two\nthree')))).toBe(editTextToField(fieldToEditText('one<br/>two\nthree')));
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
    expect(searchNotes(notes, 'capital', null, NO_CARDS).map((n) => n.id)).toEqual(['2', '1']);
    expect(searchNotes(notes, 'CAPITAL lima', null, NO_CARDS).map((n) => n.id)).toEqual(['1']);
    expect(searchNotes(notes, 'geo', null, NO_CARDS).map((n) => n.id)).toEqual(['1']);
    expect(searchNotes(notes, 'polski', null, NO_CARDS).map((n) => n.id)).toEqual(['3']);
    expect(searchNotes(notes, 'book', null, NO_CARDS).map((n) => n.id)).toEqual(['n1']);
  });

  it('puts the closest matches first: the meaning itself before a mention in another field', () => {
    const omni = (id: string, entry: string, meaning: string, deck: string, more: Record<string, string> = {}): Note =>
      ({ id, deck, model: 'Omnilanguage', fields: { Entry: entry, Meaning: meaning, Notes: '', ContextTranslation: '', ...more }, tags: [] });
    const found = [
      omni('desultory', 'desultory', 'Lacking any definite plan. Also used of effort or performance that is halfhearted.', 'English'),
      { id: 'henry', deck: 'Trivia', model: 'Shakespeare', fields: { Title: '<i>Henry VIII</i>', Year: '1613', Other: 'Globe Theater burned down during early performance' }, tags: [] },
      omni('hervorragend', 'hervorragend', 'outstanding; excellent', 'Deutsch', { ContextTranslation: 'That was an outstanding performance.' }),
      omni('enso', '演奏', 'musical performance; playing an instrument', '日本語'),
      omni('sadaeng', 'แสดง', '1. to perform; to act<br>2. to show; to display', 'ไทย', { Notes: 'การแสดง = performance' }),
      omni('leistung', 'Leistung', 'performance; achievement', 'Deutsch'),
      omni('gaansadaeng', 'การแสดง', 'performance; show', 'ไทย'),
    ];
    const ids = (q: string) => searchNotes(found, q, null, NO_CARDS).map((n) => n.id);
    // As a listed meaning, then a word in a meaning, then in another field (ties by what shows first).
    expect(ids('performance')).toEqual(['leistung', 'gaansadaeng', 'desultory', 'enso', 'henry', 'hervorragend', 'sadaeng']);
    // "to perform" lists as "perform"; the start of "performance" comes after it.
    expect(ids('perform')[0]).toBe('sadaeng');
    // The front comes before the meaning, and the whole front before a front that only holds it.
    expect(ids('แสดง')).toEqual(['sadaeng', 'gaansadaeng']);
    // Words found apart rank behind them found together.
    expect(ids('musical performance')).toEqual(['enso']);
    expect(ids('performance show')).toEqual(['gaansadaeng', 'sadaeng']);
  });

  it('finds a word typed without its accents', () => {
    const polish = [basic('z', 'żółw', 'turtle', 'Polski'), basic('w', 'zołza', 'shrew', 'Polski')];
    expect(searchNotes(polish, 'zolw', null, NO_CARDS).map((n) => n.id)).toEqual(['z']);
    expect(searchNotes(polish, 'zo', null, NO_CARDS).map((n) => n.id)).toEqual(['w', 'z']);
  });

  it('keeps to a deck and its subdecks when one is picked', () => {
    expect(searchNotes(notes, '', 'Trivia', NO_CARDS).map((n) => n.id)).toEqual(['2', '1']);
    expect(searchNotes(notes, 'capital', 'Trivia::South America', NO_CARDS).map((n) => n.id)).toEqual(['2']);
  });

  it("reads Anki's search syntax, its cards' state included, and finds nothing in a search it can't read", () => {
    const sched = { due: NOW.toISOString(), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0, lastReview: null };
    const cards = {
      ...NO_CARDS,
      byNote: new Map<string, Card[]>([
        ['1', [{ id: 'c1', noteId: '1', kind: 't0', suspended: false, retired: false, flag: 1, sched: { ...sched, state: 0 } }]],
        ['2', [{ id: 'c2', noteId: '2', kind: 't0', suspended: true, retired: false, sched: { ...sched, state: 2 } }]],
      ]),
    };
    const ids = (q: string) => searchNotes(notes, q, null, cards).map((n) => n.id);
    expect(ids('deck:Trivia is:new')).toEqual(['1']);
    expect(ids('capital -is:suspended')).toEqual(['1']);
    expect(ids('flag:1 or deck:Polski')).toEqual(['1', '3']);
    expect(ids('note:Omnilanguage')).toEqual(['n1']);
    expect(ids('(capital')).toEqual([]);
  });

  it('ranks a note found through "or" by where the best plain word it holds is, then by what it shows first', () => {
    const found = [basic('a', 'lima', 'x'), basic('b', 'peru', 'capital of peru is lima'), basic('c', 'capital', 'y'), basic('d', 'lima capital', 'z')];
    // Both words on the front, then one word on the front, then both only in the meaning.
    expect(searchNotes(found, 'lima or capital', null, NO_CARDS).map((n) => n.id)).toEqual(['d', 'c', 'a', 'b']);
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
    expect(duplicateOf(notes, { deck: 'Trivia', model: 'Basic', fields: { Front: ' capital OF <i>peru</i>? ' } }, 'Front')?.id).toBe('1');
    expect(duplicateOf(notes, { id: '1', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru?' } }, 'Front')).toBeUndefined();
    expect(duplicateOf(notes, { deck: 'Trivia', model: 'Other', fields: { Front: 'Capital of Peru?' } }, 'Front')).toBeUndefined();
  });

  it('compares an Omnilanguage note only with notes of its own language', () => {
    const omni = (id: string, deck: string, Entry: string, Language = ''): Note =>
      ({ id, deck, model: 'Omnilanguage', fields: { Entry, Meaning: 'm', Language }, tags: [] }) as Note;
    const existing = [omni('de', 'Languages::Deutsch', 'in'), omni('th', 'Languages::Thai', 'in', 'Thai')];
    expect(duplicateOf(existing, { deck: 'Languages::Norsk', model: 'Omnilanguage', fields: { Entry: 'in', Meaning: 'm' } }, 'Entry')).toBeUndefined();
    expect(duplicateOf(existing, { deck: 'Languages::Deutsch', model: 'Omnilanguage', fields: { Entry: 'in', Meaning: 'm' } }, 'Entry')?.id).toBe('de');
    // The Language field wins over the deck name.
    expect(duplicateOf(existing, { deck: 'Misc', model: 'Omnilanguage', fields: { Entry: 'in', Meaning: 'm', Language: 'Thai' } }, 'Entry')?.id).toBe('th');
    // No language to go by: compared with all, as Anki does.
    expect(duplicateOf(existing, { deck: 'Misc', model: 'Omnilanguage', fields: { Entry: 'in', Meaning: 'm' } }, 'Entry')?.id).toBe('de');
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

describe('notesStillThere', () => {
  it('leaves out a note whose Anki cards are all retired, and keeps the rest', async () => {
    const { makeCards } = await import('../../src/core/cards');
    const gone = basic('1', 'gone', 'x');
    const kept = basic('2', 'kept', 'x');
    const franki = basic('3', 'franki', 'x');
    const cards: Card[] = [
      ...makeCards(gone, NOW).map((c) => ({ ...c, ankiId: '11', retired: true })),
      ...makeCards(kept, NOW).map((c) => ({ ...c, ankiId: '22' })),
      // Franki's own note with no card left it makes: still there, Anki never had it.
      ...makeCards(franki, NOW).map((c) => ({ ...c, retired: true })),
    ];
    expect(notesStillThere([gone, kept, franki], cards).map((n) => n.id)).toEqual(['2', '3']);
  });
});

describe('a note being added', () => {
  const start = { fields: { Entry: 'styre', Meaning: 'to govern' }, tags: 'cram::thai-2026-11-20' };
  it("isn't changed when it opens filled in, blank fields or tag order aside", () => {
    expect(addDraftChanged(start, { fields: { ...start.fields, Audio: '' }, tags: start.tags })).toBe(false);
    expect(addDraftChanged({ fields: {}, tags: '' }, { fields: { Front: '  ' }, tags: '' })).toBe(false);
  });
  it('is changed once a field or the tags differ from how it opened', () => {
    expect(addDraftChanged(start, { fields: { ...start.fields, Meaning: 'to rule' }, tags: start.tags })).toBe(true);
    expect(addDraftChanged(start, { fields: start.fields, tags: '' })).toBe(true);
    expect(addDraftChanged({ fields: {}, tags: '' }, { fields: { Front: 'a' }, tags: '' })).toBe(true);
  });
});

describe('startModelFor', () => {
  const note = (deck: string, model: string, id: string): Note => ({ id, deck, model, fields: {}, tags: [] });
  const notes = [note('Trivia', 'Basic', '1'), note('Languages::Polski', 'Omnilanguage', '2'), note('Languages::Polski::Odmiana', 'Omnilanguage', '3'), note('Languages::Polski', 'Basic', '4'), note('Languages::Español', 'Omnilanguage', '5')];

  it("starts with the type the deck's notes use most, its subdecks included", () => {
    expect(startModelFor(notes, ['Basic', 'Omnilanguage'], 'Languages::Polski')).toBe('Omnilanguage');
    expect(startModelFor(notes, ['Basic', 'Omnilanguage'], 'Trivia')).toBe('Basic');
  });

  it("falls back to the collection's most used type, then the first type", () => {
    expect(startModelFor(notes, ['Cloze'], 'Empty deck')).toBe('Omnilanguage');
    expect(startModelFor([], ['Cloze', 'Basic'], 'Empty deck')).toBe('Cloze');
    expect(startModelFor([], [], 'Empty deck')).toBe('');
  });
});

describe('startNoteFor', () => {
  const basic = (deck: string) => ({ id: deck, deck, model: 'Basic', fields: { Front: 'x', Back: 'y' }, tags: [] });
  it("starts a new deck's note in its language, from its options or its name", () => {
    expect(startNoteFor([], [], 'Spanish', undefined)).toEqual({ model: 'Omnilanguage', fields: { Language: 'Spanish' } });
    expect(startNoteFor([], [], 'Words', { noteLanguage: 'Polish', askBothWays: true })).toEqual({ model: 'Omnilanguage', fields: { Language: 'Polish', GenerateReverse: 'y' } });
    expect(startNoteFor([], ['Basic', 'Omnilanguage'], '🌮 Español', undefined).model).toBe('Omnilanguage');
  });
  it('starts as before with no language, notes already in the deck, or no Omnilanguage type', () => {
    expect(startNoteFor([], [], 'Spanish', { noteLanguage: '' })).toEqual({ model: '', fields: {} });
    expect(startNoteFor([basic('Spanish')], ['Basic', 'Omnilanguage'], 'Spanish', undefined)).toEqual({ model: 'Basic', fields: {} });
    expect(startNoteFor([], ['Basic'], 'Spanish', undefined)).toEqual({ model: 'Basic', fields: {} });
    expect(startNoteFor([], [], 'Trivia', undefined)).toEqual({ model: '', fields: {} });
  });
  it('offers each language once, by its English name', () => {
    const names = NOTE_LANGUAGES.map((l) => l.name);
    expect(names).toContain('Thai');
    expect(names).toContain('Indonesian');
    expect(names).toContain('Cantonese');
    expect(names).not.toContain('Polski');
    expect(new Set(NOTE_LANGUAGES.map((l) => l.tag)).size).toBe(NOTE_LANGUAGES.length);
  });
});
