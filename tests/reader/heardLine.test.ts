import { describe, expect, it } from 'vitest';
import { sourceOf } from '../../src/core/examples';
import type { ReaderText, Word } from '../../src/reader/api';
import {
  NO_CLIP_FIELD_NOTE, canKeepClip, hasClip, heardIn, heardSource, heardTag, lineClipName, whereHeard, withClip, withHeard,
} from '../../src/reader/heardLine';

const w = (text: string): Pick<Word, 'text'> => ({ text });
const LINE = [w('Poproszę'), w(' '), w('kawę'), w(' '), w('z'), w(' '), w('mlekiem'), w('.')];

function text(over: Partial<ReaderText> = {}): Pick<ReaderText, 'id' | 'title' | 'lines' | 'video' | 'podcast'> {
  return {
    id: 12,
    title: 'W kawiarni',
    lines: [{ speaker: 'N', english: 'A coffee with milk, please.', words: LINE as Word[], audio: false }],
    podcast: { show: 'Polski z Anią', artwork: '', audio: 'https://cdn.example.com/1.mp3', times: [[4000, 6000]] },
    ...over,
  };
}

describe('where a word was heard', () => {
  it("writes the line with the word in bold, its translation and where it's from, as Source reads back", () => {
    const source = heardSource(LINE, 6, 'A coffee with milk, please.', 'Polski z Anią: W kawiarni');
    expect(source).toBe('Poproszę kawę z <b>mlekiem</b>.<br>A coffee with milk, please.<br>Polski z Anią: W kawiarni');
    const note = { id: '', deck: '', model: 'Omnilanguage', tags: [], fields: { Source: source } };
    expect(sourceOf(note)).toEqual({ line: 'Poproszę kawę z <b>mlekiem</b>.', translation: 'A coffee with milk, please.', where: 'Polski z Anią: W kawiarni' });
    // A phrase is one bold run.
    expect(heardSource(LINE, [2, 4], '', 'Show')).toBe('Poproszę <b>kawę z</b> mlekiem.<br>Show');
    // Markup in a line is text; a line with no translation has two lines.
    expect(heardSource([w('a<b')], null, '', 'Show')).toBe('a&lt;b<br>Show');
  });

  it("names a podcast by its show and a video by its channel, and tags both; a Read & Listen text by its title", () => {
    expect(whereHeard(text())).toBe('Polski z Anią: W kawiarni');
    expect(heardTag(text())).toBe('source::polski-z-anią');
    const video = text({ podcast: undefined, video: { id: 'x', channel: 'Easy Polish', generated: false, times: [[0, 1]] } });
    expect(whereHeard(video)).toBe('Easy Polish: W kawiarni');
    expect(heardTag(video)).toBe('source::easy-polish');
    const own = text({ podcast: undefined });
    expect(whereHeard(own)).toBe('W kawiarni');
    expect(heardTag(own)).toBeNull();
  });

  it("has a clip for a podcast's line and a Read & Listen text's, never a video's", () => {
    const heard = heardIn(text(), 0, 6)!;
    expect(heard).toMatchObject({ text_id: 12, line: 0, tag: 'source::polski-z-anią' });
    expect(hasClip(heard)).toBe(true);
    const own = (audio: boolean) => text({ podcast: undefined, lines: [{ speaker: 'N', english: '', words: LINE as Word[], audio }] });
    expect(hasClip(heardIn(own(true), 0, 6))).toBe(true);
    expect(hasClip(heardIn(own(false), 0, 6))).toBe(false);
    const video = heardIn(text({ podcast: undefined, video: { id: 'x', channel: 'C', generated: false, times: [[0, 1]] } }), 0, 6);
    expect(video).toMatchObject({ text_id: null, line: null });
    expect(hasClip(video)).toBe(false);
    expect(heardIn(text(), 3, 0)).toBeNull();
  });

  it("puts Source and the tag on a new note, and says under Source when its type can't keep the clip", () => {
    const heard = heardIn(text(), 0, 6)!;
    const note: { fields: Record<string, string>; tags?: string[]; fieldNotes?: Record<string, string> } = { fields: { Entry: 'mleko' }, tags: ['noun'] };
    const kept = withHeard(note, heard, ['Entry', 'Source', 'SourceAudio']);
    expect(kept.fields.Source).toBe(heard.source);
    expect(kept.tags).toEqual(['noun', 'source::polski-z-anią']);
    expect('fieldNotes' in kept).toBe(false);
    expect(withHeard(note, heard, ['Entry', 'Source']).fieldNotes).toEqual({ Source: NO_CLIP_FIELD_NOTE });
    // A video's line has no clip to miss, and a type not yet read says nothing either.
    expect('fieldNotes' in withHeard(note, { ...heard, text_id: null, line: null }, ['Entry', 'Source'])).toBe(false);
    expect('fieldNotes' in withHeard(note, heard, null)).toBe(false);
  });

  it('names a clip by its bytes and points SourceAudio at it', () => {
    const name = lineClipName(new Uint8Array([1, 2, 3]));
    expect(name).toMatch(/^franki-line-[0-9a-f]{16}\.mp3$/);
    expect(lineClipName(new Uint8Array([1, 2, 3]))).toBe(name);
    expect(withClip({ Entry: 'mleko', SourceAudio: '[sound:old.mp3]' }, name)).toEqual({ Entry: 'mleko', SourceAudio: `[sound:${name}]` });
    expect(canKeepClip(['Entry', 'SourceAudio'])).toBe(true);
    expect(canKeepClip(['Entry'])).toBe(false);
  });
});
