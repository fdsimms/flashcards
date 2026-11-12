// Adding a marked word, or a phrase selected in the reader, to the deck ("mining"). Each one is a new note made in Franki's note editor,
// where saving it is the approval step, and at most MINING_PER_DAY are added a study day, to keep
// the daily reviews they bring in check (brief, design principle 12). Pure, so it's tested;
// storage.ts keeps the day's count.
/** Notes added from marked words per study day. */
export const MINING_PER_DAY = 10;

/** How many were added on which study day (a `studyDayKey`). */
export type MiningCount = { day: string; count: number };

export function parseMiningCount(raw: string | null): MiningCount | null {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && typeof (v as MiningCount).day === 'string' && Number.isInteger((v as MiningCount).count)) {
      return v as MiningCount;
    }
  } catch {
    // Unreadable: start the day's count again.
  }
  return null;
}

/** How many more can be added on study day `today`. */
export function miningLeft(saved: MiningCount | null, today: string): number {
  const used = saved?.day === today ? saved.count : 0;
  return Math.max(0, MINING_PER_DAY - used);
}

/** The count after one more is added on `today`. */
export function minedOne(saved: MiningCount | null, today: string): MiningCount {
  return { day: today, count: (saved?.day === today ? saved.count : 0) + 1 };
}

/** The new note a marked word or a selected phrase starts as, for the note editor: it and its meaning, in the language's deck. */
export function minedNote(word: string, gloss: string | null, deck: string): { deck: string; model: string; fields: Record<string, string> } {
  return { deck, model: 'Omnilanguage', fields: { Entry: word, Meaning: gloss ?? '' } };
}
