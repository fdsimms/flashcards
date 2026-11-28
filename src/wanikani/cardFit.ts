/**
 * How a WaniKani card's content is laid out so all of it fits in the room the card has, which with a
 * typed answer's keyboard up is about 230pt: the full layout needs 260 to 440.
 *
 * Three layouts, each a `TierLayout` that `WaniKaniCard.tsx` draws from (so a size lives here once):
 * `full` is the roomy one (and the only one a lesson uses), `tight` drops the divider, shrinks the
 * characters and sets parts and readings side by side, and `collapsed` also turns the large
 * characters into a header line. `chooseTier` picks the first that fits by estimating each one's
 * height, since measuring would mean laying a card out at the wrong size before correcting it.
 * The estimate is a guess at text widths and wraps, so the card keeps its scroll as a last resort.
 *
 * Pure, so it is tested (`tests/wanikani/cardFit.test.ts`). Text heights scale with the system text
 * size (`fontScale`); paddings and gaps don't.
 */
import { otherMeanings, primaryMeaning, readingGroups, type Part, type Subject } from './subjects';

export type FitTier = 'full' | 'tight' | 'collapsed';
export const FIT_TIERS: readonly FitTier[] = ['full', 'tight', 'collapsed'];

export interface TierLayout {
  padTop: number;
  padBottom: number;
  padX: number;
  /** Between the front and the details; `full` draws a divider with this gap on both sides. */
  gap: number;
  divider: boolean;
  /** Between the label over the characters and the characters. */
  frontGap: number;
  /** The characters' size: up to three of them, and more. */
  frontShort: number;
  frontLong: number;
  /** A radical's picture. */
  frontImage: number;
  /** The characters become a left-aligned header line, clear of the card's corner buttons. */
  headerFront: boolean;
  /** Between the blocks of the details (made up of, meaning, reading). */
  blockGap: number;
  /** Between a field's label and what it holds. */
  fieldGap: number;
  /** Extra space above the meaning when "Made up of" sits above it, on top of `blockGap`. */
  meaningLead: number;
  /** Parts as one-line chips (characters beside the meaning), not tiles with the meaning under. */
  inlineParts: boolean;
  /** A part's characters. */
  partChar: number;
  /** Between parts. */
  partGap: number;
  /** The meaning's size, and every reading's. */
  meaning: number;
  reading: number;
  /** A kanji's on'yomi, kun'yomi and nanori side by side. */
  readingsInRow: boolean;
}

export const TIER_LAYOUT: Record<FitTier, TierLayout> = {
  full: {
    padTop: 32, padBottom: 24, padX: 24, gap: 24, divider: true, frontGap: 12, frontShort: 64, frontLong: 44, frontImage: 72, headerFront: false,
    blockGap: 16, fieldGap: 8, meaningLead: 8, inlineParts: false, partChar: 22, partGap: 8, meaning: 26, reading: 26, readingsInRow: false,
  },
  tight: {
    padTop: 10, padBottom: 10, padX: 14, gap: 8, divider: false, frontGap: 4, frontShort: 44, frontLong: 34, frontImage: 56, headerFront: false,
    blockGap: 6, fieldGap: 4, meaningLead: 8, inlineParts: true, partChar: 18, partGap: 6, meaning: 24, reading: 24, readingsInRow: true,
  },
  collapsed: {
    padTop: 12, padBottom: 12, padX: 14, gap: 8, divider: false, frontGap: 4, frontShort: 26, frontLong: 26, frontImage: 28, headerFront: true,
    blockGap: 8, fieldGap: 4, meaningLead: 4, inlineParts: true, partChar: 18, partGap: 6, meaning: 20, reading: 20, readingsInRow: true,
  },
};

/** What a card's answer side holds, as far as its size goes. */
export interface FitShape {
  /** How many characters the front has (0 for a radical drawn as a picture). */
  frontChars: number;
  /** An answer side is showing, so there are details under the front. */
  details: boolean;
  /** Each part of "Made up of", empty when it isn't shown. */
  parts: { chars: number; meaningChars: number }[];
  /** The meaning block: the primary meaning's length, the others' (joined), and the learner's synonyms'. Null when it isn't shown. */
  meaning: { primary: number; others: number; synonyms: number } | null;
  /** Each reading group: its label's length (0 for vocabulary's), its readings' joined length, and whether it sits in the asked reading's well. Empty when readings aren't shown. */
  readings: { label: number; chars: number; asked: boolean }[];
}

export function fitShape(subject: Subject, parts: Part[], opts: { showMeaning: boolean; showReading: boolean; synonyms: string[] }): FitShape {
  const others = otherMeanings(subject).join(', ');
  const synonyms = opts.synonyms.length ? `Your synonyms: ${opts.synonyms.join(', ')}` : '';
  return {
    frontChars: subject.characters?.length ?? 0,
    details: opts.showMeaning || opts.showReading,
    parts: opts.showMeaning ? parts.map((p) => ({ chars: p.characters?.length ?? (p.image ? 1 : 0), meaningChars: p.meaning.length })) : [],
    meaning: opts.showMeaning ? { primary: primaryMeaning(subject).length, others: others.length, synonyms: synonyms.length } : null,
    readings: opts.showReading ? readingGroups(subject).map((g) => ({ label: g.type ? 4 + g.type.length : 7, chars: g.readings.join('、').length, asked: g.asked })) : [],
  };
}

/** Average width of a Latin glyph in em, and a line's height in em (Japanese text sits taller). */
const EM = 0.52;
const LINE = 1.2;
const JA_LINE = 1.25;

/** The padding of the well the asked reading sits in (`WaniKaniCard`'s `SubjectDetails`). */
export const WELL_PAD_X = 12;
export const WELL_PAD_Y = 4;

function lines(chars: number, size: number, scale: number, width: number): number {
  return Math.max(1, Math.ceil((chars * size * scale * EM) / Math.max(1, width)));
}

/** How many rows items of the given widths take in a wrapping row. */
function rowCount(widths: number[], gap: number, width: number): number {
  let rows = 0;
  let used = 0;
  for (const w of widths) {
    if (rows === 0 || (used > 0 && used + gap + w > width)) { rows += 1; used = w; } else used += gap + w;
  }
  return rows;
}

/** The height a layout needs for a shape, in pt, at a card `width` wide and a system text scale. */
export function tierHeight(shape: FitShape, tier: FitTier, width: number, fontScale: number): number {
  const t = TIER_LAYOUT[tier];
  const s = fontScale;
  const inner = Math.max(1, width - 2 * t.padX);
  const label = 12 * LINE * s;

  const front = t.headerFront
    ? Math.max(t.frontShort * JA_LINE * s, label)
    : label + t.frontGap + (shape.frontChars ? (shape.frontChars > 3 ? t.frontLong : t.frontShort) * JA_LINE * s : t.frontImage);
  let total = t.padTop + t.padBottom + front;
  if (!shape.details) return total;
  total += t.gap * (t.divider ? 2 : 1) + (t.divider ? 1 : 0);

  const blocks: number[] = [];
  if (shape.parts.length) {
    const chipH = t.inlineParts
      ? Math.max(t.partChar * JA_LINE * s, 12 * LINE * s) + 8 + 4
      : Math.max(44, t.partChar * LINE * s + 2 + 12 * LINE * s + 16 + 4);
    const widths = shape.parts.map((p) => {
      const ch = p.chars * t.partChar * s;
      const mean = p.meaningChars * (p.chars ? 12 : 16) * s * EM;
      return t.inlineParts ? 20 + 4 + ch + (p.chars ? 6 : 0) + mean : Math.max(64, 24 + 4 + Math.max(ch, mean));
    });
    const rows = rowCount(widths, t.partGap, inner);
    blocks.push(label + t.fieldGap + rows * chipH + (rows - 1) * t.partGap);
  }
  if (shape.meaning) {
    const m = shape.meaning;
    blocks.push(
      (shape.parts.length ? t.meaningLead : 0) + label + 2 + lines(m.primary, t.meaning, s, inner) * t.meaning * LINE * s
      + (m.others ? lines(m.others, 15, s, inner) * 15 * LINE * s : 0)
      + (m.synonyms ? lines(m.synonyms, 13, s, inner) * 13 * LINE * s : 0),
    );
  }
  if (shape.readings.length) {
    const group = (g: FitShape['readings'][number]) => {
      const w = Math.max(g.label * 7.5 * s, g.chars * t.reading * s);
      const h = label + 2 + Math.ceil(w / inner) * t.reading * JA_LINE * s;
      return g.asked ? { w: w + 2 * WELL_PAD_X, h: h + 2 * WELL_PAD_Y } : { w, h };
    };
    const groups = shape.readings.map(group);
    if (t.readingsInRow) {
      const rows = rowCount(groups.map((g) => g.w), 16, inner);
      blocks.push(rows * Math.max(...groups.map((g) => g.h)) + (rows - 1) * 8);
    } else {
      for (const g of groups) blocks.push(g.h);
    }
  }
  return total + blocks.reduce((a, b) => a + b, 0) + t.blockGap * Math.max(0, blocks.length - 1);
}

/**
 * The first layout whose height fits the card's scrolling area (`room`), else the smallest. A lesson
 * keeps `full`: it is read, not typed over, and its mnemonics scroll anyway. With no `room` measured
 * yet, `compact` (the keyboard is up) guesses `tight` so the first card isn't laid out at a size it
 * would have to leave.
 */
export function chooseTier(shape: FitShape, room: { width: number; height: number } | null, opts: { fontScale: number; lesson: boolean; compact: boolean }): FitTier {
  if (opts.lesson) return 'full';
  if (!room) return opts.compact ? 'tight' : 'full';
  for (const tier of FIT_TIERS) if (tierHeight(shape, tier, room.width, opts.fontScale) <= room.height) return tier;
  return 'collapsed';
}
