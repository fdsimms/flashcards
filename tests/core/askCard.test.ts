import { expect, test } from 'vitest';
import { cardForClaude, cardMessage, claudeChatLink, withNotesAnswer, withQuestion } from '../../src/core/askCard';
import type { Note } from '../../src/core/types';

const note = (fields: Record<string, string>, deck = 'Polski'): Note => ({
  id: 'n1', deck, model: 'Omnilanguage', fields, tags: [],
} as unknown as Note);

test('an Omnilanguage card is its word, meaning, example and mnemonic as text', () => {
  const card = cardForClaude(
    note({ Entry: 'wyjść', Meaning: 'to go out', Language: 'Polish', Context: 'Muszę <b>wyjść</b>.', Mnemonic: 'wee-shch' }),
    undefined, 'forward',
  );
  expect(card).toEqual({ language: 'pl', front: 'wyjść', back: 'to go out', details: 'Example: Muszę wyjść.\nMnemonic: wee-shch' });
});

test('the transliteration goes beside the word', () => {
  const card = cardForClaude(note({ Entry: 'ทุก', Meaning: 'every', Transliteration: 'túk', Language: 'Thai' }, 'Thai'), undefined, 'forward');
  expect(card?.front).toBe('ทุก (túk)');
  expect(card?.details).toBe('');
});

test('a note with no word or meaning has nothing to ask about', () => {
  expect(cardForClaude(note({ Entry: 'wyjść', Meaning: ' ' }), undefined, 'forward')).toBeUndefined();
});

test('a note type with no template has nothing to ask about', () => {
  const basic = { ...note({ Front: 'a', Back: 'b' }), model: 'Basic' } as Note;
  expect(cardForClaude(basic, undefined, 't0')).toBeUndefined();
});

test('the new question goes last and is trimmed', () => {
  const turns = withQuestion([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }], '  q2 ');
  expect(turns.at(-1)).toEqual({ role: 'user', content: 'q2' });
  expect(turns).toHaveLength(3);
});

test('the message has the card and no empty example line', () => {
  expect(cardMessage({ front: 'a', back: 'b', details: '' })).toBe("I'm reviewing a flashcard.\nFront: a\nBack: b");
});

test('the chat link carries the card and the typed question, encoded', () => {
  const url = claudeChatLink({ front: 'wyjść', back: 'to go out', details: '' }, 'Why wyjść & not wychodzić?');
  expect(url.startsWith('https://claude.ai/new?q=')).toBe(true);
  const text = decodeURIComponent(url.slice('https://claude.ai/new?q='.length));
  expect(text).toContain('Front: wyjść');
  expect(text.endsWith('My question: Why wyjść & not wychodzić?')).toBe(true);
});

test('a long card is cut so the question still fits in the link', () => {
  const url = claudeChatLink({ front: 'a', back: 'b', details: 'x'.repeat(5000) }, 'Why?');
  const text = decodeURIComponent(url.slice('https://claude.ai/new?q='.length));
  expect(text.length).toBeLessThanOrEqual(1800);
  expect(text.endsWith('My question: Why?')).toBe(true);
});

test('an answer is added to Notes under what is there, as escaped text with line breaks', () => {
  expect(withNotesAnswer({ Notes: 'Old note' }, 'Use <i>wyjść</i>.\nOnce.').Notes).toBe('Old note<br><br>Use &lt;i&gt;wyjść&lt;/i&gt;.<br>Once.');
});

test('an answer goes straight into empty Notes, and a blank one changes nothing', () => {
  expect(withNotesAnswer({ Notes: '<br>' }, 'Hi').Notes).toBe('Hi');
  expect(withNotesAnswer({}, 'Hi').Notes).toBe('Hi');
  const fields = { Notes: 'x' };
  expect(withNotesAnswer(fields, '  ')).toBe(fields);
});
