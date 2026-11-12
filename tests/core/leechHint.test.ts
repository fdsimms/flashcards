import { describe, expect, it } from 'vitest';
import { canAddMnemonic, mnemonicQuestion, withMnemonic } from '../../src/core/leechHint';
import { omniNote } from '../support/fixtures';

describe('canAddMnemonic', () => {
  it('is true for an Omnilanguage note and false for another note type', () => {
    expect(canAddMnemonic(omniNote())).toBe(true);
    expect(canAddMnemonic({ id: 'b', deck: 'Trivia', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] })).toBe(false);
  });
});

describe('mnemonicQuestion', () => {
  it('names the word, its meaning, pronunciation and example, and the language', () => {
    const note = omniNote({ Entry: 'ทุก', Meaning: 'every; all', Transliteration: 'thúk', Context: '<div>ทุกคนชอบอาหารไทย</div>', Language: 'Thai' });
    expect(mnemonicQuestion(note)).toEqual({
      language: 'th', entry: 'ทุก', meaning: 'every; all', transliteration: 'thúk', context: 'ทุกคนชอบอาหารไทย',
    });
  });

  it('finds the language from the deck when the Language field is empty', () => {
    expect(mnemonicQuestion(omniNote({ Entry: 'ทุก', Meaning: 'all' }))?.language).toBe('th');
  });

  it('is undefined for a language Read & Listen does not write in, or a note with no entry', () => {
    expect(mnemonicQuestion(omniNote({ Entry: '犬', Meaning: 'dog', Language: 'Japanese' }))).toBeUndefined();
    expect(mnemonicQuestion(omniNote({ Entry: '', Meaning: 'all', Language: 'Thai' }))).toBeUndefined();
  });
});

describe('withMnemonic', () => {
  it('fills an empty Mnemonic', () => {
    expect(withMnemonic({ Mnemonic: '' }, ' Sounds like "took" ').Mnemonic).toBe('Sounds like "took"');
  });

  it('adds under a mnemonic already there instead of replacing it', () => {
    expect(withMnemonic({ Mnemonic: 'First.' }, 'Second.').Mnemonic).toBe('First.<br>Second.');
  });

  it('treats a Mnemonic of only markup as empty', () => {
    expect(withMnemonic({ Mnemonic: '<div><br></div>' }, 'New').Mnemonic).toBe('New');
  });

  it('escapes the text and keeps line breaks, since fields are HTML', () => {
    expect(withMnemonic({}, 'a < b & c\nd').Mnemonic).toBe('a &lt; b &amp; c<br>d');
  });

  it('leaves the fields as they were for a blank hint, and does not change the other fields', () => {
    const fields = { Entry: 'x', Mnemonic: 'm' };
    expect(withMnemonic(fields, '  ')).toBe(fields);
    expect(withMnemonic(fields, 'n').Entry).toBe('x');
  });
});
