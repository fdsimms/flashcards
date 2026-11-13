import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import type { Note } from '../../src/core/types';
import { matchKey, reconcileIds } from '../../src/import/reconcile';
import type { ImportResult } from '../../src/import/tsv';
import { NOW } from '../support/fixtures';

const basic = (id: string, deck: string, front: string, back = ''): Note => ({
  id, deck, model: 'Basic', fields: { Front: front, Back: back }, tags: [],
});
const resultOf = (notes: Note[]): ImportResult => ({ notes, cards: notes.flatMap((n) => makeCards(n, NOW)), warnings: [] });

describe('reconcileIds', () => {
  it('matches the same note across export formats and decks', () => {
    const stored = basic('1700000000', 'Trivia::Old', 'Capital of Peru?');
    const incoming = basic('tsv:Trivia::New:Capital of Peru?', 'Trivia::New', 'Capital of Peru?', 'Lima');
    const res = reconcileIds(resultOf([incoming]), [stored]);
    expect(res.notes[0].id).toBe('1700000000');
    expect(res.notes[0].deck).toBe('Trivia::New');
    expect(res.cards.map((c) => [c.id, c.noteId])).toEqual([['1700000000:forward', '1700000000']]);
  });
  it('matches a front written with a character reference to the same text stored plainly', () => {
    const stored = basic('tsv:Fr:l\'eau', 'Fr', "l'eau");
    const res = reconcileIds(resultOf([basic('tsv:Fr:l&#x27;eau', 'Fr', 'l&#x27;eau', 'water')]), [stored]);
    expect(res.notes[0].id).toBe("tsv:Fr:l'eau");
  });
  it('keeps an id that is already stored', () => {
    const stored = basic('a', 'D', 'Q');
    expect(reconcileIds(resultOf([basic('a', 'D', 'Q')]), [stored, basic('b', 'E', 'Q')]).notes[0].id).toBe('a');
  });
  it('adds a new note with a warning when several stored notes match', () => {
    const stored = [basic('1', 'D', 'Bank', 'bench'), basic('2', 'D', 'Bank', 'bank')];
    const res = reconcileIds(resultOf([basic('tsv:D:Bank', 'D', 'Bank')]), stored);
    expect(res.notes[0].id).toBe('tsv:D:Bank');
    expect(res.warnings.join(' ')).toMatch(/matches 2 notes/);
  });
  it('claims a stored note once, and never one this import updates under its own id', () => {
    const stored = [basic('1', 'D', 'Q')];
    const res = reconcileIds(resultOf([basic('x', 'D', 'Q'), basic('y', 'E', 'Q')]), stored);
    expect(res.notes.map((n) => n.id)).toEqual(['1', 'y']);
    const own = reconcileIds(resultOf([basic('1', 'D', 'Q'), basic('z', 'E', 'Q')]), stored);
    expect(own.notes.map((n) => n.id)).toEqual(['1', 'z']);
  });
  it('keys on note type and front text, ignoring HTML and spacing but not case', () => {
    expect(matchKey(basic('a', 'D', '<b>Weg</b>  '))).toBe(matchKey(basic('b', 'E', 'Weg')));
    expect(matchKey(basic('a', 'D', 'Weg'))).not.toBe(matchKey(basic('b', 'D', 'weg')));
    expect(matchKey({ ...basic('a', 'D', 'Weg'), model: 'Other' })).not.toBe(matchKey(basic('b', 'D', 'Weg')));
  });
});
