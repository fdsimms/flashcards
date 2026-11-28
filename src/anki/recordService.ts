import { needsRecording, recordingName, recordingRequest, recordingText, RECORDING_RATE, withRecording, type RecordingRequest } from '../core/recording';
import { canKeepNative, nativeName, withNative } from '../core/nativeRecording';
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
  /**
   * The text as MP3, from Read & Listen's server (`Api.speech`). `language` is the text's (th-TH), for a
   * Multilingual voice, which reads any language and would otherwise guess it from the text. `reading` is a
   * Japanese word's KanaReading (`recordingRequest`).
   */
  speak(text: string, voice: string, rate: number, language?: string, reading?: string): Promise<Uint8Array>;
  /**
   * A native speaker's recording of the note's word, where native recordings are on for its language and
   * Wikimedia Commons has one (src/core/nativeRecording.ts): its Commons file's title, its credit and the
   * audio. Null when there's none to keep; absent while native recordings are off.
   */
  native?(note: Note): Promise<NativeFound | null>;
  media: {
    exists(name: string): boolean;
    read(name: string): Promise<Uint8Array | undefined>;
    write(name: string, bytes: Uint8Array): Promise<void>;
    /** The SHA-1 the sync server last had for the file, if any. */
    recorded(name: string): Promise<string | undefined>;
    setPending(name: string, sha1: string): Promise<void>;
  };
}

export interface NativeFound {
  title: string;
  credit: string;
  bytes: Uint8Array;
}

/** A recording kept in the media folder: its name, and its SHA-1 for the list of files to send. */
export interface Recording {
  name: string;
  sha1: string;
}

/**
 * A note's text (`recordingRequest`) spoken in `voice`, kept in the media folder. A file with the same text,
 * voice and reading already here is used again rather than asked for. Nothing is sent yet (`sendRecording`),
 * so a recording made in the note editor and never saved stays on the phone.
 */
export async function makeRecording(deps: RecordDeps, request: RecordingRequest, voice: string): Promise<Recording> {
  const { text, language, reading } = request;
  const name = recordingName(text, voice, RECORDING_RATE, reading);
  let bytes = deps.media.exists(name) ? await deps.media.read(name) : undefined;
  if (!bytes?.length) {
    bytes = await deps.speak(text, voice, RECORDING_RATE, language, reading);
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
  const request = recordingRequest(before);
  const text = request.text;
  // A native speaker's recording first, where there's one to keep; else Azure's, as before. Commons out of
  // reach isn't a failure: the word still gets a recording.
  if (deps.native && canKeepNative(before)) {
    const found = await deps.native(before).catch(() => null);
    if (found) {
      const kept = await keepNative(deps, noteId, text, found);
      if (kept !== null) return kept;
    }
  }
  const recording = await makeRecording(deps, request, voice);

  const note = await deps.store.getNote(noteId);
  if (!note || !needsRecording(note) || recordingText(note) !== text) return undefined;
  const saved = await saveNote(deps.store, { id: note.id, deck: note.deck, model: note.model, fields: withRecording(note, recording.name), tags: note.tags });
  await sendRecording(deps, recording);
  return saved;
}

/**
 * Keeps a native recording in the note: the file in the media folder, the note's Audio pointed at it and
 * its credit in AudioCredit, the way any edit is saved. Read again first, and left alone (null) if it was
 * deleted, given a recording or had its word changed meanwhile.
 */
export async function keepNative(deps: RecordDeps, noteId: string, text: string, found: NativeFound): Promise<Note | null> {
  const name = nativeName(found.title);
  if (!deps.media.exists(name)) await deps.media.write(name, found.bytes);
  const note = await deps.store.getNote(noteId);
  if (!note || !needsRecording(note) || recordingText(note) !== text || !canKeepNative(note)) return null;
  const saved = await saveNote(deps.store, { id: note.id, deck: note.deck, model: note.model, fields: withNative(note, name, found.credit), tags: note.tags });
  await sendRecording(deps, { name, sha1: sha1Hex(found.bytes) });
  return saved;
}

/**
 * Puts a native recording in place of a note's recording now (Deck options' Native recordings): the file
 * kept, Audio and AudioCredit set, as any edit is saved. Left alone (null) when the note was deleted or
 * its Audio or credit changed since `was` was read, so a change made meanwhile isn't written over.
 */
export async function replaceWithNative(deps: RecordDeps, noteId: string, was: { audio: string; credit: string }, found: NativeFound): Promise<Note | null> {
  const name = nativeName(found.title);
  if (!deps.media.exists(name)) await deps.media.write(name, found.bytes);
  const note = await deps.store.getNote(noteId);
  if (!note || !canKeepNative(note) || (note.fields.Audio ?? '') !== was.audio || (note.fields.AudioCredit ?? '') !== was.credit) return null;
  const saved = await saveNote(deps.store, { id: note.id, deck: note.deck, model: note.model, fields: withNative(note, name, found.credit), tags: note.tags });
  await sendRecording(deps, { name, sha1: sha1Hex(found.bytes) });
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
