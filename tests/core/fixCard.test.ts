import { expect, test } from 'vitest';
import { chatFixRequest, checkFix, CHAT_REASON, fixRequest, followUpThread, proposalTurn, threadAfter, withFix } from '../../src/core/fixCard';
import type { Note } from '../../src/core/types';

const note = (fields: Record<string, string>, deck = 'Thai'): Note => ({
  id: 'n1', deck, model: 'Omnilanguage', fields, tags: [],
} as unknown as Note);

const NOTE = note({
  Entry: 'เสีย', Language: 'Thai', Meaning: 'to break down; to be sorry (เสียใจ)',
  Context: 'แอร์<b>เสีย</b>ครับ[sound:a.mp3]', Image: '<img src="x.png">',
});

test('the request carries the fields as stored, the reason as its label and the trimmed note', () => {
  const req = fixRequest(NOTE, 'typo', '  Remove the Thai word.  ');
  expect(req).toEqual({ language: 'th', fields: NOTE.fields, reason: 'Typo or wrong text', note: 'Remove the Thai word.' });
});

test('a change to a field the note has is kept, old and new', () => {
  const p = checkFix(NOTE, { changes: { Meaning: 'to break down; to be sorry' }, explanation: ' Removed it. ' });
  expect(p.changes).toEqual([{ field: 'Meaning', before: 'to break down; to be sorry (เสียใจ)', after: 'to break down; to be sorry' }]);
  expect(p.explanation).toBe('Removed it.');
  expect(p.skipped).toBe(0);
});

test('an unknown field, an unchanged one and a non-text value are ignored', () => {
  const p = checkFix(NOTE, { changes: { Nope: 'x', Entry: 'เสีย', Meaning: 5 as unknown as string }, explanation: '' });
  expect(p.changes).toEqual([]);
  expect(p.skipped).toBe(0);
});

test('a change that drops, adds or moves a recording or image is left out and counted', () => {
  const p = checkFix(NOTE, {
    changes: {
      Context: 'แอร์<b>เสีย</b>ครับ', // drops the sound
      Image: '<img src="y.png">', // swaps the image
      Meaning: 'to break down; to be sorry',
    },
    explanation: '',
  });
  expect(p.changes.map((c) => c.field)).toEqual(['Meaning']);
  expect(p.skipped).toBe(2);
});

test('a change to text around a recording keeps the recording and is accepted', () => {
  const p = checkFix(NOTE, { changes: { Context: 'แอร์<b>เสีย</b>นะครับ[sound:a.mp3]' }, explanation: '' });
  expect(p.changes).toHaveLength(1);
});

test('the changes are written into a copy of the fields', () => {
  const p = checkFix(NOTE, { changes: { Meaning: 'to break down' }, explanation: '' });
  const next = withFix(NOTE.fields, p);
  expect(next.Meaning).toBe('to break down');
  expect(next.Entry).toBe('เสีย');
  expect(NOTE.fields.Meaning).toContain('เสียใจ');
});

test('a change asked for in a chat sends the latest turns, starting at the learner, with no note', () => {
  const turns = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` } as const));
  const req = chatFixRequest(NOTE, turns);
  expect(req.reason).toBe(CHAT_REASON);
  expect(req.note).toBe('');
  expect(req.fields).toBe(NOTE.fields);
  // The last 12 of 15 start on an assistant turn (index 3), so that one is dropped.
  expect(req.chat?.map((t) => t.content)).toEqual(turns.slice(4).map((t) => t.content));
  expect(req.chat?.[0].role).toBe('user');
});

test('a short chat is sent whole', () => {
  const turns = [{ role: 'user', content: 'Why?' }, { role: 'assistant', content: 'Because.' }] as const;
  expect(chatFixRequest(NOTE, [...turns]).chat).toEqual(turns);
});

test('a reply to a suggestion is sent as a chat that starts with the flag and ends with the reply', () => {
  const proposal = checkFix(NOTE, { changes: { Meaning: 'to break down' }, explanation: 'Shortened it.' });
  const sent = followUpThread([], proposal, '  why did you drop it?  ');
  expect(sent.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
  expect(sent[1].content).toContain('Shortened it.');
  expect(sent[1].content).toContain('Meaning: to break down; to be sorry (เสียใจ) -> to break down');
  expect(sent[2].content).toBe('why did you drop it?');
  const req = fixRequest(NOTE, 'typo', 'note', sent);
  expect(req.chat).toEqual(sent);
  expect(req.note).toBe('note');
});

test('a second reply continues the thread instead of starting a new one', () => {
  const first = checkFix(NOTE, { changes: { Meaning: 'to break down' }, explanation: 'Shortened it.' });
  const sent = followUpThread([], first, 'why?');
  const second = checkFix(NOTE, { changes: {}, explanation: 'Because.' });
  const kept = threadAfter(sent, second);
  expect(kept.at(-1)?.role).toBe('assistant');
  expect(kept.at(-1)?.content).toContain('(No change suggested.)');
  const next = followUpThread(kept, second, 'ok keep it');
  expect(next).toHaveLength(kept.length + 1);
  expect(next.slice(0, kept.length)).toEqual(kept);
});

test('a long thread keeps the latest turns, starting at the learner, and a flag with no reply sends no chat', () => {
  const p = checkFix(NOTE, { changes: {}, explanation: 'x' });
  let thread = followUpThread([], p, 'r0');
  for (let i = 1; i < 8; i++) thread = followUpThread(threadAfter(thread, p), p, `r${i}`);
  const req = fixRequest(NOTE, 'typo', '', thread);
  expect(req.chat!.length).toBeLessThanOrEqual(12);
  expect(req.chat![0].role).toBe('user');
  expect(req.chat!.at(-1)?.content).toBe('r7');
  expect(fixRequest(NOTE, 'typo', '').chat).toBeUndefined();
});

test('a turn is cut to what the server takes', () => {
  const p = checkFix(NOTE, { changes: {}, explanation: 'e'.repeat(5000) });
  expect(proposalTurn(p).length).toBeLessThanOrEqual(1500);
  expect(followUpThread([], p, 'r'.repeat(5000)).at(-1)!.content.length).toBe(1500);
});
