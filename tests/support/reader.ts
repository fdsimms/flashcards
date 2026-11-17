import type { ReaderText, ShelfText } from '../../src/reader/api';
import type { SavedText } from '../../src/reader/downloads';

/** Read & Listen fixtures shared by the downloads and offline api tests. */
export const card = (over: Partial<ShelfText> = {}): ShelfText => ({
  id: 1, title: 'At the stall', topic: 'Food stall', topic_id: 1, form: 'dialogue', lines: 8,
  stretch: [], reason: 'new', coverage: 0.95, episode: 0, ...over,
});

export const readerText = (id: number, audio: boolean[] = [true, true]): ReaderText => ({
  id, topicId: 1, title: 'At the stall', coverage: 0.95, stretch: [], roles: {}, form: 'dialogue', language: 'pl', grammar: [],
  lines: audio.map((a) => ({ speaker: 'A' as const, english: 'Hi', words: [], audio: a })),
});

export const saved = (id: number, over: Partial<SavedText> = {}): SavedText => ({
  id, language: 'pl', text: readerText(id), card: card({ id }), lines: [0, 1], slow: {}, complete: true, bytes: 300_000, ...over,
});

