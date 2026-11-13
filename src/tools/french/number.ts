import { groupAsNumber, phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import { distinct, type Phrase } from '../phrase';
import { frenchNumber } from './numbers';

/*
 * A number in French. A phone number is read in pairs (06 42 17 85 93: zéro six, quarante-deux,
 * dix-sept...). Belgium and Switzerland count the seventies and nineties as septante and nonante,
 * heard under the usual form. A year is a plain number (mille neuf cent quatre-vingt-sept), with
 * dix-neuf cent quatre-vingt-sept heard too before 2000. An age is j'ai and the number of ans.
 */

const say = (text: string, note?: string): Phrase => ({ text, ...(note ? { note } : {}) });
const BELGIAN = 'Belgium and Switzerland';

/** The usual form, and Belgium and Switzerland's when it differs (septante, nonante). */
function withBelgian(words: (belgian: boolean) => string): NumberSaying {
  const everyday = say(words(false));
  return { everyday, also: distinct([everyday, say(words(true), BELGIAN)]).slice(1) };
}

export function sayFrenchNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return withBelgian((b) => frenchNumber(q.n, false, b));
    case 'phone': {
      const groups = phoneGroups(q.written);
      return withBelgian((b) => groups.map((g) => groupAsNumber(g, 'zéro', (n) => frenchNumber(n, false, b))).join(', '));
    }
    case 'year': {
      const said = withBelgian((b) => frenchNumber(q.n, false, b));
      const rest = q.n % 100;
      const hundreds = q.n >= 1100 && q.n < 2000 ? `${frenchNumber(Math.floor(q.n / 100))} cent${rest ? ` ${frenchNumber(rest)}` : ''}` : undefined;
      return { everyday: said.everyday, also: distinct([said.everyday, ...(hundreds ? [say(hundreds, 'In hundreds, heard too')] : []), ...said.also]).slice(1) };
    }
    case 'age': return withBelgian((b) => `j'ai ${frenchNumber(q.n, false, b)} ans`);
  }
}
