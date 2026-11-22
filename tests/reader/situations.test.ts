import { describe, expect, it } from 'vitest';
import type { SituationTurn } from '../../src/reader/api';
import {
  bracketed, canFinish, canSend, conversationOf, lineParts, MAX_LINE, MAX_LINES, rehearsalOf, rehearsalParams, REHEARSAL_WORD_MAX, REHEARSAL_WORDS_MAX, PREPARED_LINE_MAX, PREPARED_MAX, startChat, withMine, withoutMine, withTheirs,
} from '../../src/reader/situations';

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

describe('rehearsing a cram', () => {
  it('sends the words with the conversation, and only when there are some', () => {
    const chat = startChat('th', 'Ordering spicy food', undefined, ['สั่ง (to order)']);
    expect(conversationOf(chat).words).toEqual(['สั่ง (to order)']);
    expect(conversationOf(startChat('th', 'Ordering', undefined, [])).words).toBeUndefined();
    expect(conversationOf(startChat('th', 'Ordering')).words).toBeUndefined();
    // A rehearsal with no words is still a rehearsal, which is what offers to keep its corrections.
    expect(startChat('th', 'Ordering', undefined, []).words).toEqual([]);
    expect(startChat('th', 'Ordering').words).toBeUndefined();
    // Played again, the scene keeps its words (the screen starts the new chat from the old one's).
    expect(startChat(chat.language, chat.scene, chat.focus, chat.words).words).toEqual(['สั่ง (to order)']);
  });
  it('turns a cram into route parameters and back', () => {
    const params = rehearsalParams('th', ' Ordering spicy food ', [{ text: 'สั่ง', english: 'to order' }, { text: ' ', english: 'blank' }, { text: 'เผ็ด', english: 'spicy' }]);
    expect(params.id).toBe('situations');
    expect(rehearsalOf(params)).toEqual({ language: 'th', scene: 'Ordering spicy food', words: ['สั่ง (to order)', 'เผ็ด (spicy)'], partner: 'tutor', prepared: [] });
  });
  it("carries a cram's talking points to the tutor, tidied, and sends them only to a tutor", () => {
    const prepared = ['Topic: Race day', '  You ask:  ครูวิ่งไหมครับ ', ' ', 'x'.repeat(PREPARED_LINE_MAX + 1), ...Array.from({ length: PREPARED_MAX }, (_, i) => `Line ${i}`)];
    const back = rehearsalOf(rehearsalParams('th', 'Race day', [], undefined, prepared));
    expect(back?.prepared.slice(0, 2)).toEqual(['Topic: Race day', 'You ask: ครูวิ่งไหมครับ']);
    expect(back?.prepared).toHaveLength(PREPARED_MAX);
    expect('prepared' in rehearsalParams('th', 'x', [])).toBe(false);
    expect(rehearsalOf({ language: 'th', scene: 'x', prepared: '{' })?.prepared).toEqual([]);
    const lines = ['You ask: a'];
    expect(conversationOf(startChat('th', 'x', undefined, [], undefined, 'tutor', lines)).prepared).toEqual(lines);
    expect('prepared' in conversationOf(startChat('th', 'x', undefined, [], undefined, 'scene', lines))).toBe(false);
    expect('prepared' in startChat('th', 'x', undefined, [], undefined, 'tutor', [])).toBe(false);
  });
  it('keeps to what the server takes', () => {
    const many = Array.from({ length: REHEARSAL_WORDS_MAX + 4 }, (_, i) => ({ text: `w${i}`, english: `m${i}` }));
    expect(rehearsalOf(rehearsalParams('th', 'x', many))?.words).toHaveLength(REHEARSAL_WORDS_MAX);
    const long = rehearsalOf(rehearsalParams('th', 'y'.repeat(300), [{ text: 'a'.repeat(REHEARSAL_WORD_MAX), english: 'long' }, { text: 'ok', english: 'fine' }]));
    expect(long?.scene).toHaveLength(200);
    expect(long?.words).toEqual(['ok (fine)']);
  });
  it('is no rehearsal without a scene or a language Read & Listen plays, and ignores unreadable words', () => {
    expect(rehearsalOf({ language: 'th', words: '[]' })).toBeUndefined();
    expect(rehearsalOf({ scene: 'x', words: '[]' })).toBeUndefined();
    expect(rehearsalOf({ language: 'xx', scene: 'x' })).toBeUndefined();
    expect(rehearsalOf({ language: 'th', scene: 'x', words: '{' })).toEqual({ language: 'th', scene: 'x', words: [], partner: 'tutor', prepared: [] });
    expect(rehearsalOf({ language: 'th', scene: 'x', words: '[1,"a (b)",""]' })?.words).toEqual(['a (b)']);
  });

  it("carries a cram's register through a rehearsal and into the request, and sends none when it follows Settings", () => {
    const params = rehearsalParams('th', 'Dinner with Nok', [], 'casual');
    expect(rehearsalOf(params)?.register).toBe('casual');
    expect(rehearsalOf(rehearsalParams('th', 'Dinner with Nok', []))?.register).toBeUndefined();
    expect(rehearsalOf({ ...params, register: 'slang' })?.register).toBeUndefined();
    expect(conversationOf(startChat('th', 'Dinner', undefined, undefined, 'casual')).register).toBe('casual');
    expect('register' in conversationOf(startChat('th', 'Dinner'))).toBe(false);
  });

  it("rehearses with the learner's tutor unless the route asks for a scene, and sends it only then", () => {
    const params = rehearsalParams('th', 'Race day and my time', []);
    expect(rehearsalOf(params)?.partner).toBe('tutor');
    expect(rehearsalOf({ ...params, partner: 'scene' })?.partner).toBe('scene');
    expect(rehearsalOf({ ...params, partner: 'nonsense' })?.partner).toBe('tutor');
    expect(conversationOf(startChat('th', 'Race day', undefined, [], undefined, 'tutor')).partner).toBe('tutor');
    expect('partner' in conversationOf(startChat('th', 'Race day', undefined, [], undefined, 'scene'))).toBe(false);
    expect('partner' in conversationOf(startChat('th', 'Race day'))).toBe(false);
  });
});

describe('the learner\'s polite ending', () => {
  it('goes to the server for Thai only', () => {
    expect(conversationOf(startChat('th', 'Dinner'), 'kha').particle).toBe('kha');
    expect('particle' in conversationOf(startChat('th', 'Dinner'))).toBe(false);
    expect('particle' in conversationOf(startChat('pl', 'Dinner'), 'kha')).toBe(false);
  });
});
