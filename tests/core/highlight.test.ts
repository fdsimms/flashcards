import { describe, expect, it } from 'vitest';
import { markSegments } from '../../src/core/highlight';

describe('markSegments', () => {
  it('finds a Thai word anywhere in an unspaced sentence', () => {
    expect(markSegments('ขอดมดอกไม้หน่อยครับ', 'ดม')).toEqual([
      { text: 'ขอ', marked: false },
      { text: 'ดม', marked: true },
      { text: 'ดอกไม้หน่อยครับ', marked: false },
    ]);
  });
  it('finds a romanized word between spaces', () => {
    expect(markSegments('khǎaw dom dòk-máai nòi khráp', 'dom').map((s) => s.text)).toEqual(['khǎaw ', 'dom', ' dòk-máai nòi khráp']);
  });
  it('needs a whole word in a spaced script, and ignores case', () => {
    expect(markSegments('A tomato, to be exact.', 'to')).toEqual([
      { text: 'A tomato, ', marked: false },
      { text: 'to', marked: true },
      { text: ' be exact.', marked: false },
    ]);
    expect(markSegments('Kot śpi.', 'kot')[0]).toEqual({ text: 'Kot', marked: true });
  });
  it('tries each of several words and returns the text unmarked when none is found', () => {
    expect(markSegments('Ich lese ein Buch.', 'Zeitung; Buch').find((s) => s.marked)?.text).toBe('Buch');
    expect(markSegments('Ich lese.', 'czytać')).toEqual([{ text: 'Ich lese.', marked: false }]);
    expect(markSegments('Ich lese.', '')).toEqual([{ text: 'Ich lese.', marked: false }]);
  });
});
