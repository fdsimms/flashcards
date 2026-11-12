import { strToU8 } from 'fflate';
import { isOmnilanguage, speechLangFor } from './cards';
import { htmlToText, soundFiles } from './html';
import { sha1Hex } from '../anki/sha1';
import type { Note } from './types';
import { languageKey, type VoiceSettings } from './voices';

/**
 * Recording a card's audio with an Azure voice (Settings > Voices), through Read & Listen's
 * server, into the note's Audio field as Anki keeps it ([sound:name.mp3]), so Franki, Anki and
 * AnkiMobile all play the recording. Only Omnilanguage notes: theirs is the Audio field Review
 * plays (`RenderedCard.audioFile`).
 */

/** Recordings are made at normal speed; how fast they play is the player's. */
export const RECORDING_RATE = 1;

/** What's read aloud: the Entry, as Review reads it with the phone's voice. */
export function recordingText(note: Note): string {
  return htmlToText(note.fields.Entry ?? '').replace(/\s+/g, ' ').trim();
}

/** Whether a note can be recorded and has no recording yet. */
export function needsRecording(note: Note): boolean {
  return isOmnilanguage(note) && !soundFiles(note.fields.Audio).length && !!recordingText(note) && !!speechLangFor(note);
}

/** The Azure voice chosen to record a note's language with, if one is. */
export function recordingVoice(note: Note, settings: VoiceSettings): string | undefined {
  const lang = speechLangFor(note);
  return lang ? settings[languageKey(lang)]?.azureVoice : undefined;
}

/** Python's str() of a float, which the MCP's file names are made with: 1.0, 0.9. */
function pyFloat(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

/**
 * The file a recording is kept in, named as the MCP's `add_tts_audio` names its own
 * (server/mcp/franki_mcp/speech.py, `audio_filename`): the same text in the same voice and speed
 * gets the same file, whichever made it.
 */
export function recordingName(text: string, voice: string, rate = RECORDING_RATE): string {
  return `franki-tts-${sha1Hex(strToU8(`${voice}\n${pyFloat(rate)}\n${text}`)).slice(0, 16)}.mp3`;
}

/** The note's fields with the recording added to Audio, after any text already there. */
export function withRecording(note: Note, name: string): Record<string, string> {
  const audio = (note.fields.Audio ?? '').trim();
  return { ...note.fields, Audio: audio ? `${audio} [sound:${name}]` : `[sound:${name}]` };
}

export interface RecordingPlan {
  /** Notes that can be recorded now, each with its voice. */
  ready: { note: Note; voice: string }[];
  /** Notes without a recording in a language with no Azure voice chosen, by language key. */
  noVoice: Map<string, number>;
}

/** Of `notes`, which would be recorded and which can't be until their language has a voice. */
export function planRecordings(notes: Note[], settings: VoiceSettings): RecordingPlan {
  const plan: RecordingPlan = { ready: [], noVoice: new Map() };
  for (const note of notes) {
    if (!needsRecording(note)) continue;
    const voice = recordingVoice(note, settings);
    if (voice) plan.ready.push({ note, voice });
    else {
      const key = languageKey(speechLangFor(note)!);
      plan.noVoice.set(key, (plan.noVoice.get(key) ?? 0) + 1);
    }
  }
  return plan;
}
