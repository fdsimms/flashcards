import { compareTypedAnswer } from './typedCompare';

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
 * closest to it (or to any of them: a Japanese word or its reading, which the recognizer may write
 * in kana), since telling apart two words that sound the same is the recognizer's job, not the
 * learner's; else the first. Empty guesses are skipped.
 */
export function bestHeard(guesses: readonly string[], expected?: string | readonly string[]): string {
  const heard = guesses.map((g) => g.trim()).filter(Boolean);
  const answers = typeof expected === 'string' ? [expected] : expected ?? [];
  if (!heard.length) return '';
  if (!answers.some((a) => a.trim())) return heard[0];
  let best = heard[0];
  let bestOff = Infinity;
  for (const g of heard) {
    const c = compareTypedAnswer(answers, g);
    const off = c.sameWords ? -1 : c.off;
    if (off < bestOff) { best = g; bestOff = off; }
  }
  return best;
}

/**
 * What a hold-to-talk transcript says once a pause is counted in. iOS keeps revising one transcript
 * while you speak, but after a pause it can start a new one that holds only what comes next, so
 * taking each result as the whole answer wiped what was said before the pause. `done` is the
 * segments before the current one and `last` is the current segment as last heard; a result that
 * doesn't continue `last` (its start differs) begins a new segment, and `last` moves into `done`.
 */
export function joinSegments(done: string, last: string, next: string): { done: string; last: string; text: string } {
  const heard = next.trim();
  if (!heard) return { done, last, text: joinWords(done, last) };
  const probe = last.slice(0, Math.min(2, last.length));
  const continues = !last || heard.startsWith(probe) || last.startsWith(heard.slice(0, Math.min(2, heard.length)));
  const before = continues ? done : joinWords(done, last);
  return { done: before, last: heard, text: joinWords(before, heard) };
}

/** Two pieces of speech side by side: a space between them, except where the script has no spaces (Thai, Japanese, Chinese). */
function joinWords(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const spaceless = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF]/;
  return spaceless.test(a.slice(-1)) && spaceless.test(b[0]) ? a + b : `${a} ${b}`;
}

/**
 * The note under a spoken answer. Thai gets a line on tones: the recognizer guesses them from the
 * words around, so a wrong tone can still come back as the right word. Japanese gets one on pitch
 * accent, which the recognizer doesn't check at all.
 */
export function spokenAnswerNote(speechTag: string | undefined): string {
  const base = 'It checks the words, not your pronunciation.';
  const tag = speechTag?.toLowerCase() ?? '';
  const tones = tag.startsWith('th') ? ' It also guesses tones from context, so it can miss a wrong one.'
    : tag.startsWith('ja') ? " It doesn't check pitch accent, so it can miss a wrong one." : '';
  return `${base}${tones} Rate it as you would any answer.`;
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

/**
 * Whether the microphone is offered: answering by speaking is on, the language can be heard, and,
 * offline, it's heard on the phone (`onDevice`; null when that can't be told, which keeps it).
 * One heard only by Apple's servers is hidden offline rather than failing after a tap.
 */
export function canListen(o: { on: boolean; locale: string | undefined; offline: boolean; onDevice: boolean | null }): boolean {
  return o.on && !!o.locale && !(o.offline && o.onDevice === false);
}

/** Settings, Speaking: whether a language can be heard, and whether with no connection too. */
export function hearingText(heard: boolean | null, onDevice: boolean | null): string {
  if (heard === null) return '';
  if (!heard) return 'Not supported';
  if (onDevice === true) return 'Works offline too';
  if (onDevice === false) return 'Works only when online';
  return 'Supported';
}
