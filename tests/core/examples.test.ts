import { describe, expect, it } from 'vitest';
import { examplesOf, fieldLines, firstExample } from '../../src/core/examples';
import { omniNote } from '../support/fixtures';

describe('fieldLines', () => {
  it('splits a field at <br>, the end of a <div> or <p>, and a newline', () => {
    expect(fieldLines('a<br>b<br/>c')).toEqual(['a', 'b', 'c']);
    expect(fieldLines('<div>a</div><div>b</div>')).toEqual(['a', 'b']);
    expect(fieldLines('<p>a</p><p>b</p>')).toEqual(['a', 'b']);
    expect(fieldLines('a\nb')).toEqual(['a', 'b']);
  });
  it('keeps blank lines in the middle, so lines of two fields stay paired, and drops blank ones at the end', () => {
    expect(fieldLines('a<br><br>c<br>')).toEqual(['a', '', 'c']);
    expect(fieldLines(undefined)).toEqual([]);
  });
  it('keeps a line\'s own markup, such as the bold that marks the word', () => {
    expect(fieldLines('Die <b>Einstellungen</b> sind da<br>Zwei')).toEqual(['Die <b>Einstellungen</b> sind da', 'Zwei']);
  });
});

describe('examplesOf', () => {
  it('is the three Context fields as written when ContextLabels is empty, even over several lines', () => {
    const note = omniNote({ Context: 'one<br>two', ContextRomanized: 'r1<br>r2', ContextTranslation: 't1<br>t2' });
    expect(examplesOf(note)).toEqual([{ context: 'one<br>two', romanized: 'r1<br>r2', translation: 't1<br>t2', tag: '' }]);
    expect(examplesOf(omniNote({ ContextLabels: '<br>' }))).toHaveLength(1);
  });
  it('is one example per line of Context when ContextLabels has something in it, paired by line number', () => {
    const note = omniNote({ Context: 'one<br>two', ContextRomanized: 'r1<br>r2', ContextTranslation: 't1<br>t2', ContextLabels: 'skill<br>event' });
    expect(examplesOf(note)).toEqual([
      { context: 'one', romanized: 'r1', translation: 't1', tag: 'skill' },
      { context: 'two', romanized: 'r2', translation: 't2', tag: 'event' },
    ]);
  });
  it('allows an example with no tag, no romanization or no translation, and skips a blank Context line', () => {
    const note = omniNote({ Context: 'one<br><br>three', ContextRomanized: 'r1', ContextTranslation: 't1<br>t2<br>t3', ContextLabels: '<br><br>event' });
    expect(examplesOf(note)).toEqual([
      { context: 'one', romanized: 'r1', translation: 't1', tag: '' },
      { context: 'three', romanized: '', translation: 't3', tag: 'event' },
    ]);
  });
  it('falls back to the fields as written when ContextLabels is set but Context is empty', () => {
    expect(examplesOf(omniNote({ Context: '', ContextLabels: 'skill' }))).toEqual([{ context: '', romanized: '', translation: '', tag: '' }]);
  });
  it('gives the first example for what asks about "the sentence"', () => {
    const note = omniNote({ Context: 'one<br>two', ContextTranslation: 't1<br>t2', ContextLabels: 'a<br>b' });
    expect(firstExample(note)).toMatchObject({ context: 'one', translation: 't1' });
  });
});
