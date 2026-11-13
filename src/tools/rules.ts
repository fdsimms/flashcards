import type { Language } from '../reader/api';
import type { CalendarDate, DateParts } from './date';
import type { Currency } from './money';
import type { NumberQuestion } from './number';
import { thaiHourBand } from './patterns';
import type { ClockTime } from './time';

/**
 * The rule behind a Practice question's answer, shown in one line after a miss: why 2:25 is fünf
 * vor halb drei, why 22 zł is złote and 25 zł złotych. Only where the rule is short and certain,
 * and each says exactly what that language's own sayer (src/tools/<language>/) produces, so its
 * examples are its output (tests/tools/rules.test.ts checks them against it). A question with no
 * rule here shows none: a wrong rule teaches worse than no rule at all.
 */

/** The sentences that apply, as one line; none when nothing does. */
const line = (sentences: (string | false | undefined)[]): string | undefined => {
  const said = sentences.filter((s): s is string => !!s);
  return said.length ? said.join(' ') : undefined;
};

const hour12 = (h: number) => h % 12 || 12;

// Telling the time.

const THAI_BANDS: Record<string, string> = {
  dtii: '1 to 5 a.m. are ตี and the hour: ตีหนึ่ง is 1:00, ตีห้า 5:00.',
  chao: '6 to 11 a.m. are the hour and โมงเช้า: หกโมงเช้า is 6:00, สิบเอ็ดโมงเช้า 11:00. With minutes after it, เช้า is usually left off.',
  baai: '1 to 4 p.m. are บ่าย, the hour counted from noon, and โมง: บ่ายโมง is 13:00, บ่ายสองโมง 14:00.',
  yen: '5 and 6 p.m. are the hour counted from noon and โมงเย็น: ห้าโมงเย็น is 17:00, หกโมงเย็น 18:00. With minutes after it, เย็น is usually left off.',
  thum: '7 to 11 p.m. are ทุ่ม, counted from 7 p.m.: หนึ่งทุ่ม is 19:00, ห้าทุ่ม 23:00.',
};

function spanishTime({ hour: h, minute: m }: ClockTime): string | undefined {
  const said = hour12(m < 40 ? h : h + 1);
  return line([
    m === 0 && (h === 0 || h === 12) && 'Noon and midnight are both las doce; mediodía and medianoche say which.',
    m >= 40 && 'From :40, the minutes left para the next hour: diez para las tres is 2:50. Spain says las tres menos diez.',
    said === 1 && "One o'clock takes la: la una, la una y diez; the other hours take las.",
  ]);
}

function frenchTime({ hour: h, minute: m }: ClockTime): string | undefined {
  const named = m < 40 ? h : (h + 1) % 24;
  // The numbers said: the hour (unless it's midi or minuit) and the minutes (unless quart or demie).
  const numbers = [named % 12 ? named % 12 : 0, m < 40 ? (m === 15 || m === 30 ? 0 : m) : m === 45 ? 0 : 60 - m];
  const une = numbers.some((n) => n % 10 === 1 && n !== 11);
  return line([
    (named === 0 || named === 12) && "In conversation, 12 o'clock is midi or minuit, not douze heures, and half past is et demi: midi et demi.",
    m >= 40 && 'From :40, the next hour moins the minutes left: trois heures moins dix is 2:50, and :45 is moins le quart.',
    une && 'Heure and minute are feminine, so 1 is une: une heure, deux heures vingt et une.',
  ]);
}

function germanTime({ hour: h, minute: m }: ClockTime): string | undefined {
  if (m === 0 && hour12(h) === 1) return "One o'clock is ein Uhr, or eins without Uhr.";
  if (m === 20) return '20 past is also said around halb: zehn vor halb drei is 2:20.';
  if (m > 20 && m < 30) return 'From :21 to :29, the minutes count to halb, the half hour before the coming hour: fünf vor halb drei is 2:25.';
  if (m === 30) return 'Halb names the coming hour: halb drei is 2:30.';
  if (m > 30 && m < 40) return 'From :31 to :39, the minutes count past halb: fünf nach halb drei is 2:35.';
  if (m === 40) return '20 to is also said around halb: zehn nach halb drei is 2:40.';
  return undefined;
}

function norwegianTime({ minute: m }: ClockTime): string | undefined {
  const counted = m < 20 ? m : m < 30 ? 30 - m : m <= 40 ? m - 30 : 60 - m;
  return line([
    m >= 20 && m < 30 && 'From :20 to :29, the minutes count to halv, the half hour before the coming hour: ti på halv tre is 2:20.',
    m === 30 && 'Halv names the coming hour: halv tre is 2:30.',
    m > 30 && m <= 40 && 'From :31 to :40, the minutes count past halv: ti over halv tre is 2:40.',
    m !== 15 && m !== 30 && m !== 45 && counted % 5 !== 0 && "Minutes that aren't a multiple of 5 take minutter (one is ett minutt): sju minutter over to.",
  ]);
}

function greekTime({ hour: h, minute: m }: ClockTime): string | undefined {
  const said = hour12(m < 35 ? h : h + 1);
  const minutes = m < 35 ? (m === 15 || m === 30 ? 0 : m) : m === 45 ? 0 : 60 - m;
  const agrees = (n: number) => [1, 3, 4].includes(n % 10) && n !== 11;
  return line([
    (agrees(said) || agrees(minutes)) && 'The hour is feminine, agreeing with η ώρα: μία, τρεις, τέσσερις. The minutes are neuter: ένα, τρία, τέσσερα.',
    m >= 35 && 'From :35, παρά and the minutes to the next hour: τρεις παρά είκοσι πέντε is 2:35.',
  ]);
}

function japaneseTime({ hour: h, minute: m }: ClockTime): string | undefined {
  return line([
    [4, 7, 9].includes(hour12(h)) && "4, 7 and 9 o'clock are よじ, しちじ and くじ.",
    m !== 0 && m !== 30 && '分 is ぷん after a 1, 3, 4, 6 or 8 and after a ten (いっぷん, さんぷん, よんぷん, ろっぷん, はっぷん, じゅっぷん), and ふん after a 2, 5, 7 or 9 (にふん, ごふん, ななふん, きゅうふん).',
  ]);
}

function polishTime({ minute: m }: ClockTime): string | undefined {
  if (m === 0) return undefined;
  if (m < 30) return 'Minutes past take po and the hour in the locative: dziesięć po drugiej is 2:10, kwadrans po drugiej 2:15.';
  if (m === 30) return 'Half past counts toward the next hour: wpół do trzeciej is 2:30.';
  if (m < 35) return 'Just after half past, the clock is read as it shows: druga trzydzieści dwie is 2:32.';
  return 'From :35, za and the minutes left, then the next hour: za dziesięć trzecia is 2:50, za kwadrans trzecia 2:45.';
}

function russianTime({ minute: m }: ClockTime): string | undefined {
  if (m === 0) return 'On the hour, час for one, часа after 2 to 4, часов after 5 to 12: два часа, пять часов.';
  if (m < 30) return 'Minutes past count toward the next hour, its ordinal in the genitive: десять минут третьего is 2:10, четверть третьего 2:15.';
  if (m === 30) return 'Half past counts toward the next hour: половина третьего is 2:30.';
  if (m < 35) return 'Just after half past, the clock is read as it shows: два тридцать две is 2:32.';
  return 'From :35, без and the minutes left in the genitive, then the next hour: без десяти три is 2:50, без четверти три 2:45.';
}

/** The rule for saying `t` in `language`, if it has a short, certain one. */
export function timeRule(language: Language, t: ClockTime): string | undefined {
  switch (language) {
    case 'th': return THAI_BANDS[thaiHourBand(t.hour)];
    case 'es': return spanishTime(t);
    case 'fr': return frenchTime(t);
    case 'de': return germanTime(t);
    case 'nb': return norwegianTime(t);
    case 'el': return greekTime(t);
    case 'ja': return japaneseTime(t);
    case 'pl': return polishTime(t);
    case 'ru': return russianTime(t);
  }
}

// Counting money.

/** Which form a count takes in Polish and Russian: the number 1 itself, one ending in 1, 2 to 4, 11 to 19, or the rest. */
type Ending = 'one' | 'ends-1' | 'few' | 'teen' | 'many';

function endingOf(n: number): Ending {
  if (n % 100 >= 11 && n % 100 <= 19) return 'teen';
  if (n === 1) return 'one';
  if (n % 10 === 1) return 'ends-1';
  return n % 10 >= 2 && n % 10 <= 4 ? 'few' : 'many';
}

/** Polish (polishCountForm), for a noun's three forms: only 1 itself takes the singular; 21 takes the many form. */
function polishCount(one: string, few: string, many: string): Record<Ending, string> {
  return {
    one: `Only 1 itself takes ${one}; 21, 31 and so on take ${many}.`,
    'ends-1': `A number ending in 1 takes ${many}; only 1 itself takes ${one}: dwadzieścia jeden ${many}.`,
    few: `A number ending in 2, 3 or 4 takes ${few}, but 12 to 14 take ${many}: dwadzieścia dwa ${few}, dwanaście ${many}.`,
    teen: `11 to 19 take ${many}, 12 to 14 included: dwanaście ${many}.`,
    many: `A number ending in 0 or 5 to 9 takes ${many}: pięć ${many}, dwadzieścia ${many}.`,
  };
}

const ZLOTY = polishCount('złoty', 'złote', 'złotych');
const GROSZ = polishCount('grosz', 'grosze', 'groszy');

/** The złoty's rule, and the grosze's when it's a different one; the thousands' too. */
function polishMoney(whole: number, minor: number): string | undefined {
  const wholeEnding = whole ? endingOf(whole) : undefined;
  const minorEnding = minor ? endingOf(minor) : undefined;
  return line([
    wholeEnding && ZLOTY[wholeEnding],
    minorEnding && minorEnding !== wholeEnding && GROSZ[minorEnding],
    whole >= 2000 && 'Tysiąc counts the same way: dwa tysiące, pięć tysięcy.',
  ]);
}

const RUBLE_ENDS_1 = 'A number ending in 1 takes рубль, but 11 takes рублей: двадцать один рубль, одиннадцать рублей.';

/** Russian (countForm): 21 takes the singular like 1, but 11 doesn't. */
function russianMoney(whole: number): string | undefined {
  const rubles: Record<Ending, string> = {
    one: RUBLE_ENDS_1,
    'ends-1': RUBLE_ENDS_1,
    few: 'A number ending in 2, 3 or 4 takes рубля, but 12 to 14 take рублей: двадцать два рубля, двенадцать рублей.',
    teen: '11 to 19 take рублей, whatever they end in: одиннадцать рублей, двенадцать рублей.',
    many: 'A number ending in 0 or 5 to 9 takes рублей: пять рублей, двадцать рублей.',
  };
  return line([
    whole > 0 && rubles[endingOf(whole)],
    whole >= 2000 && 'Тысяча is feminine and counts like рубль: две тысячи, пять тысяч, двадцать одна тысяча.',
  ]);
}

/** The groups of three digits an amount is said in, thousands first: 1277 is [1, 277]. */
const groups = (n: number) => (n >= 1000 ? [Math.floor(n / 1000), n % 1000] : [n]);

function frenchMoney(whole: number, minor: number): string | undefined {
  const numbers = [whole, minor].filter(Boolean);
  const et = numbers.some((n) => groups(n).some((g) => [21, 31, 41, 51, 61, 71, 81, 91].includes(g % 100)));
  const plural = groups(whole).some((g) => Math.floor(g / 100) >= 2 || g % 100 >= 80) || (minor >= 80);
  return line([
    et && "21, 31, 41, 51, 61 and 71 take et: vingt et un, soixante et onze. 81 and 91 don't: quatre-vingt-un, quatre-vingt-onze.",
    plural && 'Quatre-vingts and the hundreds keep their s only at the end of the number: quatre-vingts euros, quatre-vingt-deux euros, deux cents euros, deux cent dix euros.',
  ]);
}

function spanishMoney(whole: number, minor: number): string | undefined {
  const un = [whole, minor].some((n) => n > 0 && n % 10 === 1 && n % 100 !== 11);
  return un ? 'Uno is cut to un before a masculine noun: un peso, veintiún pesos, treinta y un pesos.' : undefined;
}

function germanMoney(whole: number, minor: number): string | undefined {
  const compound = [whole, minor].some((n) => n % 100 > 20 && n % 10 !== 0);
  return compound ? 'The units come before the tens, joined by und: einundzwanzig, siebenundsiebzig.' : undefined;
}

function greekMoney(whole: number, minor: number): string | undefined {
  const neuter = [whole, minor].some((n) => [1, 3, 4].includes(n % 10) && n % 100 !== 11);
  return line([
    neuter && 'Euro and λεπτό are neuter, so 1, 3 and 4 are ένα, τρία, τέσσερα: τρία ευρώ, τέσσερα λεπτά.',
    whole >= 1000 && "1,000 is χίλια; from 2,000 it's χιλιάδες, counted in the feminine: τρεις χιλιάδες, τέσσερις χιλιάδες.",
  ]);
}

function japaneseMoney(yen: number): string | undefined {
  const hundreds = Math.floor(yen / 100) % 10;
  const thousands = Math.floor(yen / 1000) % 10;
  return line([
    ([3, 6, 8].includes(hundreds) || [3, 8].includes(thousands)) && '百 and 千 change their sound after some digits: さんびゃく, ろっぴゃく, はっぴゃく, さんぜん, はっせん.',
    yen >= 10_000 && yen < 20_000 && '10,000 is 一万, いちまん: unlike 百 and 千, 万 keeps its 一.',
    yen % 10 === 4 && '4 yen is よえん, not よんえん: じゅうよえん.',
  ]);
}

function thaiMoney(whole: number, minor: number): string | undefined {
  const numbers = [whole, minor];
  return line([
    numbers.some((n) => Math.floor(n / 10) % 10 === 2) && '20 is ยี่สิบ, not สองสิบ: ยี่สิบห้า is 25.',
    numbers.some((n) => n > 10 && n % 10 === 1) && 'A 1 at the end of a longer number is เอ็ด: สิบเอ็ด is 11, ยี่สิบเอ็ด 21.',
  ]);
}

/** The rule for saying `amount` (in minor units of `currency`) in `language`, if it has a short, certain one. */
export function moneyRule(language: Language, amount: number, currency: Currency): string | undefined {
  const whole = Math.floor(amount / currency.minorPerMajor);
  const minor = amount % currency.minorPerMajor;
  switch (language) {
    case 'pl': return polishMoney(whole, minor);
    case 'ru': return minor ? undefined : russianMoney(whole);
    case 'fr': return frenchMoney(whole, minor);
    case 'es': return spanishMoney(whole, minor);
    case 'de': return germanMoney(whole, minor);
    case 'el': return greekMoney(whole, minor);
    case 'ja': return japaneseMoney(whole);
    case 'th': return thaiMoney(whole, minor);
    case 'nb': return undefined;
  }
}

// Saying dates.

/** The days of the month with their own reading in Japanese (japanese/numbers.ts). */
const JAPANESE_OWN_DAYS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24]);

function japaneseDate(d: CalendarDate, parts: DateParts): string | undefined {
  return line([
    [4, 7, 9].includes(d.month) && 'April, July and September are しがつ, しちがつ and くがつ.',
    JAPANESE_OWN_DAYS.has(d.day)
      ? '1 to 10, 14, 20 and 24 have their own readings: ついたち, ふつか, みっか, よっか, いつか, むいか, なのか, ようか, ここのか, とおか, じゅうよっか, はつか, にじゅうよっか.'
      : 'The other days are the number and にち, with 7 and 9 read しち and く: じゅうしちにち, にじゅうくにち.',
    parts.year && d.year % 10 === 4 && 'A year ending in 4 reads よねん: にせんにじゅうよねん.',
  ]);
}

const compoundDay = (day: number) => day > 20 && day % 10 !== 0;

function polishDate(d: CalendarDate, parts: DateParts): string | undefined {
  return line([
    compoundDay(d.day) ? 'In a compound ordinal both words are ordinals: dwudziesty pierwszy.' : 'The day is an ordinal and the month is in the genitive: dwunasty listopada.',
    parts.year && d.year % 100 !== 0 && 'In the year only the tens and units are ordinals, in the genitive before roku: dwa tysiące dwudziestego szóstego roku.',
  ]);
}

function russianDate(d: CalendarDate, parts: DateParts): string | undefined {
  return line([
    compoundDay(d.day) ? 'In a compound ordinal only the last word is an ordinal: двадцать первое.' : 'The day is a neuter ordinal (число) and the month is in the genitive: двенадцатое ноября.',
    parts.year && 'In the year only the last word is an ordinal, in the genitive before года: две тысячи двадцать шестого года.',
  ]);
}

/** The rule for saying `d` in `language`, if it has a short, certain one. */
export function dateRule(language: Language, d: CalendarDate, parts: DateParts): string | undefined {
  switch (language) {
    case 'ja': return japaneseDate(d, parts);
    case 'pl': return polishDate(d, parts);
    case 'ru': return russianDate(d, parts);
    case 'de': return 'The day is an ordinal: up to 19 it adds -te (der zwölfte), from 20 -ste (der zwanzigste); der erste, dritte, siebte and achte are irregular.';
    case 'fr': return d.day === 1 ? 'The first is premier; the other days are plain numbers: deux novembre.' : undefined;
    case 'es': return d.day === 1 ? 'The first is primero (uno is heard more in Spain); the other days are plain numbers: dos de noviembre.' : undefined;
    case 'el': return d.day === 1 || ([1, 3, 4].includes(d.day % 10) && d.day !== 11)
      ? 'The first is πρώτη; the other days are feminine numbers (η ημέρα): τρεις, τέσσερις, είκοσι μία Νοεμβρίου.'
      : undefined;
    case 'th':
    case 'nb':
      return undefined;
  }
}

// Numbers.

/** 70 to 99 in French, whether as a number or inside a phone number's pair. */
const FRENCH_SEVENTIES_UP = /soixante(-| et )(dix|onze|douze|treize|quatorze|quinze|seize)|quatre-vingt/;

function frenchNumberRule(q: NumberQuestion, said: string): string | undefined {
  return line([
    q.kind === 'phone' && 'A phone number is read in pairs: 06 is zéro six, 42 quarante-deux.',
    FRENCH_SEVENTIES_UP.test(said) && '70 to 79 are soixante and 10 to 19 (soixante-douze is 72); 80 is quatre-vingts, and 90 to 99 are quatre-vingt and 10 to 19 (quatre-vingt-treize is 93).',
  ]);
}

function germanNumberRule(q: NumberQuestion): string | undefined {
  if (q.kind === 'phone') return undefined;
  const lastTwo = q.n % 100;
  return lastTwo > 20 && lastTwo % 10 ? 'The ones come before the tens, joined by und: siebenundachtzig is 87.' : undefined;
}

function polishNumberRule(q: NumberQuestion): string | undefined {
  if (q.kind === 'phone') return 'A phone number is read in its threes: 512 is pięćset dwanaście.';
  if (q.kind === 'age') return "After 2, 3 and 4 it's lata, but not after 12 to 14; after the rest it's lat: dwadzieścia dwa lata, dwanaście lat, dwadzieścia pięć lat.";
  if (q.kind === 'year' && q.n % 100) return 'In a year only the tens and ones are ordinals: tysiąc dziewięćset osiemdziesiąty siódmy. After w they end in -ym: w tysiąc dziewięćset osiemdziesiątym siódmym roku.';
  return undefined;
}

function russianNumberRule(q: NumberQuestion): string | undefined {
  if (q.kind === 'phone') return 'A phone number is read in its groups: 912 is девятьсот двенадцать, 67 шестьдесят семь.';
  if (q.kind === 'age') return '1, 21, 31 take год; 2 to 4 take года; the rest take лет, 11 to 14 included: двадцать один год, двадцать два года, двадцать пять лет.';
  if (q.kind === 'year' && q.n % 100) return 'In a year only the last word is an ordinal: тысяча девятьсот восемьдесят седьмой. After в it ends in -ом: в тысяча девятьсот восемьдесят седьмом году.';
  return undefined;
}

function japaneseNumberRule(q: NumberQuestion): string | undefined {
  if (q.kind === 'phone') return 'A phone number is read digit by digit, 0 as ゼロ, and each dash as の.';
  if (q.kind === 'age') {
    if (q.n === 20) return 'Twenty years old is はたち.';
    if (q.n % 10 === 1 || q.n % 10 === 8 || q.n % 10 === 0) return '歳 changes the sound of 1, 8 and 10: いっさい, はっさい, じゅっさい.';
    return undefined;
  }
  return q.kind === 'number' && q.n >= 10_000 ? 'Japanese counts in 万, ten thousands: 12,345 is 一万二千三百四十五, いちまんにせんさんびゃくよんじゅうご.' : undefined;
}

function greekNumberRule(q: NumberQuestion): string | undefined {
  if (q.kind !== 'age') return undefined;
  const last = q.n % 10;
  return (last === 1 || last === 3 || last === 4) && q.n !== 11
    ? 'An age is in the genitive: ένα, τρία and τέσσερα become ενός, τριών, τεσσάρων. The other numbers stay as they are: είμαι τριάντα τεσσάρων χρονών.'
    : undefined;
}

/** The rule for saying `q` in `language`, if it has a short, certain one. `said` is the answer's usual form. */
export function numberRule(language: Language, q: NumberQuestion, said: string): string | undefined {
  switch (language) {
    case 'fr': return frenchNumberRule(q, said);
    case 'es': return q.kind === 'phone' ? 'A phone number is read in pairs: 55 is cincuenta y cinco, 05 cero cinco.' : undefined;
    case 'de': return germanNumberRule(q);
    case 'pl': return polishNumberRule(q);
    case 'ru': return russianNumberRule(q);
    case 'ja': return japaneseNumberRule(q);
    case 'el': return greekNumberRule(q);
    case 'th': return q.kind === 'year' ? 'Thai counts years from the Buddha, 543 more than the Christian year: พ.ศ. 2530 is 1987.' : undefined;
    case 'nb':
    case 'en':
      return undefined;
  }
}
