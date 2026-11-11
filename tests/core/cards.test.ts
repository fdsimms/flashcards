import { describe, expect, it } from 'vitest';
import { cardKindsFor, renderCard } from '../../src/core/cards';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

describe('cards', () => {
  it('gates reverse/audio cards on the Generate* fields', () => {
    expect(cardKindsFor(omniNote())).toEqual(['forward']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y' }))).toEqual(['forward', 'reverse']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y', GenerateAudioCard: 'y' }))).toEqual(['forward', 'reverse', 'audio']);
    expect(cardKindsFor(omniNote({ SuppressFrontCard: 'y', GenerateAudioCard: 'y' }))).toEqual(['audio']);
  });
  it('renders forward front as the entry and speaks it in the right language', () => {
    const r = renderCard(omniNote(), 'forward');
    expect(r.front.blocks[0].text).toBe('หนังสือ');
    expect(r.front.speak).toBe('หนังสือ');
    expect(r.speechLang).toBe('th-TH');
    expect(r.back.blocks.map((b) => b.text)).toContain('book');
  });
  it('strips HTML and sound tags', () => {
    const r = renderCard(omniNote({ Meaning: 'a <b>book</b><br>(noun) [sound:x.mp3]' }), 'forward');
    expect(r.back.blocks.find((b) => b.text.startsWith('a book'))?.text).toBe('a book\n(noun)');
  });
  it('renders plain Front/Back notes for trivia', () => {
    const note: Note = { id: 't', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru?', Back: 'Lima' }, tags: [] };
    const r = renderCard(note, 'forward');
    expect(r.front.blocks[0].text).toBe('Capital of Peru?');
    expect(r.back.blocks[0].text).toBe('Lima');
  });

  it("names the note's recorded audio, for playing in place of text-to-speech", () => {
    const withAudio = omniNote({ Audio: '[sound:hypertts-cbb27612.mp3]' });
    for (const kind of ['forward', 'reverse', 'audio'] as const) {
      expect(renderCard(withAudio, kind).audioFile).toBe('hypertts-cbb27612.mp3');
    }
    expect(renderCard(omniNote(), 'forward').audioFile).toBeUndefined();
  });
});
