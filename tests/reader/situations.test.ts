import { describe, expect, it } from 'vitest';
import type { SituationTurn } from '../../src/reader/api';
import { bracketed, canFinish, canSend, conversationOf, lineParts, MAX_LINE, MAX_LINES, startChat, withMine, withoutMine, withTheirs } from '../../src/reader/situations';

const roles = { you: 'a customer', them: 'the vendor', name: 'Noi', gender: 'female' as const };
const turn = (line: string, over: Partial<SituationTurn> = {}): SituationTurn =>
  ({ line, english: 'x', words: [], unknown: [], done: false, audio: null, ...over });

describe('a conversation', () => {
  it('takes its parts from the first turn and keeps them', () => {
    let chat = withTheirs(startChat('th', ' Ordering street food '), turn('รับอะไรดีคะ', { roles }));
    expect(chat.scene).toBe('Ordering street food');
    expect(chat.roles).toEqual(roles);
    chat = withMine(chat, '  ขอ   [mango]  ค่ะ ');
    chat = withTheirs(chat, turn('ได้ค่ะ', { roles: { ...roles, name: 'Other' }, done: true }));
    expect(chat.roles?.name).toBe('Noi');
    expect(chat.done).toBe(true);
    expect(conversationOf(chat)).toEqual({
      language: 'th',
      scene: 'Ordering street food',
      roles,
      lines: [{ speaker: 'them', text: 'รับอะไรดีคะ' }, { speaker: 'you', text: 'ขอ [mango] ค่ะ' }, { speaker: 'them', text: 'ได้ค่ะ' }],
    });
  });

  it('takes back the last line of the owner\'s to send again', () => {
    const chat = withMine(withTheirs(startChat('th', 'x'), turn('a', { roles })), 'ขอ');
    expect(withoutMine(chat)).toEqual({ chat: withTheirs(startChat('th', 'x'), turn('a', { roles })), text: 'ขอ' });
    expect(withoutMine(withTheirs(startChat('th', 'x'), turn('a')))).toBeNull();
  });

  it('sends only after their line, within the limits, until the scene is over', () => {
    const first = startChat('th', 'x');
    expect(canSend(first, 'ขอ')).toBe(false);
    const theirs = withTheirs(first, turn('a', { roles }));
    expect(canSend(theirs, ' ')).toBe(false);
    expect(canSend(theirs, 'ขอ')).toBe(true);
    expect(canSend(theirs, 'x'.repeat(MAX_LINE + 1))).toBe(false);
    expect(canSend(withMine(theirs, 'ขอ'), 'ขอ')).toBe(false);
    expect(canSend(withTheirs(theirs, turn('b', { done: true })), 'ขอ')).toBe(false);
    const long = { ...theirs, lines: Array.from({ length: MAX_LINES - 1 }, () => theirs.lines[0]) };
    expect(canSend(long, 'ขอ')).toBe(false);
  });

  it('finishes once the owner has said something', () => {
    const theirs = withTheirs(startChat('th', 'x'), turn('a', { roles }));
    expect(canFinish(theirs)).toBe(false);
    expect(canFinish(withMine(theirs, 'ขอ'))).toBe(true);
  });
});

describe('brackets', () => {
  it('finds the English asked for', () => {
    expect(bracketed('ไม่ [too spicy] นะ [ ] ครับ [rice]')).toEqual(['too spicy', 'rice']);
  });
  it('splits a line into its own words and the asked-for ones', () => {
    expect(lineParts('ไม่ [too spicy] นะ')).toEqual([
      { text: 'ไม่ ', asked: false },
      { text: '[too spicy]', asked: true },
      { text: ' นะ', asked: false },
    ]);
    expect(lineParts('ครับ')).toEqual([{ text: 'ครับ', asked: false }]);
  });
});
