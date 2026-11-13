import { describe, expect, it } from 'vitest';
import { languageKey } from '../../src/core/voices';
import { LANGUAGES } from '../../src/reader/languages';
import { entryKey, recordingIndex, wordPlayback } from '../../src/reader/wordAudio';
import { omniNote } from '../support/fixtures';

const thai = (id: string, entry: string, audio: string) => ({ ...omniNote({ Entry: entry, Audio: audio }), id });

describe('recordingIndex', () => {
  it('maps a deck note\'s entry to its recording', () => {
    const index = recordingIndex([thai('a', 'หนังสือ', '[sound:book.mp3]')], 'th');
    expect(index.get('หนังสือ')).toBe('book.mp3');
  });

  it('leaves out notes with no recording and notes in another language', () => {
    const polish = { ...omniNote({ Entry: 'kot', Audio: '[sound:kot.mp3]', Language: 'Polish' }), id: 'p' };
    const index = recordingIndex([thai('a', 'หนังสือ', ''), polish], 'th');
    expect(index.size).toBe(0);
    expect(recordingIndex([polish], 'pl').get('kot')).toBe('kot.mp3');
  });

  it('ignores notes that are not Omnilanguage', () => {
    const basic = { id: 'b', deck: 'Thai', model: 'Basic', fields: { Front: 'หนังสือ', Back: 'book' }, tags: [] };
    expect(recordingIndex([basic], 'th').size).toBe(0);
  });

  it('keeps the first recording of a homograph', () => {
    const index = recordingIndex([thai('a', 'ไม้', '[sound:one.mp3]'), thai('b', 'ไม้', '[sound:two.mp3]')], 'th');
    expect(index.get('ไม้')).toBe('one.mp3');
  });
});

describe('LANGUAGES speech', () => {
  it('names each language\'s own voice language, the one its deck notes are read in', () => {
    for (const [code, info] of Object.entries(LANGUAGES)) expect(languageKey(info.speech)).toBe(code);
  });
});

describe('wordPlayback', () => {
  const index = recordingIndex([thai('a', 'หนังสือ', '[sound:book.mp3]')], 'th');

  it('plays the recording when the word has one', () => {
    expect(wordPlayback(index, 'หนังสือ')).toEqual({ file: 'book.mp3', text: 'หนังสือ' });
  });

  it('plays the entry\'s recording for the word capitalized to start a sentence', () => {
    const spanish = new Map([['casa', 'casa.mp3'], ['Madrid', 'madrid.mp3']]);
    expect(wordPlayback(spanish, 'Casa')).toEqual({ file: 'casa.mp3', text: 'Casa' });
    expect(wordPlayback(spanish, 'Madrid').file).toBe('madrid.mp3');
  });

  it('falls back to the text to speak', () => {
    expect(wordPlayback(index, 'ต่อมา')).toEqual({ file: undefined, text: 'ต่อมา' });
  });

  it('matches whatever the Unicode form or markup', () => {
    expect(entryKey('<b>  ก่  </b>')).toBe(entryKey('ก่'));
  });
});
