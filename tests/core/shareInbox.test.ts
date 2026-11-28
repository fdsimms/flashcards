import { describe, expect, it } from 'vitest';
import { MAX_QUEUED } from '../../src/core/quickAdd';
import {
  deckForShare, FRESH_MS, MAX_SHARES, mergeShares, parseShares, scriptLanguage, shareName, shareSource, sharedWords, shareToOpen, type SharedItem,
} from '../../src/core/shareInbox';

const NOW = new Date(2026, 10, 26, 12).getTime();
const item = (id: string, over: Partial<SharedItem> = {}): SharedItem => ({ id, kind: 'read', text: 'W sobotę otwarto most.', sharedAt: NOW - 1000, ...over });

describe('reading the share inbox', () => {
  it('keeps well-formed shares and drops the rest', () => {
    const raw = [
      { id: 'a', kind: 'read', text: 'Tekst', title: '  Most ', url: 'https://x.pl/a', sharedAt: NOW },
      { id: 'b', kind: 'words', text: 'kot', sharedAt: NOW, title: ' ' },
      { id: 'l', kind: 'lookup', text: 'kot', sharedAt: NOW },
      { id: 'v', kind: 'video', text: 'https://youtu.be/dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ', sharedAt: NOW },
      { id: 'c', kind: 'other', text: 'x', sharedAt: NOW },
      { id: 'd', kind: 'read', text: '   ', sharedAt: NOW },
      { id: '', kind: 'read', text: 'x', sharedAt: NOW },
      { id: 'e', kind: 'read', text: 'x', sharedAt: 'now' },
      null,
    ];
    expect(parseShares(raw)).toEqual([
      { id: 'a', kind: 'read', text: 'Tekst', title: 'Most', url: 'https://x.pl/a', sharedAt: NOW },
      { id: 'b', kind: 'words', text: 'kot', sharedAt: NOW },
      { id: 'l', kind: 'lookup', text: 'kot', sharedAt: NOW },
      { id: 'v', kind: 'video', text: 'https://youtu.be/dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ', sharedAt: NOW },
    ]);
    expect(parseShares({})).toEqual([]);
  });

  it('merges what was kept with what was just taken, each once, oldest first, the newest kept', () => {
    const kept = [item('a', { sharedAt: 1 }), item('b', { sharedAt: 3 })];
    expect(mergeShares(kept, [item('b', { sharedAt: 3 }), item('c', { sharedAt: 2 })]).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    const many = Array.from({ length: MAX_SHARES + 5 }, (_, i) => item(String(i), { sharedAt: i }));
    const merged = mergeShares([], many);
    expect(merged).toHaveLength(MAX_SHARES);
    expect(merged[0].id).toBe('5');
  });
});

describe('opening a share', () => {
  it('opens the newest fresh share not opened yet', () => {
    const items = [item('old', { sharedAt: NOW - FRESH_MS - 1 }), item('a', { sharedAt: NOW - 10 }), item('b', { sharedAt: NOW - 5 })];
    expect(shareToOpen(items, new Set(), true, NOW)?.id).toBe('b');
    expect(shareToOpen(items, new Set(['b']), true, NOW)?.id).toBe('a');
    expect(shareToOpen(items, new Set(['a', 'b']), true, NOW)).toBeUndefined();
  });

  it('leaves a share to read or look up on Today while Read & Listen is off, but still opens words', () => {
    expect(shareToOpen([item('r')], new Set(), false, NOW)).toBeUndefined();
    expect(shareToOpen([item('l', { kind: 'lookup' })], new Set(), false, NOW)).toBeUndefined();
    expect(shareToOpen([item('l', { kind: 'lookup' })], new Set(), true, NOW)?.id).toBe('l');
    expect(shareToOpen([item('w', { kind: 'words' })], new Set(), false, NOW)?.id).toBe('w');
  });
});

describe("a share's language, words and names", () => {
  it("guesses the language from a script only one of the app's languages uses", () => {
    expect(scriptLanguage('ฉันอยากกินข้าว')).toBe('th');
    expect(scriptLanguage('今日は雨です')).toBe('ja');
    expect(scriptLanguage('Я иду домой')).toBe('ru');
    expect(scriptLanguage('Καλημέρα')).toBe('el');
    expect(scriptLanguage('W sobotę otwarto most')).toBeUndefined();
    // Mostly Thai with a Latin name in it.
    expect(scriptLanguage('ไปเที่ยว Bangkok กัน')).toBe('th');
  });

  it('splits a share into words, each once, without quotes or end punctuation', () => {
    expect(sharedWords('rowerzystów')).toEqual([{ entry: 'rowerzystów', meaning: '' }]);
    expect(sharedWords('"kot", pies;\nKot\n  dom. ').map((w) => w.entry)).toEqual(['kot', 'pies', 'dom']);
    expect(sharedWords(Array.from({ length: MAX_QUEUED + 3 }, (_, i) => `w${i}`).join('\n'))).toHaveLength(MAX_QUEUED);
  });

  it('says where it came from and what to call it', () => {
    expect(shareSource({ url: 'https://www.wiadomosci.example.pl/most' })).toBe('From wiadomosci.example.pl');
    expect(shareSource({})).toBe('Shared from another app');
    expect(shareSource({ url: 'not a url' })).toBe('Shared from another app');
    expect(shareName({ title: 'Nowy most', text: 'x' })).toBe('Nowy most');
    expect(shareName({ text: 'a'.repeat(80) })).toHaveLength(60);
  });
});

describe('the deck shared words go to', () => {
  const decks = [
    { deck: 'Polski', speechTag: 'pl-PL' },
    { deck: 'Русский', speechTag: 'ru-RU' },
    { deck: 'ภาษาไทย', speechTag: 'th-TH' },
    { deck: 'Trivia' },
  ];
  it("keeps the deck last added to when it's in the words' language, or when their letters say none", () => {
    expect(deckForShare(decks, 'кошка', 'Русский')).toBe('Русский');
    expect(deckForShare(decks, 'kot', 'Polski')).toBe('Polski');
    expect(deckForShare(decks, 'kot', 'Trivia')).toBe('Trivia');
  });
  it("otherwise takes the first deck in the words' language", () => {
    expect(deckForShare(decks, 'кошка', 'Polski')).toBe('Русский');
    expect(deckForShare(decks, 'แมว', undefined)).toBe('ภาษาไทย');
    expect(deckForShare(decks, 'Καλημέρα', 'Polski')).toBe('Polski');
  });
});
