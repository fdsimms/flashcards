import { isOmnilanguage, speechLangFor } from './cards';
import { htmlToText } from './html';
import { pickVoice, speechLanguage, type TtsTag } from './tts';
import type { Note, NoteType } from './types';

/**
 * The phone's text-to-speech voice and speed chosen for each language (Settings, Voices). Keyed
 * by the language alone ("th", "es"), so one choice covers Anki's es_ES and an Omnilanguage
 * note's es-MX alike. This phone's own: voice identifiers differ between phones, so a backup
 * doesn't carry it.
 */
export type VoiceSettings = Record<string, VoiceChoice>;

export interface VoiceChoice {
  /** The voice's identifier (`Speech.Voice.identifier`); none leaves the choice to iOS. */
  voice?: string;
  /** Its name, to say which voice it was once it's gone from the phone. */
  voiceName?: string;
  /** 1 is normal speed. None keeps each kind of card's own default (`OMNI_RATE`, or 1). */
  rate?: number;
  /** The Azure voice cards without a recording are recorded with (`src/core/recording.ts`); none records nothing. */
  azureVoice?: string;
}

/** A voice as `Speech.getAvailableVoicesAsync()` lists it. */
export interface PhoneVoice {
  identifier: string;
  name: string;
  language: string;
  quality?: string;
}

/** The speed an Omnilanguage card's word is read at until one is chosen: a little slower than normal. */
export const OMNI_RATE = 0.9;

/** The speeds offered, slowest first. */
export const VOICE_RATES = [0.6, 0.7, 0.8, 0.9, 1.0, 1.2];

/** "th_TH", "th-TH" and "th" are all "th". */
export function languageKey(lang: string): string {
  return speechLanguage(lang).split('-')[0].toLowerCase();
}

const NAMES: Record<string, string> = {
  ar: 'Arabic', bg: 'Bulgarian', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
  en: 'English', es: 'Spanish', fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian',
  hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', ms: 'Malay', nb: 'Norwegian',
  nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak',
  sl: 'Slovenian', sv: 'Swedish', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', zh: 'Chinese',
};

/** The language's name in English, or its code when it isn't one listed. */
export function languageName(key: string): string {
  return NAMES[key] ?? key.toUpperCase();
}

export interface DeckLanguage {
  key: string;
  name: string;
  /** The first full code the decks use for it (th-TH), for iOS to pick its voice by. */
  lang: string;
  /** Something from the decks to read in it, to hear a voice with. */
  sample?: string;
  /** Read on Omnilanguage cards, whose default speed is `OMNI_RATE` rather than 1. */
  omni: boolean;
}

// {{tts th_TH voices=Apple_Kanya:Front}}, with any other filters before the field: the language and the field.
const TTS_FILTER = /\{\{tts\s+([^\s:}]+)[^:}]*:(?:[^:}]*:)*([^:}]+)\}\}/g;

/**
 * The languages the decks are read aloud in: Omnilanguage notes' (`speechLangFor`, what Review
 * reads them in) and those of the {{tts}} filters in note types' templates, plus any with a
 * choice saved, so a choice never drops out of sight. Sorted by name.
 */
export function deckLanguages(notes: Note[], noteTypes: Iterable<NoteType>, saved: VoiceSettings = {}): DeckLanguage[] {
  const found = new Map<string, DeckLanguage>();
  const add = (lang: string, omni: boolean, sample?: string) => {
    const key = languageKey(lang);
    const had = found.get(key);
    if (!had) found.set(key, { key, name: languageName(key), lang: speechLanguage(lang), sample: sample || undefined, omni });
    else found.set(key, { ...had, sample: had.sample ?? (sample || undefined), omni: had.omni || omni });
  };
  const byModel = new Map<string, Note[]>();
  for (const note of notes) {
    if (!byModel.has(note.model)) byModel.set(note.model, []);
    byModel.get(note.model)!.push(note);
    if (!isOmnilanguage(note)) continue;
    const lang = speechLangFor(note);
    if (lang) add(lang, true, htmlToText(note.fields.Entry ?? '').trim());
  }
  for (const type of noteTypes) {
    for (const t of type.templates) {
      for (const m of `${t.front}\n${t.back}`.matchAll(TTS_FILTER)) {
        const field = m[2].trim();
        const note = byModel.get(type.name)?.find((n) => htmlToText(n.fields[field] ?? '').trim());
        add(m[1], false, note ? htmlToText(note.fields[field]).trim() : undefined);
      }
    }
  }
  for (const key of Object.keys(saved)) if (!found.has(key)) add(key, false);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How good a voice sounds. iOS's identifiers say it (com.apple.voice.premium.en-GB.Daniel);
 * expo-speech's `quality` only tells Enhanced from the rest, so a Premium voice reads as Default there.
 */
export function voiceQuality(v: PhoneVoice): 'Premium' | 'Enhanced' | 'Default' {
  const id = v.identifier.toLowerCase();
  if (id.includes('.premium.')) return 'Premium';
  if (id.includes('.enhanced.') || v.quality === 'Enhanced') return 'Enhanced';
  return 'Default';
}

const QUALITY_RANK = { Premium: 0, Enhanced: 1, Default: 2 };

/**
 * The phone's voices in a language, the best sounding first, then by name. The novelty voices
 * (Albert, Bubbles, Zarvox: macOS's old voices, identified as com.apple.speech.synthesis.voice.*)
 * are left out; they aren't meant for reading words.
 */
export function voicesIn(available: PhoneVoice[], key: string): PhoneVoice[] {
  return available
    .filter((v) => languageKey(v.language) === key && !v.identifier.startsWith('com.apple.speech.synthesis.voice.'))
    .sort((a, b) => QUALITY_RANK[voiceQuality(a)] - QUALITY_RANK[voiceQuality(b)] || a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

/** The voice chosen for a language, if the phone still has it. Undefined leaves it to iOS. */
export function chosenVoice(available: PhoneVoice[], settings: VoiceSettings, lang: string): string | undefined {
  const id = settings[languageKey(lang)]?.voice;
  return id && available.some((v) => v.identifier === id) ? id : undefined;
}

/** What Speech.speak needs to read a word. */
export interface SpeechOptions {
  language?: string;
  voice?: string;
  rate: number;
}

/** An Omnilanguage card's word, in its note's language: the chosen voice and speed, else iOS's voice at `OMNI_RATE`. */
export function wordSpeech(available: PhoneVoice[], settings: VoiceSettings, lang: string | undefined): SpeechOptions {
  if (!lang) return { rate: OMNI_RATE };
  return { language: lang, voice: chosenVoice(available, settings, lang), rate: settings[languageKey(lang)]?.rate ?? OMNI_RATE };
}

/**
 * An Anki {{tts}} tag: a voice or speed the template names comes first, as in Anki, then the one
 * chosen for the language. Speed 1 is also what a template that names none reads as
 * (`ttsTags`), so only a template's other speeds override the chosen one.
 */
export function tagSpeech(available: PhoneVoice[], settings: VoiceSettings, tag: TtsTag): SpeechOptions {
  const chosen = settings[languageKey(tag.lang)];
  return {
    language: speechLanguage(tag.lang),
    voice: pickVoice(available, tag) ?? chosenVoice(available, settings, tag.lang),
    rate: tag.speed !== 1 ? tag.speed : chosen?.rate ?? 1,
  };
}

/** The speed shown for a language before one is chosen: what its cards are read at now. */
export function defaultRate(lang: DeckLanguage): number {
  return lang.omni ? OMNI_RATE : 1;
}

/** Reads saved settings, keeping only well-formed choices. */
export function parseVoiceSettings(json: string | null | undefined): VoiceSettings {
  let raw: unknown;
  try { raw = json ? JSON.parse(json) : {}; } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out: VoiceSettings = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const choice: VoiceChoice = {};
    if (typeof o.voice === 'string') choice.voice = o.voice;
    if (typeof o.voiceName === 'string') choice.voiceName = o.voiceName;
    if (typeof o.rate === 'number' && Number.isFinite(o.rate) && o.rate > 0) choice.rate = o.rate;
    if (typeof o.azureVoice === 'string' && o.azureVoice) choice.azureVoice = o.azureVoice;
    out[key] = choice;
  }
  return out;
}

/** An Azure voice's own name, from its id: th-TH-PremwadeeNeural is Premwadee. */
export function azureVoiceName(voice: string): string {
  return voice.replace(/^[a-z]{2,3}-[A-Z]{2}-/, '').replace(/(Multilingual)?Neural$/, '') || voice;
}
