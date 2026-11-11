import { describe, expect, it } from 'vitest';
import { soundFiles } from '../../src/core/html';

describe('soundFiles', () => {
  it('lists the files [sound:] tags name, in order, ignoring empty ones', () => {
    expect(soundFiles('a [sound:one.mp3] b [sound: two words.ogg ][sound:]')).toEqual(['one.mp3', 'two words.ogg']);
    expect(soundFiles(undefined)).toEqual([]);
  });
});
