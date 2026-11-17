// Thai IPA from Wiktionary writes each syllable's tone as tone letters after it (/hen˩˩˦/). This
// rewrites them as the accent marks learners know (/hěn/), which the reader can show instead
// (Settings, Read & Listen, Thai pronunciation). Display only: the stored IPA and the note's
// Pronunciation field keep the tone letters. Pure, so it's tested.

const MARKS: Record<string, string> = {
  '˧': '', // mid: no mark
  '˨˩': '̀', // low: grave
  '˥˩': '̂', // falling: circumflex
  '˦˥': '́', // high: acute
  '˩˩˦': '̌', // rising: caron
};

const TONE_LETTERS = /[˥˦˧˨˩]/;
const SYLLABLE = /^(.*?)([˥˦˧˨˩]+)$/u;
const VOWEL = /[aeiouɛɔɯɤəɨ]/u;

/** One syllable with its tone letters turned into a mark on its first vowel, or null when it has no known tone or no vowel to carry it. */
function markSyllable(syllable: string): string | null {
  const match = SYLLABLE.exec(syllable);
  if (!match) return null;
  const [, body, letters] = match;
  const mark = MARKS[letters];
  if (mark === undefined) return null;
  if (!mark) return body;
  const at = body.search(VOWEL);
  if (at < 0) return null;
  return (body.slice(0, at + 1) + mark + body.slice(at + 1)).normalize('NFC');
}

/**
 * `ipa` with tone letters rewritten as accent marks: mid tone unmarked, low à, falling â, high á,
 * rising ǎ. IPA without tone letters (another language's) comes back as it was, and so does Thai IPA
 * with a tone this doesn't know, rather than being half converted.
 */
export function thaiToneMarks(ipa: string): string {
  if (!TONE_LETTERS.test(ipa)) return ipa;
  const open = ipa.startsWith('/') || ipa.startsWith('[') ? 1 : 0;
  const close = open && (ipa.endsWith('/') || ipa.endsWith(']')) ? 1 : 0;
  const inner = ipa.slice(open, ipa.length - close);
  // Syllables end at a dot, and so do words at a space; the separators go back as they were.
  const parts = inner.split(/([.\s]+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const marked = markSyllable(parts[i]);
    if (marked === null) return ipa;
    parts[i] = marked;
  }
  return ipa.slice(0, open) + parts.join('') + ipa.slice(ipa.length - close);
}
