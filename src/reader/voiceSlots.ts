import { azureVoiceName } from '../core/voices';
import type { AzureVoice, Language, Speakers, VoiceSlot } from './api';

/**
 * Read & Listen's voices are chosen by gender: each text says whether its speakers are men or
 * women, and the server reads each in a voice of that gender. The second voice of a gender is for a
 * dialogue between two men or two women. This is what the voice screens show and offer.
 */

export type Gender = 'male' | 'female';

export const VOICE_SLOTS: { slot: VoiceSlot; gender: Gender; label: string }[] = [
  { slot: 'male', gender: 'male', label: 'Man' },
  { slot: 'male2', gender: 'male', label: 'Second man' },
  { slot: 'female', gender: 'female', label: 'Woman' },
  { slot: 'female2', gender: 'female', label: 'Second woman' },
];

export function slotInfo(slot: VoiceSlot) {
  return VOICE_SLOTS.find((s) => s.slot === slot)!;
}

/** Whether `slot` is a voice slot (a route's parameter is any string). */
export function isVoiceSlot(slot: string | undefined): slot is VoiceSlot {
  return VOICE_SLOTS.some((s) => s.slot === slot);
}

/**
 * Whether the server sends voices by gender. One not yet updated sends them by speaker (A and B),
 * and its voices can't be shown or chosen here.
 */
export function hasVoiceSlots(voices: Partial<Speakers> | undefined): voices is Speakers {
  return !!voices && VOICE_SLOTS.every((s) => typeof voices[s.slot] === 'string');
}

/** The voices a slot can be set to: those of its gender. A voice Azure doesn't give a gender is left out. */
export function voicesForSlot(voices: AzureVoice[], slot: VoiceSlot): AzureVoice[] {
  const gender = slotInfo(slot).gender;
  return voices.filter((v) => v.gender?.toLowerCase() === gender);
}

/** "Niwat and Premwadee": the man's and the woman's voice, for a row that opens the voices. */
export function voicesSummary(voices: Partial<Speakers> | undefined): string | undefined {
  if (!hasVoiceSlots(voices)) return undefined;
  return `${azureVoiceName(voices.male)} and ${azureVoiceName(voices.female)}`;
}

/** Whether a second voice is the same as the first, so two men (or two women) sound alike. */
export function sharesVoice(voices: Speakers): boolean {
  return voices.male === voices.male2 || voices.female === voices.female2;
}

// A line to hear a voice with: the same for either gender, except in Thai, where the polite
// ending is the speaker's (ครับ for a man, ค่ะ for a woman).
const SAMPLES: Record<Language, string> = {
  th: 'สวัสดีครับ วันนี้อากาศดีนะครับ',
  es: 'Hola, ¿qué tal? Hoy hace muy buen día.',
  de: 'Hallo, wie geht es dir? Heute ist ein schöner Tag.',
  fr: 'Bonjour, comment ça va ? Il fait très beau aujourd’hui.',
  ru: 'Привет, как дела? Сегодня очень хорошая погода.',
  el: 'Γεια σου, τι κάνεις; Σήμερα έχει πολύ ωραίο καιρό.',
  pl: 'Cześć, co słychać? Dzisiaj jest bardzo ładna pogoda.',
  nb: 'Hei, hvordan går det? I dag er det veldig fint vær.',
  ja: 'こんにちは。今日はとてもいい天気ですね。',
  en: 'Hello, how are you? It’s a lovely day today.',
};
const THAI_WOMAN = 'สวัสดีค่ะ วันนี้อากาศดีนะคะ';

export function sampleLine(language: Language, gender: Gender): string {
  return language === 'th' && gender === 'female' ? THAI_WOMAN : SAMPLES[language];
}
