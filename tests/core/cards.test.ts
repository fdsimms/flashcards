import { describe, expect, it } from 'vitest';
import { autoplayFor, cardKindsFor, playbackFor, renderCard } from '../../src/core/cards';
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

  describe('where the recording plays, as the Omnilanguage templates put {{Audio}}', () => {
    const note = omniNote({ Audio: '[sound:a.mp3]', GenerateReverse: 'y', GenerateAudioCard: 'y' });
    const FILE = 'a.mp3';

    it('plays nothing by itself on the front of a forward or reverse card, and the recording when the answer is shown', () => {
      for (const kind of ['forward', 'reverse'] as const) {
        const r = renderCard(note, kind);
        expect(autoplayFor(r, false)).toBeUndefined();
        expect(autoplayFor(r, true)?.file).toBe(FILE);
      }
    });

    it('plays the recording on the front of the audio card', () => {
      expect(autoplayFor(renderCard(note, 'audio'), false)?.file).toBe(FILE);
    });

    it('keeps the recording off the Play button until the answer is shown', () => {
      const r = renderCard(note, 'forward');
      expect(playbackFor(r, false)?.file).toBeUndefined();
      expect(playbackFor(r, true)?.file).toBe(FILE);
      expect(playbackFor(renderCard(note, 'reverse'), false)).toBeUndefined();
    });

    it('speaks the front aloud when there is no recording, and the reverse word when its answer is shown', () => {
      const plain = omniNote({ Entry: 'kot', GenerateReverse: 'y' });
      expect(autoplayFor(renderCard(plain, 'forward'), false)?.text).toBe('kot');
      expect(autoplayFor(renderCard(plain, 'forward'), true)).toBeUndefined();
      expect(autoplayFor(renderCard(plain, 'reverse'), true)?.text).toBe('kot');
    });
  });
});
