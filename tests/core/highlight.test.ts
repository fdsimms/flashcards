import { describe, expect, it } from 'vitest';
import { fieldSegments, markSegments } from '../../src/core/highlight';

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

describe('fieldSegments', () => {
  it('highlights the words the note puts in bold, as written', () => {
    expect(fieldSegments('Die <b>Einstellungen</b> sind im Menü.', 'die Einstellung')).toEqual([
      { text: 'Die ', marked: false },
      { text: 'Einstellungen', marked: true },
      { text: ' sind im Menü.', marked: false },
    ]);
  });
  it('highlights every bold piece of a split verb, and reads <strong> too', () => {
    expect(fieldSegments('Er <strong>warf</strong> seinen Mantel <b class="x">ab</b>.', 'abwerfen').filter((s) => s.marked).map((s) => s.text))
      .toEqual(['warf', 'ab']);
  });
  it('turns the rest of the HTML into text as a card shows it', () => {
    expect(fieldSegments('Ich&nbsp;<b>lese</b><br>gern.', 'lesen')).toEqual([
      { text: 'Ich ', marked: false },
      { text: 'lese', marked: true },
      { text: '\ngern.', marked: false },
    ]);
  });
  it('falls back to finding the word when nothing is bold', () => {
    expect(fieldSegments('Kot <i>śpi</i>.', 'kot')).toEqual([{ text: 'Kot', marked: true }, { text: ' śpi.', marked: false }]);
    expect(fieldSegments(undefined, 'kot')).toEqual([{ text: '', marked: false }]);
  });
});
