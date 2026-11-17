import { toHiragana } from './kana';

/**
 * Furigana: a Japanese word's reading set above its kanji, on the back of a card (Settings,
 * Furigana). The reading comes from the note's KanaReading, or for a word of the example sentence
 * from Read & Listen's gloss; it's split over the word's kanji, its okurigana left bare (食べる:
 * た over 食). A run of kanji is split kanji by kanji where the kanji's readings (WaniKani's) give
 * exactly one way to do it (劇団: げき over 劇, だん over 団), and set over the whole run otherwise
 * (今日: きょう). Display only: nothing here is scheduled or saved to a note.
 */

/** Off; over every kanji; or over kanji not yet learned (Guru or above) in WaniKani. */
export type FuriganaMode = 'off' | 'all' | 'unlearned';

export const FURIGANA_MODES: { value: FuriganaMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'all', label: 'Over every kanji' },
  { value: 'unlearned', label: 'Over kanji not learned in WaniKani' },
];

export const DEFAULT_FURIGANA_MODE: FuriganaMode = 'off';

/** A stored setting read back; anything unrecognized is the default. */
export function parseFuriganaMode(raw: string | null | undefined): FuriganaMode {
  return FURIGANA_MODES.some((m) => m.value === raw) ? (raw as FuriganaMode) : DEFAULT_FURIGANA_MODE;
}

/** A stretch of a word, with its reading above it when it's kanji. */
export interface Run {
  text: string;
  ruby?: string;
}

/** What WaniKani says the learner knows, at Guru or above: kanji, and vocabulary as written. */
export interface Learned {
  kanji: ReadonlySet<string>;
  vocabulary: ReadonlySet<string>;
}

/** A kanji's readings, in kana, for splitting a run of kanji (WaniKani's: ゲキ for 劇). */
export type KanjiReadings = (kanji: string) => readonly string[] | undefined;

const KANJI = /[㐀-䶿一-鿿々〆]/;
const isKanji = (c: string) => KANJI.test(c);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The word cut into runs of kanji and runs of anything else, in order. */
function chunks(word: string): { text: string; kanji: boolean }[] {
  const out: { text: string; kanji: boolean }[] = [];
  for (const c of Array.from(word)) {
    const last = out[out.length - 1];
    if (last && last.kanji === isKanji(c)) last.text += c;
    else out.push({ text: c, kanji: isKanji(c) });
  }
  return out;
}

/** The first of a reading's alternatives (きょう、こんにち), in hiragana, without spaces or 〜. */
export function plainReading(reading: string): string {
  return toHiragana(reading.split(/[、,/;]/)[0] ?? '').replace(/[\s〜～~]/g, '');
}

const VOICED: Record<string, string[]> = {
  か: ['が'], き: ['ぎ'], く: ['ぐ'], け: ['げ'], こ: ['ご'], さ: ['ざ'], し: ['じ'], す: ['ず'], せ: ['ぜ'], そ: ['ぞ'],
  た: ['だ'], ち: ['ぢ', 'じ'], つ: ['づ', 'ず'], て: ['で'], と: ['ど'], は: ['ば', 'ぱ'], ひ: ['び', 'ぴ'], ふ: ['ぶ', 'ぷ'], へ: ['べ', 'ぺ'], ほ: ['ぼ', 'ぽ'],
};

/**
 * How a kanji's reading can sound inside a word: as it is, with its first sound voiced (rendaku:
 * 人 ひと in 人々 ひとびと), or with a final つ, く, ち or き clipped to っ (学 がく in 学校 がっこう).
 */
function soundings(reading: string): string[] {
  const r = toHiragana(reading).replace(/[.\-^]/g, '');
  if (!r) return [];
  const out = new Set([r]);
  for (const v of VOICED[r[0]] ?? []) out.add(v + r.slice(1));
  for (const base of [...out]) if (/[つくちき]$/.test(base) && base.length > 1) out.add(`${base.slice(0, -1)}っ`);
  return [...out];
}

/** Every way to read `kanji` (one character each) as `reading`, as each kanji's reading in turn. */
function splits(kanji: string[], reading: string, readings: KanjiReadings): string[][] {
  const out: string[][] = [];
  const walk = (i: number, at: number, so: string[]) => {
    if (out.length > 1) return; // two ways is already too many
    if (i === kanji.length) {
      if (at === reading.length) out.push(so);
      return;
    }
    // 々 repeats the kanji before it.
    const own = kanji[i] === '々' && i > 0 ? readings(kanji[i - 1]) : readings(kanji[i]);
    for (const r of new Set((own ?? []).flatMap(soundings))) {
      if (reading.startsWith(r, at)) walk(i + 1, at + r.length, [...so, r]);
    }
  };
  walk(0, 0, []);
  return out;
}

/**
 * The word as runs, each run of kanji with its part of the reading above it. The okurigana and any
 * kana in the word are matched against the reading to find where each kanji's part ends; a reading
 * that doesn't fit the word's kana is set over the whole word. A word with no kanji is one bare run.
 */
export function furiganaRuns(word: string, reading: string, readings?: KanjiReadings): Run[] {
  const parts = chunks(word);
  const said = plainReading(reading);
  if (!parts.some((p) => p.kanji)) return [{ text: word }];
  if (!said) return [{ text: word }];
  const pattern = new RegExp(`^${parts.map((p) => (p.kanji ? '(.+?)' : `(${escape(toHiragana(p.text))})`)).join('')}$`);
  const m = pattern.exec(said);
  if (!m) return [{ text: word, ruby: said }];
  return parts.flatMap((p, i): Run[] => {
    if (!p.kanji) return [{ text: p.text }];
    const ruby = m[i + 1];
    const chars = Array.from(p.text);
    if (chars.length === 1 || !readings) return [{ text: p.text, ruby }];
    const found = splits(chars, ruby, readings);
    return found.length === 1 ? chars.map((c, k) => ({ text: c, ruby: found[0][k] })) : [{ text: p.text, ruby }];
  });
}

/**
 * The runs as the setting shows them: no readings when it's off; every one for "every kanji"; and
 * for "not learned in WaniKani", none over a word learned as vocabulary (`dictionary` is its
 * dictionary form, for a conjugated word in a sentence) and none over a run whose kanji are all
 * learned. Without WaniKani's data, "not learned" shows them all, as nothing is known to be learned.
 */
export function shownRuns(runs: Run[], mode: FuriganaMode, learned: Learned | null, word: string, dictionary?: string): Run[] {
  const bare = () => runs.map((r) => ({ text: r.text }));
  if (mode === 'off') return bare();
  if (mode === 'all' || !learned) return runs;
  if (learned.vocabulary.has(word) || (dictionary && learned.vocabulary.has(dictionary))) return bare();
  return runs.map((r) => (r.ruby && Array.from(r.text).filter(isKanji).every((c) => learned.kanji.has(c)) ? { text: r.text } : r));
}

/** Whether any run has a reading over it. */
export const hasRuby = (runs: Run[]): boolean => runs.some((r) => !!r.ruby);

/** The setting and WaniKani's data, as a card sets furigana with them (`cardWordRuns`). */
export interface FuriganaSetting {
  mode: FuriganaMode;
  learned: Learned | null;
  readings?: KanjiReadings;
}

/**
 * The runs to draw a card's word with once its answer shows: the word's block (the one carrying a
 * `reading`, on either side) split by `furiganaRuns` and shown as the setting says. Null when the
 * card has no Japanese word with a reading, or none of it ends up with one; the screen then draws
 * the word as before and keeps its "Show reading" line.
 */
export function cardWordRuns(blocks: readonly { text: string; reading?: string }[], f: FuriganaSetting): Run[] | null {
  const block = blocks.find((b) => b.reading);
  if (!block?.reading || f.mode === 'off') return null;
  const runs = shownRuns(furiganaRuns(block.text, block.reading, f.readings), f.mode, f.learned, block.text);
  return hasRuby(runs) ? runs : null;
}
