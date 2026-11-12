import { htmlToText, isTruthyField, soundFiles } from './html';
import { newSchedState } from './scheduler';
import { templateOrdinals } from './template';
import type { Card, CardKind, Note, NoteType, RenderedCard } from './types';

const LANG_TAGS: Record<string, string> = {
  thai: 'th-TH', ภาษาไทย: 'th-TH',
  polish: 'pl-PL', polski: 'pl-PL',
  russian: 'ru-RU', русский: 'ru-RU',
  french: 'fr-FR', français: 'fr-FR', francais: 'fr-FR',
  norwegian: 'nb-NO', norsk: 'nb-NO',
  greek: 'el-GR', ελληνικά: 'el-GR',
  japanese: 'ja-JP', 日本語: 'ja-JP',
  german: 'de-DE', deutsch: 'de-DE',
  spanish: 'es-MX', español: 'es-MX', espanol: 'es-MX',
  english: 'en-US',
};

export function speechLangFor(note: Note): string | undefined {
  const raw = htmlToText(note.fields.Language ?? '').toLowerCase();
  if (raw && LANG_TAGS[raw]) return LANG_TAGS[raw];
  // Fall back to scanning the deck name for a known language.
  const deck = note.deck.toLowerCase();
  for (const [k, v] of Object.entries(LANG_TAGS)) if (deck.includes(k)) return v;
  return undefined;
}

export function isOmnilanguage(note: Note): boolean {
  return 'Entry' in note.fields && 'Meaning' in note.fields;
}

/**
 * Which card kinds a note produces. Mirrors the Anki templates' gating: the front card unless
 * SuppressFrontCard is set, and the reverse / audio cards when GenerateReverse /
 * GenerateAudioCard are.
 */
export function cardKindsFor(note: Note): CardKind[] {
  if (isOmnilanguage(note)) {
    const kinds: CardKind[] = isTruthyField(note.fields.SuppressFrontCard) ? [] : ['forward'];
    if (isTruthyField(note.fields.GenerateReverse)) kinds.push('reverse');
    if (isTruthyField(note.fields.GenerateAudioCard)) kinds.push('audio');
    return kinds;
  }
  return ['forward'];
}

/**
 * A note's cards. Omnilanguage gets its native kinds; another note type with its Anki templates
 * known gets one `t<ord>` card per template (or cloze number) that has something to show; without
 * them, one front/back card. An import that knows which cards Anki has passes `ords` instead.
 */
export function makeCards(note: Note, now: Date = new Date(), noteType?: NoteType, ords?: number[]): Card[] {
  const kinds: CardKind[] = isOmnilanguage(note)
    ? cardKindsFor(note)
    : noteType
      ? (ords ?? templateOrdinals(note, noteType)).map((o): CardKind => `t${o}`)
      : ['forward'];
  return kinds.map((kind) => ({
    id: `${note.id}:${kind}`,
    noteId: note.id,
    kind,
    suspended: false,
    retired: false,
    sched: newSchedState(now),
  }));
}

type Block = { label?: string; text: string; emphasis?: boolean };

function t(note: Note, name: string): string {
  return htmlToText(note.fields[name] ?? '');
}

function pushIf(blocks: Block[], text: string, label?: string, emphasis?: boolean) {
  if (text) blocks.push({ label, text, emphasis });
}

export function renderCard(note: Note, kind: CardKind): RenderedCard {
  if (!isOmnilanguage(note)) return renderGeneric(note);
  const card = renderOmnilanguage(note, kind);
  const audioFile = soundFiles(note.fields.Audio)[0];
  return audioFile ? { ...card, audioFile, audioSide: kind === 'audio' ? 'front' : 'back' } : card;
}

/** What to play for a card: its recording when allowed, and the text to speak when there isn't one. */
export interface Playback {
  text?: string;
  file?: string;
}

/**
 * What the Play button says for the side shown. A recording belongs to `audioSide` and, once the
 * answer is shown, is free to replay from either side; before then it stays quiet on the other
 * side, so a recording of the answer isn't played over the question.
 */
export function playbackFor(card: RenderedCard, revealed: boolean): Playback | undefined {
  const text = revealed ? card.back.speak ?? card.front.speak : card.front.speak;
  const file = card.audioFile && (revealed || card.audioSide === 'front') ? card.audioFile : undefined;
  return text || file ? { text, file } : undefined;
}

/**
 * What plays by itself when a card comes up (`revealed` false) or its answer is shown (true).
 * Showing the answer plays only what's new there: the recording, or the word a reverse card asks for.
 * A card with no recording speaks its front text with the phone's voice, as before.
 */
export function autoplayFor(card: RenderedCard, revealed: boolean): Playback | undefined {
  if (!revealed) {
    // A card with a recording that belongs to its back stays quiet until the answer, as in Anki.
    if (card.audioFile && card.audioSide !== 'front') return undefined;
    return card.front.speak || card.audioFile ? { text: card.front.speak, file: card.audioFile } : undefined;
  }
  const file = card.audioSide === 'back' ? card.audioFile : undefined;
  return card.back.speak || file ? { text: card.back.speak, file } : undefined;
}

function renderOmnilanguage(note: Note, kind: CardKind): RenderedCard {
  const speechLang = speechLangFor(note);

  const entry = t(note, 'Entry');
  const translit = t(note, 'Transliteration');
  const meaning = t(note, 'Meaning');
  const front: Block[] = [];
  const back: Block[] = [];

  const detail = (): Block[] => {
    const b: Block[] = [];
    pushIf(b, t(note, 'Context'), 'Context');
    pushIf(b, t(note, 'ContextRomanized'), undefined);
    pushIf(b, t(note, 'ContextTranslation'), undefined);
    const meta = [t(note, 'PartOfSpeech'), t(note, 'Gender'), t(note, 'Register')].filter(Boolean).join(' · ');
    pushIf(b, meta, undefined);
    pushIf(b, t(note, 'KeyForms'), 'Forms');
    pushIf(b, t(note, 'Notes'), 'Notes');
    pushIf(b, t(note, 'Etymology'), 'Etymology');
    pushIf(b, t(note, 'Mnemonic'), 'Mnemonic');
    return b;
  };

  if (kind === 'forward') {
    pushIf(front, entry, undefined, true);
    pushIf(front, t(note, 'LeechHint'), undefined);
    pushIf(back, translit, undefined);
    pushIf(back, meaning, undefined, true);
    back.push(...detail());
    return { front: { blocks: front, speak: entry }, back: { blocks: back }, speechLang };
  }

  if (kind === 'reverse') {
    pushIf(front, meaning, undefined, true);
    pushIf(front, t(note, 'LeechHint'), undefined);
    pushIf(back, entry, undefined, true);
    pushIf(back, translit, undefined);
    back.push(...detail());
    return { front: { blocks: front }, back: { blocks: back, speak: entry }, speechLang };
  }

  // audio: hear it, recall the meaning
  front.push({ text: '🔊 Listen', emphasis: true });
  pushIf(back, entry, undefined, true);
  pushIf(back, translit, undefined);
  pushIf(back, meaning, undefined, true);
  back.push(...detail());
  return { front: { blocks: front, speak: entry }, back: { blocks: back }, speechLang };
}

/**
 * The field a note is asked by: Entry for Omnilanguage, else Front/Question/Prompt, else the first.
 * Rendering and import matching (`matchKey`) both use this, so they agree on what a note "is".
 */
export function frontFieldName(note: Note): string | undefined {
  if (isOmnilanguage(note)) return 'Entry';
  const names = Object.keys(note.fields);
  return names.find((n) => /^(front|question|prompt)$/i.test(n)) ?? names[0];
}

function renderGeneric(note: Note): RenderedCard {
  const names = Object.keys(note.fields);
  const frontName = frontFieldName(note) ?? names[0];
  const backName = names.find((n) => /^(back|answer)$/i.test(n)) ?? names[1];
  const front: Block[] = [{ text: t(note, frontName), emphasis: true }];
  const back: Block[] = [];
  if (backName) back.push({ text: t(note, backName), emphasis: true });
  for (const n of names) {
    if (n === frontName || n === backName) continue;
    pushIf(back, t(note, n), n);
  }
  return { front: { blocks: front }, back: { blocks: back } };
}
