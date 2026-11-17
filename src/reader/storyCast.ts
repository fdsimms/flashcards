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

/** A kind of Azure voice named in its id, beyond the plain Neural ones. */
export type VoiceFamily = 'hd' | 'hd-flash' | 'hd-omni' | 'mai' | 'mai-flash';

/** The family of a voice from its id (en-US-Ava:DragonHDLatestNeural, en-AU-Isla:MAI-Voice-2-Flash), or none for a plain one. */
export function voiceFamily(voice: string): VoiceFamily | undefined {
  if (voice.includes('DragonHDOmni')) return 'hd-omni';
  if (voice.includes('DragonHDFlash')) return 'hd-flash';
  if (voice.includes('DragonHD')) return 'hd';
  if (voice.includes('MAI-Voice')) return voice.includes('Flash') ? 'mai-flash' : 'mai';
  return undefined;
}

// What each family is, as Microsoft describes them (learn.microsoft.com, Azure Speech, high definition voices).
const FAMILIES: Record<VoiceFamily, { tag: string; note: string }> = {
  hd: { tag: 'HD', note: 'HD (Dragon HD): high definition voices. They read the whole text for context and set the tone to match it.' },
  'hd-flash': { tag: 'HD Flash', note: 'Flash: a lighter HD voice that is made quickly, for fast replies.' },
  'hd-omni': { tag: 'HD Omni', note: 'Omni: a newer HD model that Microsoft is rolling out.' },
  mai: { tag: 'MAI', note: "MAI: voices made by Microsoft AI, separate from the HD ones. Standard MAI voices are for expressive, longer reading." },
  'mai-flash': { tag: 'MAI Flash', note: 'MAI Flash: the quick, low-delay version of an MAI voice.' },
};

/** The short tag a voice's row shows (HD Omni), or none for a plain voice. */
export function voiceTag(voice: string): string | undefined {
  const family = voiceFamily(voice);
  return family && FAMILIES[family].tag;
}

/**
 * What the qualifiers in these voices' names mean, one line for each kind present, so a list is
 * explained only by what's in it. Empty when they are all plain voices.
 */
export function voiceNotes(voices: { voice: string }[]): string[] {
  const present = new Set(voices.map((v) => voiceFamily(v.voice)));
  const notes = (Object.keys(FAMILIES) as VoiceFamily[]).filter((f) => present.has(f)).map((f) => FAMILIES[f].note);
  if (present.has('hd') || present.has('hd-flash') || present.has('hd-omni')) notes.push('Latest in a name means Microsoft updates the voice as new versions come out.');
  return notes;
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
