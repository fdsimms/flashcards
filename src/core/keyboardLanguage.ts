/**
 * The keyboard a typed answer should open on. iOS starts a field on whichever keyboard was used
 * last, so a Russian answer opens on English. Only languages written in their own alphabet ask for
 * one: Latin-script languages (Polish, German, Norwegian...) are typed on the English keyboard,
 * which has their letters under a long press.
 */
const OWN_SCRIPT = new Set([
  'ru', 'uk', 'bg', 'be', 'sr', 'mk', 'kk', // Cyrillic
  'el', 'th', 'ja', 'ko', 'zh', 'ar', 'he', 'fa', 'hi', 'ka', 'hy',
]);

/** The primary language subtag ("ru" for "ru-RU") when it needs its own keyboard; else undefined. */
export function keyboardLanguageFor(tag: string | undefined | null): string | undefined {
  const primary = tag?.split(/[-_]/)[0]?.toLowerCase();
  return primary && OWN_SCRIPT.has(primary) ? primary : undefined;
}
