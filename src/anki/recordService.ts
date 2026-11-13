import { needsRecording, recordingName, recordingText, RECORDING_RATE, withRecording } from '../core/recording';
import type { Note } from '../core/types';
import { sha1Hex } from './sha1';
import { saveNote, type NoteStore } from './noteService';

/**
 * Recording notes' audio (src/core/recording.ts): the text spoken by Read & Listen's server,
 * kept in the media folder, put on the list of files the next sync sends (so Anki and AnkiMobile
 * get it too), and the note's Audio field pointed at it the way any edit is saved (`saveNote`).
 */
export interface RecordDeps {
  store: NoteStore;
  /** The text as MP3, from Read & Listen's server (`Api.speech`). */
  speak(text: string, voice: string, rate: number): Promise<Uint8Array>;
  media: {
    exists(name: string): boolean;
    read(name: string): Promise<Uint8Array | undefined>;
    write(name: string, bytes: Uint8Array): Promise<void>;
    /** The SHA-1 the sync server last had for the file, if any. */
    recorded(name: string): Promise<string | undefined>;
    setPending(name: string, sha1: string): Promise<void>;
  };
}

/** A recording kept in the media folder: its name, and its SHA-1 for the list of files to send. */
export interface Recording {
  name: string;
  sha1: string;
}

/**
 * `text` spoken in `voice`, kept in the media folder. A file with the same text and voice already
 * here is used again rather than asked for. Nothing is sent yet (`sendRecording`), so a recording
 * made in the note editor and never saved stays on the phone.
 */
export async function makeRecording(deps: RecordDeps, text: string, voice: string): Promise<Recording> {
  const name = recordingName(text, voice);
  let bytes = deps.media.exists(name) ? await deps.media.read(name) : undefined;
  if (!bytes?.length) {
    bytes = await deps.speak(text, voice, RECORDING_RATE);
    await deps.media.write(name, bytes);
  }
  return { name, sha1: sha1Hex(bytes) };
}

/** Puts a recording on the list the next sync sends, unless the server already has it. */
export async function sendRecording(deps: RecordDeps, r: Recording): Promise<void> {
  if ((await deps.media.recorded(r.name)) !== r.sha1) await deps.media.setPending(r.name, r.sha1);
}

/**
 * Records one saved note's Entry in `voice` and saves the note with it. The note is read again
 * after the server answers, and left alone if it was deleted, given a recording or had its Entry
 * changed meanwhile. Returns the note as saved, or undefined when there was nothing to do.
 */
export async function recordNote(deps: RecordDeps, noteId: string, voice: string): Promise<Note | undefined> {
  const before = await deps.store.getNote(noteId);
  if (!before || !needsRecording(before)) return undefined;
  const text = recordingText(before);
  const recording = await makeRecording(deps, text, voice);

  const note = await deps.store.getNote(noteId);
  if (!note || !needsRecording(note) || recordingText(note) !== text) return undefined;
  const saved = await saveNote(deps.store, { id: note.id, deck: note.deck, model: note.model, fields: withRecording(note, recording.name), tags: note.tags });
  await sendRecording(deps, recording);
  return saved;
}

export interface RecordResult {
  recorded: number;
  /** Why it stopped early, if it did: the first failure, for the screen to word (`failureText`). */
  stopped?: unknown;
}

/**
 * Records notes one at a time, so Azure is never asked for many at once, telling `onProgress` how
 * many are done. Stops at the first failure (offline, Azure refusing), since the rest would fail
 * the same way, and when `cancelled` says the screen was left.
 */
export async function recordNotes(
  deps: RecordDeps,
  notes: { note: Note; voice: string }[],
  onProgress: (done: number) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<RecordResult> {
  let recorded = 0;
  for (const [i, { note, voice }] of notes.entries()) {
    if (cancelled()) break;
    try {
      if (await recordNote(deps, note.id, voice)) recorded++;
    } catch (e) {
      return { recorded, stopped: e };
    }
    onProgress(i + 1);
  }
  return { recorded };
}
