import { describe, expect, it } from 'vitest';
import { lineAt, loopBack, parsePlayerMessage, playerErrorText, playerHtml, videoIdOf, videoLength } from '../../src/reader/video';

const ID = 'dQw4w9WgXcQ';
const TIMES: [number, number][] = [[1000, 3000], [3000, 5500], [7000, 9000]];

describe('videos', () => {
  it('reads the id out of the links people share, as the server does', () => {
    for (const link of [`https://www.youtube.com/watch?v=${ID}`, `https://m.youtube.com/watch?feature=share&v=${ID}`, `https://youtu.be/${ID}?si=x`, `https://www.youtube.com/shorts/${ID}`, ` ${ID} `]) {
      expect(videoIdOf(link)).toBe(ID);
    }
    expect(videoIdOf('https://vimeo.com/1')).toBeNull();
    expect(videoIdOf('https://www.youtube.com/@channel')).toBeNull();
  });

  it('finds the line playing, keeping the last one between lines', () => {
    expect(lineAt(TIMES, 500)).toBe(-1);
    expect(lineAt(TIMES, 1000)).toBe(0);
    expect(lineAt(TIMES, 3000)).toBe(1);
    expect(lineAt(TIMES, 6000)).toBe(1);
    expect(lineAt(TIMES, 20000)).toBe(2);
  });

  it('loops a line back to its start once it has played past its end', () => {
    expect(loopBack(TIMES, 1, 4000)).toBeNull();
    expect(loopBack(TIMES, 1, 5600)).toBeNull();
    expect(loopBack(TIMES, 1, 5800)).toBe(3);
    // Sought away from it (a tap on another line turns the loop off first): back too.
    expect(loopBack(TIMES, 1, 500)).toBe(3);
    expect(loopBack(TIMES, 9, 500)).toBeNull();
  });

  it('says a length and what an error means', () => {
    expect(videoLength(522)).toBe('8:42');
    expect(videoLength(3725)).toBe('1:02:05');
    expect(playerErrorText(150)).toContain('Open it in YouTube');
    expect(playerErrorText(2)).toContain("couldn't play");
  });

  it('builds the player for an id only, and reads its messages leniently', () => {
    expect(playerHtml(ID)).toContain(`videoId:"${ID}"`);
    expect(() => playerHtml('"><script>')).toThrow();
    expect(parsePlayerMessage('{"type":"time","ms":1200}')).toEqual({ type: 'time', ms: 1200 });
    expect(parsePlayerMessage('{"type":"error","code":150}')).toEqual({ type: 'error', code: 150 });
    expect(parsePlayerMessage('{"type":"time"}')).toBeNull();
    expect(parsePlayerMessage('nope')).toBeNull();
  });
});
