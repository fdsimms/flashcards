import { describe, expect, it } from 'vitest';
import { clearFormatting, formattedRuns, hasFormatting, toggleMark } from '../../src/core/formatting';

describe('bold, italic and underline in the editor', () => {
  it('wraps the selection in the tag, keeping it selected', () => {
    const r = toggleMark('the red cat', { start: 4, end: 7 }, 'b');
    expect(r).toEqual({ text: 'the <b>red</b> cat', selection: { start: 7, end: 10 } });
  });

  it('takes the tag away again, whether the selection is inside it or takes it in', () => {
    expect(toggleMark('the <b>red</b> cat', { start: 7, end: 10 }, 'b')).toEqual({ text: 'the red cat', selection: { start: 4, end: 7 } });
    expect(toggleMark('the <b>red</b> cat', { start: 4, end: 14 }, 'b')).toEqual({ text: 'the red cat', selection: { start: 4, end: 7 } });
    // Anki's editor writes <strong> and <em> too.
    expect(toggleMark('a <em>b</em>', { start: 6, end: 7 }, 'i').text).toBe('a b');
  });

  it('puts an empty pair at the cursor with nothing selected, the cursor inside it', () => {
    expect(toggleMark('ab', { start: 1, end: 1 }, 'u')).toEqual({ text: 'a<u></u>b', selection: { start: 4, end: 4 } });
  });

  it('takes formatting out of the selection, or the whole field, keeping the text', () => {
    const html = '<b>bold</b> and <i>it<u>al</u></i> <span style="color:red">red</span><br>x';
    expect(clearFormatting(html, { start: 0, end: 0 }).text).toBe('bold and ital red<br>x');
    expect(clearFormatting('a <b>b</b> <i>c</i>', { start: 0, end: 10 }).text).toBe('a b <i>c</i>');
  });

  it('reads a field back as styled runs, nested tags and line breaks included', () => {
    expect(formattedRuns('plain <b>bold <i>both</i></b> <U>under</U>\nline<br>next &amp; &lt;ok&gt;')).toEqual([
      { text: 'plain ', bold: false, italic: false, underline: false },
      { text: 'bold ', bold: true, italic: false, underline: false },
      { text: 'both', bold: true, italic: true, underline: false },
      { text: ' ', bold: false, italic: false, underline: false },
      { text: 'under', bold: false, italic: false, underline: true },
      { text: '\nline\nnext & <ok>', bold: false, italic: false, underline: false },
    ]);
  });

  it('previews only a field that has formatting', () => {
    expect(hasFormatting('just words\nand a line')).toBe(false);
    expect(hasFormatting('a <b>b</b>')).toBe(true);
    expect(hasFormatting('fish &amp; chips')).toBe(true);
  });
});
