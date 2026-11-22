import { describe, expect, it } from 'vitest';
import { deleteNotesTitle, selectedText, stillListed, toggled } from '../../src/core/selection';

describe('selection', () => {
  it('picks a row and puts it back, leaving the old set alone', () => {
    const none = new Set<string>();
    const one = toggled(none, 'a');
    expect([...one]).toEqual(['a']);
    expect(none.size).toBe(0);
    expect(toggled(one, 'a').size).toBe(0);
  });

  it('drops rows that left the list', () => {
    expect([...stillListed(new Set(['a', 'b', 'c']), ['b', 'c', 'd'])]).toEqual(['b', 'c']);
  });

  it('words the bar and the delete question', () => {
    expect(selectedText(0)).toBe('Nothing selected');
    expect(selectedText(3)).toBe('3 selected');
    expect(deleteNotesTitle(1)).toBe('Delete this note?');
    expect(deleteNotesTitle(4)).toBe('Delete 4 notes?');
  });
});
