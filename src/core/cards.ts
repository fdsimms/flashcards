import { examplesOf, sourceOf } from './examples';
import { genderArticle, genderOf, pluralWord, spokenEntry, verbMarker } from './gender';
import { fieldSegments } from './highlight';
import { htmlToText, soundFiles } from './html';
import { hasThai } from './script';
import { SENSE_CONTRAST_FIELD, contrastWords } from './senseContrast';
import { numberedSenses } from './senseMarks';
import { THAI_COUNTING_WORDS } from './thaiCounting';
import { newSchedState } from './scheduler';
import { fieldIsEmpty, templateOrdinals } from './template';
import type { Card, CardKind, Note, NoteType, RenderedCard, RenderedSide } from './types';
import { grammarText, wordGrammar } from './wordGrammar';

/**
 * Language names, in English and as the language writes itself, with the BCP-47 tag a note in it
 * is spoken in. A Language field is matched whole; a deck name is searched for each, in this order.
 */
export const LANG_TAGS: Record<string, string> = {
  thai: 'th-TH', ภาษาไทย: 'th-TH', ไทย: 'th-TH',
  polish: 'pl-PL', polski: 'pl-PL',
  russian: 'ru-RU', русский: 'ru-RU',
  french: 'fr-FR', français: 'fr-FR', francais: 'fr-FR',
  norwegian: 'nb-NO', norsk: 'nb-NO',
  greek: 'el-GR', ελληνικά: 'el-GR',
  japanese: 'ja-JP', 日本語: 'ja-JP',
  german: 'de-DE', deutsch: 'de-DE',
  spanish: 'es-MX', español: 'es-MX', espanol: 'es-MX',
  italian: 'it-IT', italiano: 'it-IT',
  portuguese: 'pt-BR', português: 'pt-BR', portugues: 'pt-BR',
  chinese: 'zh-CN', mandarin: 'zh-CN', 中文: 'zh-CN', 普通话: 'zh-CN', 普通話: 'zh-CN',
  cantonese: 'zh-HK', 粵語: 'zh-HK', 粤语: 'zh-HK', 廣東話: 'zh-HK',
  korean: 'ko-KR', 한국어: 'ko-KR',
  dutch: 'nl-NL', nederlands: 'nl-NL',
  swedish: 'sv-SE', svenska: 'sv-SE',
  danish: 'da-DK', dansk: 'da-DK',
  finnish: 'fi-FI', suomi: 'fi-FI',
  czech: 'cs-CZ', čeština: 'cs-CZ', cestina: 'cs-CZ',
  hungarian: 'hu-HU', magyar: 'hu-HU',
  romanian: 'ro-RO', română: 'ro-RO',
  turkish: 'tr-TR', türkçe: 'tr-TR', turkce: 'tr-TR',
  ukrainian: 'uk-UA', українська: 'uk-UA',
  arabic: 'ar-SA', العربية: 'ar-SA',
  hebrew: 'he-IL', עברית: 'he-IL',
  hindi: 'hi-IN', हिन्दी: 'hi-IN', हिंदी: 'hi-IN',
  vietnamese: 'vi-VN', 'tiếng việt': 'vi-VN', 'tieng viet': 'vi-VN',
  indonesian: 'id-ID', 'bahasa indonesia': 'id-ID',
  english: 'en-US',
};

/**
 * The languages a deck made in Franki can be in, by the English name its notes' Language field
 * holds ("Spanish"), each once, in `LANG_TAGS`' order: the first name each tag has there.
 */
export const NOTE_LANGUAGES: { name: string; tag: string }[] = Object.entries(LANG_TAGS)
  .filter(([key, tag], i, all) => all.findIndex(([, t]) => t === tag) === i && /^[a-z ]+$/.test(key))
  .map(([key, tag]) => ({ name: key.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()), tag }));

/** The Language field of a plain note in a deck set to no language: never read aloud, whatever its deck is called. */
export const NO_LANGUAGE = 'None';

/** The English name a deck's name gives (`deckNameLanguage`), as a Language field holds it. */
export function noteLanguageOfDeck(deck: string): string | undefined {
  const tag = deckNameLanguage(deck);
  return NOTE_LANGUAGES.find((l) => l.tag === tag)?.name;
}

/**
 * The language a note is spoken in: its Language field, else a language its deck's name gives.
 * Undefined when neither names one, which means don't speak it: iOS's default voice would read
 * the word as English, which a learner can't recognize.
 */
export function speechLangFor(note: Note): string | undefined {
  const raw = htmlToText(note.fields.Language ?? '').normalize('NFC').trim().toLowerCase();
  // A note in a deck set to no language (trivia named after a place) says so, over its deck's name.
  if (raw === NO_LANGUAGE.toLowerCase()) return undefined;
  return (raw ? LANG_TAGS[raw] ?? languageOfCode(raw) : undefined) ?? deckNameLanguage(note.deck);
}

/** A Language field holding a code rather than a name, as a shared deck may: pl, th-TH, zh_HK. */
function languageOfCode(raw: string): string | undefined {
  const code = raw.replace(/_/g, '-');
  const tags = [...new Set(Object.values(LANG_TAGS))];
  const primary = code.split('-')[0] === 'no' ? 'nb' : code.split('-')[0];
  return tags.find((t) => t.toLowerCase() === code) ?? tags.find((t) => t.split('-')[0] === primary);
}

/** A letter, mark or digit: what can't stand next to a language's name for it to be a word of its own. */
const WORDY = /[\p{L}\p{M}\p{N}]/u;
/** Scripts written without spaces between words, where a name is found inside a longer run (ภาษาไทยพื้นฐาน). */
const UNSPACED = /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff]/;

/**
 * The language a deck's name gives: a language's name (`LANG_TAGS`) as a word of its own, read one
 * level at a time from the top, the first name in the first level that has one. So Polish for Thai
 * speakers is Polish, Russian::Polish cognates is Russian, and Trivia::Geography::Thailand and
 * Prussian history are no language at all. The MCP reads deck names the same way
 * (`server/mcp/franki_mcp/skills.py`, `language_of_deck`), checked against the examples in the skill catalog.
 */
export function deckNameLanguage(deck: string): string | undefined {
  for (const level of deck.normalize('NFC').toLowerCase().split('::')) {
    let best: { at: number; length: number; tag: string } | undefined;
    for (const [key, tag] of Object.entries(LANG_TAGS)) {
      const spaced = !UNSPACED.test(key);
      for (let at = level.indexOf(key); at >= 0; at = level.indexOf(key, at + 1)) {
        const end = at + key.length;
        if (spaced && ((at > 0 && WORDY.test(level[at - 1])) || (end < level.length && WORDY.test(level[end])))) continue;
        if (!best || at < best.at || (at === best.at && key.length > best.length)) best = { at, length: key.length, tag };
        break;
      }
    }
    if (best) return best.tag;
  }
  return undefined;
}

export function isOmnilanguage(note: Note): boolean {
  return 'Entry' in note.fields && 'Meaning' in note.fields;
}

/**
 * Which card kinds a note produces. Mirrors the Anki templates' gating, `{{^SuppressFrontCard}}`
 * and `{{#GenerateReverse}}` / `{{#GenerateAudioCard}}`: the front card unless SuppressFrontCard
 * has anything in it, and the reverse / audio cards when GenerateReverse / GenerateAudioCard do.
 * Anything at all, as Anki reads a conditional (`fieldIsEmpty`): "no" or "0" still turns one on
 * there, so it does here, or Anki has a card Franki never shows.
 */
export function cardKindsFor(note: Note): CardKind[] {
  if (isOmnilanguage(note)) {
    const set = (field: string) => !fieldIsEmpty(note.fields[field]);
    const kinds: CardKind[] = set('SuppressFrontCard') ? [] : ['forward'];
    if (set('GenerateReverse')) kinds.push('reverse');
    if (set('GenerateAudioCard')) kinds.push('audio');
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

/**
 * A card as the native renderer shows it. `wanted` is the note's line saying which of several
 * words with its meaning a reverse card asks for (`wantedLines` in synonyms.ts); it shows under
 * the meaning on the reverse card's front.
 */
export function renderCard(note: Note, kind: CardKind, wanted?: string): RenderedCard {
  if (!isOmnilanguage(note)) return renderGeneric(note);
  const card = renderOmnilanguage(note, kind, wanted);
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
 * side, so a recording of the answer isn't played over the question. A front that shows the word
 * (`frontShowsWord`) offers nothing before the answer either: how it's said is part of what the
 * learner is recalling.
 */
export function playbackFor(card: RenderedCard, revealed: boolean): Playback | undefined {
  if (!revealed && card.frontShowsWord) return undefined;
  const text = revealed ? card.back.speak ?? card.front.speak : card.front.speak;
  const file = card.audioFile && (revealed || card.audioSide === 'front') ? card.audioFile : undefined;
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

/** The Gender field's one-letter values, as words for a chip. Any other value is shown as written. */
/** "Two" in Thai, the number a counted example uses. */
const THAI_TWO = 'สอง';

/**
 * The counted example for one counting word: the noun, "two", then the counting word. A word that
 * counts itself (ครั้ง, วัน, ชั่วโมง) leaves the noun off, since "สองครั้ง" is the phrase and
 * "ครั้งสองครั้ง" is not.
 */
export function countedExample(entry: string, counter: string): string {
  return `${entry === counter ? '' : entry}${THAI_TWO}${counter}`;
}

/**
 * A Thai noun's counting words, from the Classifier field (several may be listed, separated by
 * commas, slashes or line breaks). Only when the word and every counting word are Thai: another
 * language's counters stay a row under Forms, since the noun-number-counter order is Thai's.
 */
export function thaiCountingWords(entry: string, classifier: string): string[] {
  const words = classifier.split(/[,;、/\n]+/).map((w) => w.trim()).filter(Boolean);
  return words.length && hasThai(entry) && words.every(hasThai) ? words : [];
}

export const GENDER_WORDS: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter' };
function renderOmnilanguage(note: Note, kind: CardKind, wanted?: string): RenderedCard {
  const speechLang = speechLangFor(note);

  const entry = t(note, 'Entry');
  // What the phone's voice may say: nothing in a language that isn't known, which it would read as
  // English. A recording (`audioFile`) still plays.
  // A noun's article from its Gender, or a Norwegian verb's å (gender.ts), unless the Entry already starts with one.
  const lang2 = speechLang?.slice(0, 2) ?? '';
  const prefix = genderArticle(lang2, genderOf(t(note, 'Gender')), entry) ?? pluralWord(lang2, t(note, 'Gender'), entry) ?? verbMarker(lang2, t(note, 'PartOfSpeech'), entry);
  const say = speechLang ? spokenEntry(lang2, t(note, 'Gender'), t(note, 'PartOfSpeech'), entry) : undefined;
  const translit = t(note, 'Transliteration');
  // A Thai romanization's tone marks are colored by tone (toneColors.ts).
  const isThai = !!speechLang?.startsWith('th');
  const pronunciation = t(note, 'Pronunciation');
  // A Russian word with its stress mark (the Stress field, filled by the MCP's fill_stress): on an answer only, since text is never written with it.
  const stressed = t(note, 'Stress');
  // A Japanese word's kana, shown on the back after the word as Anki's template does ({{hint:KanaReading}}).
  const kana = t(note, 'KanaReading');
  // The IPA (the note type may not have the field yet: then it's empty). A card that already keeps a
  // reading behind a tap (a transliteration, kana) keeps the IPA behind one too, so a word's sound
  // isn't given away while its reading is still hidden; any other card shows it plainly.
  const pronunciationTap = translit || kana ? 'Show pronunciation' : undefined;
  const meaning = t(note, 'Meaning');
  // A Meaning that numbers its senses: an answer that shows it lets each be marked as missed (senseMarks.ts).
  const senses = numberedSenses(meaning);
  const sensed = senses.length ? { senses } : {};
  const front: Block[] = [];
  const back: Block[] = [];

  const detail = (): Block[] => {
    const b: Block[] = [];
    const gender = t(note, 'Gender');
    // "neutral" says a word is ordinary, which a chip needn't: the field keeps it, to tell ordinary from never judged.
    const register = t(note, 'Register');
    const meta = [t(note, 'PartOfSpeech'), GENDER_WORDS[gender.toLowerCase()] ?? gender, register.toLowerCase() === 'neutral' ? '' : register, t(note, 'Dialect')]
      .filter(Boolean);
    pushIf(b, meta.join(' · '), undefined, undefined, undefined, { role: 'chips', chips: meta, gender: genderOf(gender) });
    // The line the word was met in (a game, a show), first after the chips: the strongest hook for the word. It is laid
    // out as an example is, its translation behind the same tap, under "From" and the title instead of "Example".
    const source = sourceOf(note);
    if (source) {
      pushIf(b, htmlToText(source.line), undefined, undefined, undefined, { role: 'example', segments: fieldSegments(source.line, entry), source: source.where });
      pushIf(b, htmlToText(source.translation), undefined, undefined, 'Show translation', { role: 'exampleTranslation' });
    }
    // A Thai counting word isn't a form of the word: it's shown counted, with the noun and a number.
    const counting = thaiCountingWords(t(note, 'Entry'), t(note, 'Classifier'));
    pushIf(b, counting.map((w) => countedExample(t(note, 'Entry'), w)).join('\n'), 'Counting', undefined, undefined,
      { role: 'counting', rows: counting.map((w) => {
        const known = THAI_COUNTING_WORDS[w];
        return { label: w, value: countedExample(t(note, 'Entry'), w), ...(known ? { counts: { roman: known.roman, what: known.counts } } : {}) };
      }) });
    // What kind of word it is and its forms, each under its name (wordGrammar.ts): the verb class is its top line, not a chip.
    const grammar = wordGrammar(note, counting.length > 0);
    if (grammar) pushIf(b, grammarText(grammar), 'Grammar', undefined, undefined, { role: 'grammar', ...(grammar.pattern ? { pattern: grammar.pattern } : {}), cells: grammar.cells });
    // What helps remember the word itself comes before the example sentence that uses it.
    pushIf(b, t(note, 'Mnemonic'), 'Mnemonic', undefined, undefined, { field: 'Mnemonic' });
    pushIf(b, t(note, 'Notes'), 'Notes', undefined, undefined, { role: 'note', field: 'Notes' });
    // The example sentence, its word highlighted. Anki's template wraps the romanization and the
    // translation in {{hint:...}}: a tap-to-show link, not text.
    // A note with ContextLabels has several examples (examples.ts), each with its own two hidden lines.
    for (const ex of examplesOf(note)) {
      pushIf(b, htmlToText(ex.context), undefined, undefined, undefined, { role: 'example', segments: fieldSegments(ex.context, entry), ...(ex.tag ? { tag: ex.tag } : {}) });
      pushIf(b, htmlToText(ex.romanized), undefined, undefined, 'Show romanization', { role: 'exampleRomanized', segments: fieldSegments(ex.romanized, translit), tones: isThai });
      pushIf(b, htmlToText(ex.translation), undefined, undefined, 'Show translation', { role: 'exampleTranslation', ...(htmlToText(ex.literal) ? { literal: htmlToText(ex.literal) } : {}) });
    }
    pushIf(b, t(note, 'Hanzi'), speechLang?.startsWith('ja') ? 'Kanji' : 'Hanzi');
    pushIf(b, t(note, 'Etymology'), 'Etymology');
    return b;
  };

  // Anki's template puts the same word before the noun wherever it is shown (the Omnilanguage template).
  const pushEntry = (blocks: Block[], shown = entry) => pushIf(blocks, shown, undefined, true, undefined, { ...(prefix ? { prefix } : {}), gender: genderOf(t(note, 'Gender')), ...(kana && speechLang?.startsWith('ja') ? { reading: kana } : {}) });

  // "Not this word" (senseContrast.ts): the words for the senses the Sense rules out. On an answer only,
  // never a front: on the reverse card it would stand beside the meaning that asks for the word.
  const pushContrast = (blocks: Block[]) => {
    const rows = contrastWords(note.fields[SENSE_CONTRAST_FIELD] ?? '');
    pushIf(blocks, rows.map((r) => `${r.sense}: ${r.word}`).join('\n'), undefined, undefined, undefined, { role: 'contrast', rows: rows.map((r) => ({ label: r.sense, value: r.word })) });
  };

  if (kind === 'forward') {
    pushEntry(front);
    pushIf(front, t(note, 'LeechHint'), undefined);
    // The word is already on screen, so its meaning is set smaller than a headline to save room.
    pushIf(back, meaning, undefined, true, undefined, { role: 'meaning', ...sensed });
    pushIf(back, t(note, 'Sense'), undefined, undefined, undefined, { role: 'sense' });
    pushContrast(back);
    // The word is on the front unmarked, so its stress is a line of its own here.
    pushIf(back, stressed, undefined);
    pushIf(back, translit, undefined, undefined, 'Show transliteration', { role: 'transliteration', tones: isThai });
    pushIf(back, pronunciation, undefined, undefined, pronunciationTap);
    pushIf(back, kana, undefined, undefined, 'Show reading', { role: 'reading' });
    back.push(...detail());
    // The word is on the front already: Play may say it there, but it plays by itself only with the answer.
    return { front: { blocks: front, speak: say }, back: { blocks: back, speak: say }, speechLang, frontShowsWord: true };
  }

  if (kind === 'reverse') {
    pushIf(front, meaning, undefined, true);
    pushIf(front, t(note, 'Sense'), undefined, undefined, undefined, { role: 'sense' });
    // Which of the words with this meaning is wanted (synonyms.ts), so the other one isn't marked wrong.
    pushIf(front, wanted ?? '', undefined, undefined, undefined, { role: 'wanted' });
    pushIf(front, t(note, 'LeechHint'), undefined);
    // The word is the answer, so it's shown with its stress mark where the note has one.
    pushEntry(back, stressed || entry);
    pushIf(back, translit, undefined, undefined, 'Show transliteration', { role: 'transliteration', tones: isThai });
    pushIf(back, pronunciation, undefined, undefined, pronunciationTap);
    pushIf(back, kana, undefined, undefined, 'Show reading', { role: 'reading' });
    pushContrast(back);
    back.push(...detail());
    return { front: { blocks: front }, back: { blocks: back, speak: say }, speechLang };
  }

  // audio: hear it, recall the meaning
  front.push({ text: 'Listen', emphasis: true, icon: 'speaker.wave.2.fill' });
  // With no recording and no language to speak it in, there is nothing to hear: say so rather than play nothing.
  if (!say && !soundFiles(note.fields.Audio).length) {
    front.push({
      text: "This word has no recording, and its language isn't known, so there's nothing to play. To hear it, set the note's Language field (e.g. Italian).",
      role: 'note',
    });
  }
  pushEntry(back, stressed || entry);
  // The word is the answer here, so the meaning under it is a gloss, not a second headline.
  pushIf(back, meaning, undefined, undefined, undefined, { role: 'gloss', ...sensed });
  pushIf(back, t(note, 'Sense'), undefined, undefined, undefined, { role: 'sense' });
  pushContrast(back);
  pushIf(back, translit, undefined, undefined, 'Show transliteration', { role: 'transliteration', tones: isThai });
  pushIf(back, pronunciation, undefined, undefined, pronunciationTap);
  pushIf(back, kana, undefined, undefined, 'Show reading', { role: 'reading' });
  back.push(...detail());
  return { front: { blocks: front, speak: say }, back: { blocks: back }, speechLang };
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

/**
 * A note with no note type to render it by (one made in Franki before it had one): its front field,
 * then the rest. Its front is the word, as in an Omnilanguage note, so it's read aloud in the
 * note's language when one is known (a Language field, or the deck's name), and not at all otherwise.
 */
function renderGeneric(note: Note): RenderedCard {
  const names = Object.keys(note.fields);
  const frontName = frontFieldName(note) ?? names[0];
  const speechLang = speechLangFor(note);
  const say = speechLang ? t(note, frontName) || undefined : undefined;
  const backName = names.find((n) => /^(back|answer)$/i.test(n)) ?? names[1];
  const front: Block[] = [{ text: t(note, frontName), emphasis: true }];
  const back: Block[] = [];
  if (backName) back.push({ text: t(note, backName), emphasis: true });
  for (const n of names) {
    // Language is what the note is spoken in (`speechLangFor`), not something to learn.
    if (n === frontName || n === backName || n === 'Language') continue;
    pushIf(back, t(note, n), n);
  }
  return { front: { blocks: front, speak: say }, back: { blocks: back }, ...(speechLang ? { speechLang } : {}) };
}
