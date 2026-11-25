import { describe, expect, it } from 'vitest';
import { missMnemonic } from '../../src/core/missMnemonic';
import { omniNote } from '../support/fixtures';

describe('missMnemonic', () => {
  const withHint = omniNote({ Entry: 'kot', Meaning: 'cat', Mnemonic: 'A cat sleeps in a <b>cot</b>.<br>Picture it.' });

  it('gives the word, meaning and mnemonic for a missed card', () => {
    expect(missMnemonic(withHint, 1, false)).toEqual({ word: 'kot', meaning: 'cat', mnemonic: 'A cat sleeps in a cot.\nPicture it.' });
  });
  it('shows nothing for Hard, Good or Easy', () => {
    for (const r of [2, 3, 4]) expect(missMnemonic(withHint, r, false)).toBeUndefined();
  });
  it('shows nothing for a filtered deck preview, where nothing was forgotten', () => {
    expect(missMnemonic(withHint, 1, true)).toBeUndefined();
  });
  it('shows nothing when the note has no mnemonic or only blank markup', () => {
    expect(missMnemonic(omniNote({ Mnemonic: '' }), 1, false)).toBeUndefined();
    expect(missMnemonic(omniNote({ Mnemonic: '<br> <div></div>' }), 1, false)).toBeUndefined();
  });
});
