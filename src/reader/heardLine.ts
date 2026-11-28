// Where a word added to the deck was heard (docs/read-and-listen/architecture.md, "The speaker's
// voice"): the line it came from, with the word in bold, its translation and where it's from, in the
// note's Source (the house style server/mcp's note_guide describes), and the line as it was said in
// SourceAudio, a clip the server cuts from a podcast's episode or a Read & Listen text's own recording.
// A video's line has no clip: YouTube's player doesn't let its sound be taken. Pure, so it's tested;
// src/ui/useLineClip.ts fetches and keeps the clip once the note is saved.
import { sha1Hex } from '../anki/sha1';
import type { QueuedHeard, ReaderText, Word } from './api';

/** The note type's field for the clip. A note type without it keeps the line in Source and no clip. */
export const SOURCE_AUDIO_FIELD = 'SourceAudio';

/** Where a word was heard, as the note queue keeps it (`QueuedHeard`). */
export type Heard = QueuedHeard;

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Which words of the line were added: one word's index, or a phrase's first and last; null for none. */
export type HeardWords = number | readonly [number, number] | null;

/**
 * The note's Source: the line as it was said with the word or phrase added (`bold`, by index in `words`)
 * in bold, its translation, and where it's from, one to a line (`<br>`), as `sourceOf`
 * (src/core/examples.ts) reads it back. A line with no translation leaves that line out.
 */
export function heardSource(words: readonly Pick<Word, 'text'>[], bold: HeardWords, english: string, where: string): string {
  const [from, to] = bold === null ? [-1, -1] : typeof bold === 'number' ? [bold, bold] : bold;
  const part = (a: number, b: number) => words.slice(a, b).map((w) => escapeHtml(w.text)).join('');
  const marked = from >= 0 && to >= from && to < words.length ? part(from, to + 1) : '';
  const line = (marked.trim() ? `${part(0, from)}<b>${marked}</b>${part(to + 1, words.length)}` : part(0, words.length)).trim();
  return [line, escapeHtml(english.trim()), escapeHtml(where.trim())].filter(Boolean).join('<br>');
}

type Origin = Pick<ReaderText, 'title' | 'video' | 'podcast'>;

/** Where a text's line was heard: the show or channel and the episode or video, or a Read & Listen text's own title. */
export function whereHeard(text: Origin): string {
  const by = text.podcast?.show ?? text.video?.channel;
  return by && by.trim() !== text.title.trim() ? `${by.trim()}: ${text.title.trim()}` : text.title.trim();
}

/**
 * The note's tag for where it was heard: `source::` and the show's or channel's name in lowercase words
 * joined by hyphens, as server/mcp's `source_tag` writes it (its lint checks the spelling). Null for a
 * Read & Listen text, which isn't somewhere the learner went.
 */
export function heardTag(text: Origin): string | null {
  const by = text.podcast?.show ?? text.video?.channel;
  if (!by) return null;
  const words = by.trim().toLowerCase().split(/[\s_\-]+|::/).filter(Boolean);
  return words.length ? `source::${words.join('-')}` : null;
}

/** Where the word or phrase at `bold` of the text's line `line` was heard, for the note editor and the note queue. */
export function heardIn(text: Origin & Pick<ReaderText, 'id' | 'lines'>, line: number, bold: HeardWords): Heard | null {
  const at = text.lines[line];
  if (!at) return null;
  // A podcast's line is cut from the episode; a Read & Listen text's is its recording, where it has one
  // (a language with no voice, Toki Pona, has none).
  const clip = !text.video && (!!text.podcast || at.audio);
  return {
    source: heardSource(at.words, bold, at.english, whereHeard(text)),
    text_id: clip ? text.id : null,
    line: clip ? line : null,
    tag: heardTag(text) ?? '',
  };
}

/** Whether a heard line has a clip to keep: a podcast's line or a recorded Read & Listen text's, not a video's. */
export const hasClip = (heard: Heard | null | undefined): heard is Heard & { text_id: number; line: number } =>
  !!heard && heard.text_id !== null && heard.line !== null;

/** Whether notes of a type with these fields can keep a clip. */
export const canKeepClip = (fields: readonly string[]): boolean => fields.includes(SOURCE_AUDIO_FIELD);

/** The media file a line's clip is kept in, named by its bytes so the same clip is one file. */
export function lineClipName(bytes: Uint8Array): string {
  return `franki-line-${sha1Hex(bytes).slice(0, 16)}.mp3`;
}

/** What the note editor says under Source when the note type has nowhere to keep the line's clip. */
export const NO_CLIP_FIELD_NOTE =
  "The line's clip isn't kept: your Omnilanguage note type has no SourceAudio field yet. Ask Claude to add it with the MCP's add_field, after syncing every device.";

/** A new note's Source, tag and, where its type can't keep the clip, a note under Source saying so. */
export function withHeard<T extends { fields: Record<string, string>; tags?: string[]; fieldNotes?: Record<string, string> }>(
  note: T,
  heard: Heard,
  typeFields: readonly string[] | null,
): T {
  const tags = heard.tag && !(note.tags ?? []).includes(heard.tag) ? [...(note.tags ?? []), heard.tag] : note.tags;
  const noField = hasClip(heard) && typeFields !== null && !canKeepClip(typeFields);
  return {
    ...note,
    fields: { ...note.fields, Source: heard.source },
    ...(tags ? { tags } : {}),
    ...(noField ? { fieldNotes: { ...note.fieldNotes, Source: NO_CLIP_FIELD_NOTE } } : {}),
  };
}

/** The note's fields with `name` as its SourceAudio, in place of any clip there. */
export function withClip(fields: Record<string, string>, name: string): Record<string, string> {
  return { ...fields, [SOURCE_AUDIO_FIELD]: `[sound:${name}]` };
}
