/**
 * Nothing in `src/` may start a sound without waking Bluetooth headphones first (`useOutputWake`,
 * src/ui/useOutputWake.ts).
 *
 * Headphones let their link sleep after a few seconds of quiet and lose the first half second or so
 * of the next sound while it wakes: all of a one-word recording, so the word is silent while the
 * player reports it playing. A file that plays a sound (`.play()` on a player, `Speech.speak`) uses
 * the wake. The check is by file, so it catches a new player, not a new call in a file that
 * already wakes; a sound that follows straight on from another (the next line of Play all) is
 * left to the call site. The few files that never start a sound after quiet are listed here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** Starting a player (`p.play()`, `player.current!.play()`) or the phone's voice. */
const PLAYS = /\.play\(\)|Speech\.speak\(/;
/** A call, not a mention in a comment. */
const WAKES = /\buseOutputWake\(\)/;

const EXEMPT: Record<string, string> = {
  'src/ui/useLessonLoop.ts': 'starts a looped lesson again as it ends, straight on from the sound before',
  'src/ui/reader/ReadWatch.tsx': "its play() is the pane's (VideoPane, EpisodePane), which waits for the wake itself",
  'src/core/template.ts': "the card page's own script, which runs in the WebView: its autoplay (START_AUTOPLAY) and its play buttons (soundTapped) wait for CardWebView's wake",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('sounds started without waking Bluetooth headphones', () => {
  const files = sourceFiles(SRC).map((f) => relative(ROOT, f).split('\\').join('/'));
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches every spelling it is meant to catch', () => {
    expect(PLAYS.test('player.play();')).toBe(true);
    expect(PLAYS.test('player.current!.play();')).toBe(true);
    expect(PLAYS.test('.then(() => p.play(), () => undefined)')).toBe(true);
    expect(PLAYS.test("Speech.speak(text, { language: 'th-TH' })")).toBe(true);
    expect(PLAYS.test('phone.sayWord(text, lang)')).toBe(false);
    expect(PLAYS.test('player.playing')).toBe(false);
  });

  it('finds none in src/ but the exempt files', () => {
    const hits = files.filter((f) => !(f in EXEMPT) && f !== 'src/ui/useOutputWake.ts' && PLAYS.test(read(f)) && !WAKES.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('lists no exempt file that has stopped needing it', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !PLAYS.test(read(f)) || WAKES.test(read(f)));
    expect(stale).toEqual([]);
  });
});
