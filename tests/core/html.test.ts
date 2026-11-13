import { describe, expect, it } from 'vitest';
import { htmlToText, soundFiles } from '../../src/core/html';

describe('soundFiles', () => {
  it('lists the files [sound:] tags name, in order, ignoring empty ones', () => {
    expect(soundFiles('a [sound:one.mp3] b [sound: two words.ogg ][sound:]')).toEqual(['one.mp3', 'two words.ogg']);
    expect(soundFiles(undefined)).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('reads numeric character references, as a plain-text CSV import writes an apostrophe', () => {
    expect(htmlToText('l&#x27;eau &#39;n&#233; &amp; &#X2014; &#0; &bogus;')).toBe("l'eau 'né & \u2014 &#0; &bogus;");
  });
});
