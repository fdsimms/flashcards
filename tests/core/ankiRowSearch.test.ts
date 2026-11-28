import { describe, expect, it } from 'vitest';
import { matchesAnkiRow, type AnkiSearchRow } from '../../src/core/ankiRowSearch';
import { parseSearch } from '../../src/core/ankiSearch';

const T = { today: 100, nextDayAt: 1_800_000_000, now: 1_799_990_000, learnAheadSecs: 1200 };
const row = (over: Partial<AnkiSearchRow> = {}): AnkiSearchRow => ({
  id: 1_700_000_000_000, nid: 1, did: 1, odid: 0, ord: 0, type: 2, queue: 2, due: 105, odue: 0, ivl: 10, factor: 2500, reps: 4, lapses: 1, flags: 0,
  data: '{"s":12,"d":5,"decay":0.154}', mod: 1_799_000_000, flds: '<b>Kot</b>\x1fcat', sfld: 'Kot', tags: ' noun animals::pets ', notetype: 'Basic',
  fieldNames: ['Front', 'Back'], deckName: 'Polski::Słownictwo', revlog: [], ...over,
});
const m = (q: string, r: AnkiSearchRow = row()) => {
  const p = parseSearch(q);
  if (!p.ok || !p.node) throw new Error(q);
  return matchesAnkiRow(p.node, r, T);
};

describe("a search on the collection's rows, as Anki's SQL reads it", () => {
  it('reads a plain word in the fields as stored, case aside for ASCII only', () => {
    expect(m('KOT')).toBe(true);
    expect(m('<b>')).toBe(true);
    expect(m('noun')).toBe(false); // tags aren't fields
    expect(m('słow')).toBe(false); // nor the deck
    expect(m('kót')).toBe(false); // accents count
    expect(m('ŁÓDŹ', row({ flds: 'łódź\x1fboat', sfld: 'łódź' }))).toBe(false);
  });
  it('reads a field whole, decks and tags with their children', () => {
    expect(m('front:<b>kot</b>')).toBe(true);
    expect(m('front:kot')).toBe(false);
    expect(m('back:c*')).toBe(true);
    expect(m('deck:polski')).toBe(true);
    expect(m('deck:Polski::S*')).toBe(true);
    expect(m('deck:Pol')).toBe(false);
    expect(m('tag:animals')).toBe(true);
    expect(m('tag:anim*')).toBe(true);
    expect(m('tag:pets')).toBe(false);
    expect(m('deck:filtered')).toBe(false);
    expect(m('deck:filtered', row({ odid: 5, homeDeckName: 'Polski' }))).toBe(true);
  });
  it('reads states and properties from the columns', () => {
    expect(m('is:review prop:ivl>=10 prop:due=5 prop:lapses=1 prop:ease=2.5')).toBe(true);
    expect(m('is:due')).toBe(false);
    expect(m('is:due', row({ due: 100 }))).toBe(true);
    expect(m('is:due', row({ queue: 1, type: 1, due: T.now + 600 }))).toBe(true);
    expect(m('is:buried-manually', row({ queue: -3 }))).toBe(true);
    expect(m('prop:s>11 prop:d=0.4444444444444444')).toBe(true);
  });
  it('reads rated: from the review log', () => {
    const r = row({ revlog: [{ id: (T.nextDayAt - 3600) * 1000, ease: 1 }] });
    expect(m('rated:1', r)).toBe(true);
    expect(m('rated:1:3', r)).toBe(false);
    expect(m('rated:1:1', r)).toBe(true);
    expect(m('rated:1')).toBe(false);
  });
});
