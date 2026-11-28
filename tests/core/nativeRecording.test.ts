import { describe, expect, it } from 'vitest';
import { canKeepNative, hasNative, nativeCandidates, nativeName, nextSpeaker, withNative, withoutNative } from '../../src/core/nativeRecording';
import { omniNote } from '../support/fixtures';

describe('a native recording on a note', () => {
  it('needs an Omnilanguage note with the credit field', () => {
    expect(canKeepNative(omniNote({ AudioCredit: '' }))).toBe(true);
    expect(canKeepNative(omniNote())).toBe(false);
    expect(canKeepNative({ model: 'Basic', fields: { Front: 'x', AudioCredit: '' } })).toBe(false);
  });

  it('replaces the recording, keeps other text, and keeps the credit', () => {
    const note = omniNote({ Audio: 'slow: [sound:franki-tts-a.mp3]', AudioCredit: '' });
    const fields = withNative(note, 'franki-native-b.mp3', 'X (Lingua Libre), CC0');
    expect(fields.Audio).toBe('slow: [sound:franki-native-b.mp3]');
    expect(fields.AudioCredit).toBe('X (Lingua Libre), CC0');
    expect(hasNative({ fields })).toBe(true);
    const back = withoutNative({ fields });
    expect([back.Audio, back.AudioCredit]).toEqual(['slow:', '']);
    expect(hasNative({ fields: back })).toBe(false);
  });

  it('names the file from the Commons file, the same each time', () => {
    expect(nativeName('File:Pl-kot.ogg')).toMatch(/^franki-native-[0-9a-f]{16}\.mp3$/);
    expect(nativeName('File:Pl-kot.ogg')).toBe(nativeName('File:Pl-kot.ogg'));
    expect(nativeName('File:Pl-kot.ogg')).not.toBe(nativeName('File:Pl-Kot.ogg'));
  });

  it('goes round the speakers found, from the one kept', () => {
    const found = [{ title: 'a', credit: 'A' }, { title: 'b', credit: 'B' }, { title: 'c', credit: 'C' }];
    expect(nextSpeaker(found, 'A')?.title).toBe('b');
    expect(nextSpeaker(found, 'C')?.title).toBe('a');
    expect(nextSpeaker(found, 'gone')?.title).toBe('a');
    expect(nextSpeaker([], 'A')).toBeUndefined();
  });
});

describe("a deck's words to look up", () => {
  it('takes words in a language that is on, with the field and no native recording yet', () => {
    const notes = [
      { ...omniNote({ Entry: 'หนังสือ', AudioCredit: '' }), id: 'a' },
      { ...omniNote({ Entry: 'แมว', AudioCredit: 'X (Lingua Libre), CC0' }), id: 'b' },
      { ...omniNote({ Entry: 'หมา' }), id: 'c' },
    ];
    const got = nativeCandidates(notes, () => true);
    expect(got.candidates.map((c) => [c.noteId, c.word, c.language])).toEqual([['a', 'หนังสือ', 'th']]);
    expect(got.noField).toBe(1);
    expect(nativeCandidates(notes, () => false)).toEqual({ candidates: [], noField: 1, off: ['th'] });
  });
});
