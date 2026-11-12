import type { Phrase } from './phrase';
import { pickOther } from './random';

/**
 * Money for the Counting money tool: each language's currency, its notes and coins, picking an
 * amount at random, and breaking one into the notes and coins that make it up. Amounts are whole
 * numbers of the currency's smallest unit (satang, cents, grosze), so nothing is lost to floating
 * point.
 */

export type CurrencyCode = 'THB' | 'MXN' | 'EUR' | 'PLN' | 'RUB' | 'NOK';

export interface Currency {
  code: CurrencyCode;
  /** On a note or coin: its sign, and the minor unit's short name. */
  symbol: string;
  minorSymbol: string;
  /** The smallest units in one: 100 satang to the baht, 100 cents to the euro. */
  minorPerMajor: number;
  /** Banknotes and coins in use, in minor units, largest first. */
  notes: number[];
  coins: number[];
  /**
   * The step a random amount's minor part comes in, in minor units, or 0 when prices are in whole
   * units (baht, rubles and kroner are; a Mexican price ends in .00 or .50 more often than not).
   */
  minorStep: number;
}

const major = (...values: number[]) => values.map((v) => v * 100);

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  THB: { code: 'THB', symbol: '฿', minorSymbol: 'st', minorPerMajor: 100, notes: major(1000, 500, 100, 50, 20), coins: major(10, 5, 2, 1), minorStep: 0 },
  MXN: { code: 'MXN', symbol: '$', minorSymbol: '¢', minorPerMajor: 100, notes: major(1000, 500, 200, 100, 50, 20), coins: [...major(20, 10, 5, 2, 1), 50], minorStep: 50 },
  EUR: { code: 'EUR', symbol: '€', minorSymbol: 'c', minorPerMajor: 100, notes: major(200, 100, 50, 20, 10, 5), coins: [...major(2, 1), 50, 20, 10, 5, 2, 1], minorStep: 1 },
  PLN: { code: 'PLN', symbol: 'zł', minorSymbol: 'gr', minorPerMajor: 100, notes: major(500, 200, 100, 50, 20, 10), coins: [...major(5, 2, 1), 50, 20, 10, 5, 2, 1], minorStep: 1 },
  RUB: { code: 'RUB', symbol: '₽', minorSymbol: 'kop', minorPerMajor: 100, notes: major(5000, 2000, 1000, 500, 200, 100, 50), coins: major(10, 5, 2, 1), minorStep: 0 },
  NOK: { code: 'NOK', symbol: 'kr', minorSymbol: 'øre', minorPerMajor: 100, notes: major(1000, 500, 200, 100), coins: major(20, 10, 5, 1), minorStep: 0 },
};

/** How big a random amount gets, in whole units: up to 100, 1,000 or 10,000. */
export type MoneyMax = 100 | 1000 | 10000;
export const MONEY_MAXES: MoneyMax[] = [100, 1000, 10000];

/**
 * An amount said in one language (each language's own money.ts makes one), in its currency.
 * `everyday` names the currency the way a price is read out; `written` is how a price tag shows it.
 */
export interface MoneySaying {
  everyday: Phrase;
  also: Phrase[];
  /** With digits and the currency's sign, as the language writes it: "1 277,50 €", "฿1,277". */
  written: Phrase;
}

/**
 * An amount at random, from one unit up to `max` units, never `previous` again. Half the time it
 * has a minor part, in the currency's `minorStep`, when it has one.
 */
export function randomAmount(currency: Currency, max: MoneyMax, previous?: number, random: () => number = Math.random): number {
  const step = currency.minorStep || currency.minorPerMajor;
  const withMinor = currency.minorStep > 0 && random() < 0.5;
  if (!withMinor) {
    const whole = pickOther(max, previous !== undefined && previous % currency.minorPerMajor === 0 ? previous / currency.minorPerMajor - 1 : undefined, random);
    return (whole + 1) * currency.minorPerMajor;
  }
  // Amounts below `max` with a minor part that isn't 0: max * (minorPerMajor / step - 1) of them.
  const perUnit = currency.minorPerMajor / step - 1;
  const at = (i: number) => Math.floor(i / perUnit) * currency.minorPerMajor + ((i % perUnit) + 1) * step;
  const last = previous !== undefined && previous % currency.minorPerMajor !== 0 && previous % step === 0 && previous < max * currency.minorPerMajor
    ? Math.floor(previous / currency.minorPerMajor) * perUnit + (previous % currency.minorPerMajor) / step - 1
    : undefined;
  return at(pickOther(max * perUnit, last, random));
}

export interface Piece {
  /** In minor units. */
  value: number;
  kind: 'note' | 'coin';
}

/** The notes and coins that make up `amount`, fewest first: the largest that fits, again and again. */
export function breakDown(amount: number, currency: Currency): Piece[] {
  const pieces: Piece[] = [];
  let left = amount;
  const all = [...currency.notes.map((value) => ({ value, kind: 'note' as const })), ...currency.coins.map((value) => ({ value, kind: 'coin' as const }))]
    .sort((a, b) => b.value - a.value);
  for (const p of all) {
    while (left >= p.value) { pieces.push(p); left -= p.value; }
  }
  if (left !== 0) throw new RangeError(`${amount} can't be made from ${currency.code}'s notes and coins`);
  return pieces;
}

/** What's printed on a note or coin: "1000 ฿", "50 c". */
export function pieceLabel(value: number, currency: Currency): string {
  return value >= currency.minorPerMajor ? `${value / currency.minorPerMajor} ${currency.symbol}` : `${value} ${currency.minorSymbol}`;
}
