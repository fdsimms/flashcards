import { azureVoiceName } from '../core/voices';
import type { AzureVoice, CastKind, CastVoice, Language, Settings } from './api';
import type { Gender } from './voiceSlots';

/**
 * Read & Listen's story characters have voices of their own: each is given the voice and pitch the
 * server has for their kind (a girl, an older man...), chosen here, and keeps it in every episode of
 * the story. This is what the Story characters screens show and offer. The server picks the voice
 * of a second character of one kind, so two girls in a story don't sound alike.
 */

export const CAST_KINDS: { kind: CastKind; gender: Gender; label: string }[] = [
  { kind: 'man', gender: 'male', label: 'Man' },
  { kind: 'woman', gender: 'female', label: 'Woman' },
  { kind: 'boy', gender: 'male', label: 'Boy' },
  { kind: 'girl', gender: 'female', label: 'Girl' },
  { kind: 'elder_man', gender: 'male', label: 'Older man' },
  { kind: 'elder_woman', gender: 'female', label: 'Older woman' },
];

export function castInfo(kind: CastKind) {
  return CAST_KINDS.find((k) => k.kind === kind)!;
}

/** Whether `kind` is a kind of character (a route's parameter is any string). */
export function isCastKind(kind: string | undefined): kind is CastKind {
  return CAST_KINDS.some((k) => k.kind === kind);
}

// The server's limits: a pitch beyond them stops sounding like the same voice.
export const PITCH_MIN = -30;
export const PITCH_MAX = 35;
export const PITCH_STEP = 2;

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(pitch)));
}

/** "+18%", "−8%" (a real minus sign) and "0%". */
export function pitchLabel(pitch: number): string {
  if (pitch === 0) return '0%';
  return `${pitch > 0 ? '+' : '−'}${Math.abs(pitch)}%`;
}

/** What a kind's row says: "Dmitry, +10%", or just the voice at no change. */
export function castDetail(choice: CastVoice): string {
  const name = azureVoiceName(choice.voice);
  return choice.pitch === 0 ? name : `${name}, ${pitchLabel(choice.pitch)}`;
}

/** The language's story voices, or undefined from a server that doesn't have them yet (or lacks a kind). */
export function castFor(settings: Pick<Settings, 'cast'> | null | undefined, language: Language): Record<CastKind, CastVoice> | undefined {
  const cast = settings?.cast?.[language];
  return cast && CAST_KINDS.every((k) => cast[k.kind] && typeof cast[k.kind].voice === 'string') ? cast : undefined;
}

/** The voices a kind can be given: those of its gender. A voice Azure doesn't give a gender is left out. */
export function voicesForKind(voices: AzureVoice[], kind: CastKind): AzureVoice[] {
  const gender = castInfo(kind).gender;
  return voices.filter((v) => v.gender?.toLowerCase() === gender);
}

/** Whether Azure says the voice reads any language, as a Multilingual voice does. */
export function isMultilingual(voice: string): boolean {
  return voice.includes('Multilingual');
}

/** What the audition lists: the kind's voices, or only the Multilingual ones among them. */
export type AuditionFilter = 'all' | 'multilingual';

export function auditionVoices(voices: AzureVoice[], kind: CastKind, filter: AuditionFilter): AzureVoice[] {
  const ofKind = voicesForKind(voices, kind);
  return filter === 'multilingual' ? ofKind.filter((v) => isMultilingual(v.voice)) : ofKind;
}

/** Every kind put back to the server's own pick, as the change that says so. */
export function resetChange(language: Language): { cast: Partial<Record<Language, Record<CastKind, null>>> } {
  return { cast: { [language]: Object.fromEntries(CAST_KINDS.map((k) => [k.kind, null])) as Record<CastKind, null> } };
}

/** What a sample or a scene sounds like, for the cache folder's file name: the same voices and pitches are the same audio. */
export function audioKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p).replace(/[^A-Za-z0-9-]/g, '_')).join('-');
}
