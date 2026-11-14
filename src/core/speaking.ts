import { compareTyped } from './typedCompare';

/**
 * Answer by speaking (Settings, Speaking; off until turned on): what's said is turned into text by
 * iOS's speech recognizer and compared like typing (typedCompare.ts). The rating stays the
 * learner's. Recognition runs with on-device required, which iOS honors per language where it can
 * and otherwise sends the audio to Apple; nothing here can tell which one a language gets, since
 * iOS reports on-device support only for the phone's own language.
 */

/** BCP-47 tags as compared: hyphens, lower case. iOS writes es_MX. */
const norm = (tag: string) => tag.replace(/_/g, '-').toLowerCase();

/**
 * The recognizer locale for a language's speech tag (es-MX), from the locales iOS lists: the
 * same one, else one for the same language (es-ES for es-MX, nb-NO for no-NO), else none, in which
 * case the language can't be spoken here.
 */
export function recognitionLocale(tag: string | undefined, locales: readonly string[]): string | undefined {
  if (!tag) return undefined;
  const want = norm(tag);
  const exact = locales.find((l) => norm(l) === want);
  if (exact) return exact.replace(/_/g, '-');
  const lang = want.split('-')[0];
  const sameLanguage = (l: string) => {
    const code = norm(l).split('-')[0];
    return code === lang || (lang === 'nb' && code === 'no') || (lang === 'no' && code === 'nb');
  };
  const near = locales.find(sameLanguage);
  return near?.replace(/_/g, '-');
}

/**
 * What was heard, from the recognizer's guesses (best first): with an expected answer, the guess
 * closest to it, since telling apart two words that sound the same is the recognizer's job, not
 * the learner's; else the first. Empty guesses are skipped.
 */
export function bestHeard(guesses: readonly string[], expected?: string): string {
  const heard = guesses.map((g) => g.trim()).filter(Boolean);
  if (!heard.length) return '';
  if (!expected) return heard[0];
  let best = heard[0];
  let bestOff = Infinity;
  for (const g of heard) {
    const c = compareTyped(expected, g);
    const off = c.sameWords ? -1 : c.off;
    if (off < bestOff) { best = g; bestOff = off; }
  }
  return best;
}

/** What a recognizer error means for the learner, and what to do. Undefined for one that isn't worth saying (stopped on purpose). */
export function speakingErrorText(code: string): string | undefined {
  switch (code) {
    case 'aborted': return undefined;
    case 'no-speech':
    case 'speech-timeout': return "Didn't hear anything. Tap the microphone and speak, or type it instead.";
    case 'not-allowed': return "Franki isn't allowed to use the microphone or speech recognition. Turn them on in the iPhone's Settings, Franki.";
    case 'language-not-supported': return "This iPhone can't recognize this language. Type it instead.";
    case 'network': return "Couldn't reach Apple's speech recognition. Check your connection, or type it instead.";
    case 'interrupted': return 'Stopped listening when something else used the audio. Tap the microphone to try again.';
    case 'busy': return 'The microphone is busy. Try again in a moment.';
    default: return "Couldn't turn what you said into text. Try again, or type it instead.";
  }
}
