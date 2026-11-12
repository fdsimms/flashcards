/**
 * Russian in Latin letters for a learner: ж zh, х kh, ц ts, ч ch, ш sh, щ shch, ы y, й y, ё yo,
 * ю yu, я ya, ь as ', ъ as ". Not a standard (no diacritics); just readable under the Cyrillic.
 */
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '"', ы: 'y', ь: "'", э: 'e', ю: 'yu', я: 'ya',
};

export function russianTranslit(text: string): string {
  return [...text].map((ch) => {
    const lower = ch.toLowerCase();
    const out = MAP[lower];
    if (out === undefined) return ch;
    return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
  }).join('');
}
