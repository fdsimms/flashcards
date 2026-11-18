import { describe, expect, it } from 'vitest';
import { withFieldText } from '../../src/core/editField';
import { renderCard } from '../../src/core/cards';
import { omniNote } from '../support/fixtures';

describe('withFieldText', () => {
  it('replaces the field with the text, line breaks as <br> and markup characters escaped', () => {
    const fields = { Entry: 'derramar', Mnemonic: 'old' };
    expect(withFieldText(fields, 'Mnemonic', 'a < b & c\nsecond line')).toEqual({ Entry: 'derramar', Mnemonic: 'a &lt; b &amp; c<br>second line' });
  });

  it('returns the same fields, markup kept, when the text is what the card already shows', () => {
    const fields = { Mnemonic: 'I noticed the <b>sangre</b><br>get spilled' };
    expect(withFieldText(fields, 'Mnemonic', 'I noticed the sangre\nget spilled')).toBe(fields);
  });

  it('clears the field for a blank text', () => {
    expect(withFieldText({ Notes: 'Regular verb' }, 'Notes', '  \n ').Notes).toBe('');
  });

  it('sets a field the note had no value for', () => {
    expect(withFieldText({ Entry: 'x' }, 'Notes', 'hello').Notes).toBe('hello');
  });
});

describe('the blocks that can be edited in place', () => {
  it('name their field on the back of an Omnilanguage card, and only those two', () => {
    const note = omniNote({ Entry: 'derramar', Meaning: 'to spill', Mnemonic: 'I noticed the sangre get spilled', Notes: 'Regular -ar verb', Etymology: 'des- + ramar' });
    const blocks = renderCard(note, 'forward').back.blocks;
    expect(blocks.filter((b) => b.field).map((b) => [b.field, b.text])).toEqual([['Mnemonic', 'I noticed the sangre get spilled'], ['Notes', 'Regular -ar verb']]);
  });
});
