/**
 * The keyboard a typed answer should open on. iOS starts a field on whichever keyboard was used
 * last, so a Russian answer opens on English, and an English one after a Thai field opens on Thai.
 * Languages written in their own alphabet ask for one, and so does English, so a field that expects
 * it can leave a non-Latin keyboard. Other Latin-script languages (Polish, German, Norwegian...) are
 * typed on the English keyboard, which has their letters under a long press, so they ask for nothing.
 */
const OWN_SCRIPT = new Set([
  'en',
  'ru', 'uk', 'bg', 'be', 'sr', 'mk', 'kk', // Cyrillic
  'el', 'th', 'ja', 'ko', 'zh', 'ar', 'he', 'fa', 'hi', 'ka', 'hy',
]);

/** The primary language subtag ("ru" for "ru-RU") when it needs its own keyboard; else undefined. */
export function keyboardLanguageFor(tag: string | undefined | null): string | undefined {
  const primary = tag?.split(/[-_]/)[0]?.toLowerCase();
  return primary && OWN_SCRIPT.has(primary) ? primary : undefined;
}

/** Letters of each non-Latin script, and the keyboard language that types it. */
const SCRIPTS: { language: string; letters: RegExp }[] = [
  { language: 'ru', letters: /[Ѐ-ӿ]/g }, // Cyrillic: Ukrainian and Bulgarian can't be told apart from Russian by letters alone
  { language: 'el', letters: /[Ͱ-Ͽἀ-῿]/g },
  { language: 'th', letters: /[฀-๿]/g },
  { language: 'ja', letters: /[぀-ヿ]/g }, // kana: Chinese has none, so any makes it Japanese
  { language: 'ko', letters: /[가-힯ᄀ-ᇿ]/g },
  { language: 'ar', letters: /[؀-ۿ]/g },
  { language: 'he', letters: /[֐-׿]/g },
  { language: 'hi', letters: /[ऀ-ॿ]/g },
  { language: 'zh', letters: /[一-鿿]/g },
];

/**
 * The keyboard for text whose language isn't known (an Anki type-in answer on any note type): the
 * script most of its letters are written in, when that isn't Latin. Kanji with kana is Japanese;
 * kanji alone is taken as Chinese. Undefined for Latin text, or no letters at all.
 */
export function keyboardLanguageForText(text: string): string | undefined {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const latin = count(/[A-Za-zÀ-ɏ]/g);
  let best: { language: string; n: number } | undefined;
  for (const { language, letters } of SCRIPTS) {
    const n = count(letters);
    if (n > 0 && (!best || n > best.n)) best = { language, n };
  }
  if (!best || best.n < latin) return undefined;
  // Han is shared by Japanese: with any kana among it, it's Japanese.
  if (best.language === 'zh' && count(/[぀-ヿ]/g) > 0) return 'ja';
  if (best.language === 'ja' || count(/[぀-ヿ]/g) > 0) return 'ja';
  return best.language;
}
