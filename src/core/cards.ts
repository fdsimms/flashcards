import { fieldSegments } from './highlight';
import { htmlToText, isTruthyField, soundFiles } from './html';
import { newSchedState } from './scheduler';
import { templateOrdinals } from './template';
import type { Card, CardKind, Note, NoteType, RenderedCard, RenderedSide } from './types';

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

type Block = RenderedSide['blocks'][number];

function t(note: Note, name: string): string {
  return htmlToText(note.fields[name] ?? '');
}

function pushIf(blocks: Block[], text: string, label?: string, emphasis?: boolean, tapLabel?: string, extra?: Partial<Block>) {
  if (text) blocks.push({ label, text, emphasis, tapLabel, ...extra });
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
 * side, so a recording of the answer isn't played over the question, unless the front already
 * shows the word it says (`frontShowsWord`).
 */
export function playbackFor(card: RenderedCard, revealed: boolean): Playback | undefined {
  const text = revealed ? card.back.speak ?? card.front.speak : card.front.speak;
  const file = card.audioFile && (revealed || card.audioSide === 'front' || card.frontShowsWord) ? card.audioFile : undefined;
  return text || file ? { text, file } : undefined;
}

/**
 * Whether the card offers Record yourself: only with a recording of the word to compare against,
 * on either side, so a take can be made from memory before the answer and played back after it.
 */
export function canRecordYourself(card: RenderedCard): boolean {
  return !!card.audioFile;
}

/**
 * What plays by itself when a card comes up (`revealed` false) or its answer is shown (true).
 * Showing the answer plays the word: the recording, else the phone's voice. A card that shows the
 * word on its front (`frontShowsWord`) is quiet until then; any other card with no recording
 * speaks its front text with the phone's voice, as before.
 */
export function autoplayFor(card: RenderedCard, revealed: boolean): Playback | undefined {
  if (!revealed) {
    if (card.frontShowsWord) return undefined;
    // A card with a recording that belongs to its back stays quiet until the answer, as in Anki.
    if (card.audioFile && card.audioSide !== 'front') return undefined;
    return card.front.speak || card.audioFile ? { text: card.front.speak, file: card.audioFile } : undefined;
  }
  const file = card.audioSide === 'back' ? card.audioFile : undefined;
  return card.back.speak || file ? { text: card.back.speak, file } : undefined;
}

/** Omnilanguage's fields that hold one of the word's forms, with the label each is shown under. */
const FORM_ROWS: [field: string, label: string][] = [
  ['KeyForms', 'key forms'], ['Plural', 'plural'], ['Genitive', 'genitive'], ['Classifier', 'counting word'],
  ['Auxiliary', 'auxiliary'], ['AspectPartner', 'aspect pair'],
];

/** The Gender field's one-letter values, as words for a chip. Any other value is shown as written. */
const GENDER_WORDS: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter' };
const RUSSIAN_PRONOUNS: Record<string, string> = { m: 'мой', f: 'моя', n: 'моё' };

function renderOmnilanguage(note: Note, kind: CardKind): RenderedCard {
  const speechLang = speechLangFor(note);

  const entry = t(note, 'Entry');
  const translit = t(note, 'Transliteration');
  // A Japanese word's kana, shown on the back after the word as Anki's template does ({{hint:KanaReading}}).
  const kana = t(note, 'KanaReading');
  const meaning = t(note, 'Meaning');
  const front: Block[] = [];
  const back: Block[] = [];

  const detail = (): Block[] => {
    const b: Block[] = [];
    const gender = t(note, 'Gender');
    const meta = [t(note, 'PartOfSpeech'), GENDER_WORDS[gender.toLowerCase()] ?? gender, t(note, 'Register'), t(note, 'Dialect'), t(note, 'VerbClass')]
      .filter(Boolean);
    pushIf(b, meta.join(' · '), undefined, undefined, undefined, { role: 'chips', chips: meta });
    // The word's other forms, as Anki's template shows them in pills and its key forms line.
    const rows = FORM_ROWS.map(([field, label]) => ({ label, value: t(note, field) })).filter((r) => r.value);
    pushIf(b, rows.map((r) => `${r.label}: ${r.value}`).join('\n'), 'Forms', undefined, undefined, { role: 'forms', rows });
    // The example sentence, its word highlighted. Anki's template wraps the romanization and the
    // translation in {{hint:...}}: a tap-to-show link, not text.
    pushIf(b, t(note, 'Context'), undefined, undefined, undefined, { role: 'example', segments: fieldSegments(note.fields.Context, entry) });
    pushIf(b, t(note, 'ContextRomanized'), undefined, undefined, 'Show romanization', { role: 'exampleRomanized', segments: fieldSegments(note.fields.ContextRomanized, translit) });
    pushIf(b, t(note, 'ContextTranslation'), undefined, undefined, 'Show translation', { role: 'exampleTranslation' });
    pushIf(b, t(note, 'Hanzi'), speechLang?.startsWith('ja') ? 'Kanji' : 'Hanzi');
    pushIf(b, t(note, 'Notes'), 'Notes', undefined, undefined, { role: 'note' });
    pushIf(b, t(note, 'Etymology'), 'Etymology');
    pushIf(b, t(note, 'Mnemonic'), 'Mnemonic');
    return b;
  };

  // Anki's template puts мой / моя / моё before a Russian noun wherever the word is shown.
  const prefix = speechLang?.startsWith('ru') ? RUSSIAN_PRONOUNS[t(note, 'Gender').toLowerCase()] : undefined;
  const pushEntry = (blocks: Block[]) => pushIf(blocks, entry, undefined, true, undefined, prefix ? { prefix } : undefined);

  if (kind === 'forward') {
    pushEntry(front);
    pushIf(front, t(note, 'LeechHint'), undefined);
    pushIf(back, meaning, undefined, true);
    pushIf(back, translit, undefined, undefined, 'Show transliteration');
    pushIf(back, kana, undefined, undefined, 'Show reading');
    back.push(...detail());
    // The word is on the front already: Play may say it there, but it plays by itself only with the answer.
    return { front: { blocks: front, speak: entry }, back: { blocks: back, speak: entry }, speechLang, frontShowsWord: true };
  }

  if (kind === 'reverse') {
    pushIf(front, meaning, undefined, true);
    pushIf(front, t(note, 'LeechHint'), undefined);
    pushEntry(back);
    pushIf(back, translit, undefined, undefined, 'Show transliteration');
    pushIf(back, kana, undefined, undefined, 'Show reading');
    back.push(...detail());
    return { front: { blocks: front }, back: { blocks: back, speak: entry }, speechLang };
  }

  // audio: hear it, recall the meaning
  front.push({ text: 'Listen', emphasis: true, icon: 'speaker.wave.2.fill' });
  pushEntry(back);
  pushIf(back, meaning, undefined, true);
  pushIf(back, translit, undefined, undefined, 'Show transliteration');
  pushIf(back, kana, undefined, undefined, 'Show reading');
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
