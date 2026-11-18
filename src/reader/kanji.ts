import type { WordKanji } from './api';

/** The credit KANJIDIC2's licence (CC BY-SA 4.0) asks for, shown under the kanji list. */
export const KANJI_CREDIT = 'Kanji data: KANJIDIC2 (EDRDG, CC BY-SA 4.0)';

/** A kun reading with the okurigana set off by a middle dot (さむ.い to さむ・い). */
export function kunReading(reading: string): string {
  return reading.replace('.', '・');
}

/** A kanji's meanings on one line ("skin, body"). */
export function meaningsLine(k: WordKanji): string {
  return k.meanings.join(', ');
}

/** A kanji's readings on one line: "kun はだ · on キ", leaving out whichever there are none of. */
export function readingsLine(k: WordKanji): string {
  const parts: string[] = [];
  if (k.kun.length) parts.push(`kun ${k.kun.map(kunReading).join('、')}`);
  if (k.on.length) parts.push(`on ${k.on.join('、')}`);
  return parts.join(' · ');
}

/** What a screen reader says for one kanji's row. */
export function kanjiSpoken(k: WordKanji, waniKaniLevel?: number): string {
  return [k.char, meaningsLine(k), readingsLine(k), waniKaniLevel ? `WaniKani level ${waniKaniLevel}` : ''].filter(Boolean).join('. ');
}
