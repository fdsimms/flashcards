import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../../src/tools/money';
import type { Phrase } from '../../src/tools/phrase';
import { dateRule, moneyRule, numberRule, timeRule } from '../../src/tools/rules';
import { DATE_SAYERS, MONEY_SAYERS, NUMBER_SAYERS, TIME_SAYERS } from '../../src/tools/tools';
import type { NumberQuestion } from '../../src/tools/number';
import type { Language } from '../../src/reader/api';

/**
 * Each rule's examples are checked against what that language's sayer says, so a rule never
 * teaches a form the answer itself doesn't use. Then, which rule a question gets, at the edges.
 */

const at = (hour: number, minute: number) => ({ hour, minute });
const texts = (s: { everyday: Phrase; also: Phrase[] }, last: Phrase) => [s.everyday, ...s.also, last].map((p) => p.text);
const readings = (s: { everyday: Phrase; also: Phrase[] }) => [s.everyday, ...s.also].map((p) => p.roman ?? '');

/** Every way `language` says the time `h:m`: in conversation, other ways, formal. */
function timeSaid(language: Language, h: number, m: number): string[] {
  const s = TIME_SAYERS[language]!(at(h, m));
  return texts(s, s.formal);
}

/** The usual way `language` says the time `h:m`. */
const timeEveryday = (language: Language, h: number, m: number) => TIME_SAYERS[language]!(at(h, m)).everyday.text;

/** The usual way `language` says `amount` (in whole units, plus `minor`). */
const moneyEveryday = (language: Language, whole: number, minor = 0) => MONEY_SAYERS[language]!(whole * 100 + minor).everyday;

const dateEveryday = (language: Language, year: number, month: number, day: number, withYear = false) =>
  DATE_SAYERS[language]!({ year, month, day }, { weekday: false, year: withYear }).everyday;

const rule = {
  time: (language: Language, h: number, m: number) => timeRule(language, at(h, m)),
  money: (language: Language, whole: number, minor = 0) => moneyRule(language, whole * 100 + minor, CURRENCIES.PLN),
  date: (language: Language, month: number, day: number, year = 2026, withYear = false) => dateRule(language, { year, month, day }, { weekday: false, year: withYear }),
};

describe('the examples in the time rules', () => {
  it('are what Thai says', () => {
    expect([[1, 'ตีหนึ่ง'], [5, 'ตีห้า'], [6, 'หกโมงเช้า'], [11, 'สิบเอ็ดโมงเช้า'], [13, 'บ่ายโมง'], [14, 'บ่ายสองโมง'], [17, 'ห้าโมงเย็น'], [18, 'หกโมงเย็น'], [19, 'หนึ่งทุ่ม'], [23, 'ห้าทุ่ม']]
      .every(([h, said]) => timeEveryday('th', h as number, 0) === said)).toBe(true);
    // เช้า and เย็น left off once minutes follow.
    expect(timeEveryday('th', 9, 30)).toBe('เก้าโมงครึ่ง');
    expect(timeEveryday('th', 17, 30)).toBe('ห้าโมงครึ่ง');
  });

  it('are what Spanish says', () => {
    expect(timeEveryday('es', 14, 50)).toBe('diez para las tres');
    expect(timeSaid('es', 14, 50)).toContain('las tres menos diez');
    expect(timeEveryday('es', 1, 0)).toBe('la una');
    expect(timeEveryday('es', 13, 10)).toBe('la una y diez');
    expect(timeEveryday('es', 0, 0)).toBe('las doce');
    expect(timeEveryday('es', 12, 0)).toBe('las doce');
    expect(timeSaid('es', 12, 0)).toContain('mediodía');
    expect(timeSaid('es', 0, 0)).toContain('medianoche');
  });

  it('are what French says', () => {
    expect(timeEveryday('fr', 14, 50)).toBe('trois heures moins dix');
    expect(timeEveryday('fr', 14, 45)).toBe('trois heures moins le quart');
    expect(timeEveryday('fr', 12, 30)).toBe('midi et demi');
    expect(timeEveryday('fr', 0, 30)).toBe('minuit et demi');
    expect(timeEveryday('fr', 13, 0)).toBe('une heure');
    expect(timeEveryday('fr', 14, 21)).toBe('deux heures vingt et une');
  });

  it('are what German says', () => {
    expect(timeSaid('de', 14, 20)).toContain('zehn vor halb drei');
    expect(timeEveryday('de', 14, 25)).toBe('fünf vor halb drei');
    expect(timeEveryday('de', 14, 30)).toBe('halb drei');
    expect(timeEveryday('de', 14, 35)).toBe('fünf nach halb drei');
    expect(timeSaid('de', 14, 40)).toContain('zehn nach halb drei');
    expect(timeSaid('de', 13, 0)).toEqual(expect.arrayContaining(['ein Uhr', 'eins']));
  });

  it('are what Norwegian says', () => {
    expect(timeEveryday('nb', 14, 20)).toBe('ti på halv tre');
    expect(timeEveryday('nb', 14, 30)).toBe('halv tre');
    expect(timeEveryday('nb', 14, 40)).toBe('ti over halv tre');
    expect(timeEveryday('nb', 14, 7)).toBe('sju minutter over to');
    expect(timeEveryday('nb', 14, 1)).toBe('ett minutt over to');
  });

  it('are what Greek says', () => {
    expect(timeEveryday('el', 14, 35)).toBe('τρεις παρά είκοσι πέντε');
    expect([1, 3, 4].map((h) => timeEveryday('el', h, 0))).toEqual(['μία', 'τρεις', 'τέσσερις']);
    expect([1, 3, 4].map((m) => timeEveryday('el', 2, m))).toEqual(['δύο και ένα', 'δύο και τρία', 'δύο και τέσσερα']);
  });

  it('are what Japanese says', () => {
    expect([4, 7, 9].map((h) => TIME_SAYERS.ja!(at(h, 0)).everyday.roman)).toEqual(['よじ', 'しちじ', 'くじ']);
    const minute = (m: number) => TIME_SAYERS.ja!(at(2, m)).everyday.roman!.split(' ')[1];
    expect([1, 3, 4, 6, 8, 10].map(minute)).toEqual(['いっぷん', 'さんぷん', 'よんぷん', 'ろっぷん', 'はっぷん', 'じゅっぷん']);
    expect([2, 5, 7, 9].map(minute)).toEqual(['にふん', 'ごふん', 'ななふん', 'きゅうふん']);
    expect([20, 40, 50].map(minute)).toEqual(['にじゅっぷん', 'よんじゅっぷん', 'ごじゅっぷん']);
  });

  it('are what Polish says', () => {
    expect(timeEveryday('pl', 14, 10)).toBe('dziesięć po drugiej');
    expect(timeEveryday('pl', 14, 15)).toBe('kwadrans po drugiej');
    expect(timeEveryday('pl', 14, 30)).toBe('wpół do trzeciej');
    expect(timeEveryday('pl', 14, 32)).toBe('druga trzydzieści dwie');
    expect(timeEveryday('pl', 14, 50)).toBe('za dziesięć trzecia');
    expect(timeEveryday('pl', 14, 45)).toBe('za kwadrans trzecia');
  });

  it('are what Russian says', () => {
    expect([1, 2, 5].map((h) => timeEveryday('ru', h, 0))).toEqual(['час', 'два часа', 'пять часов']);
    expect(timeEveryday('ru', 14, 10)).toBe('десять минут третьего');
    expect(timeEveryday('ru', 14, 15)).toBe('четверть третьего');
    expect(timeEveryday('ru', 14, 30)).toBe('половина третьего');
    expect(timeEveryday('ru', 14, 32)).toBe('два тридцать две');
    expect(timeEveryday('ru', 14, 50)).toBe('без десяти три');
    expect(timeEveryday('ru', 14, 45)).toBe('без четверти три');
  });
});

describe('which time rule a question gets', () => {
  it('gives Thai the part of the day the hour is said in, at its edges', () => {
    expect(rule.time('th', 1, 0)).toMatch(/^1 to 5 a\.m\. are ตี/);
    expect(rule.time('th', 5, 59)).toMatch(/^1 to 5 a\.m\./);
    expect(rule.time('th', 6, 0)).toMatch(/^6 to 11 a\.m\./);
    expect(rule.time('th', 13, 0)).toMatch(/^1 to 4 p\.m\. are บ่าย/);
    expect(rule.time('th', 16, 59)).toMatch(/^1 to 4 p\.m\./);
    expect(rule.time('th', 17, 0)).toMatch(/^5 and 6 p\.m\./);
    expect(rule.time('th', 18, 59)).toMatch(/^5 and 6 p\.m\./);
    expect(rule.time('th', 19, 0)).toMatch(/^7 to 11 p\.m\. are ทุ่ม/);
    expect(rule.time('th', 23, 59)).toMatch(/ทุ่ม/);
    // Noon and midnight have no band rule.
    expect(rule.time('th', 12, 0)).toBeUndefined();
    expect(rule.time('th', 0, 30)).toBeUndefined();
  });

  it('gives German its halb rules from :20 to :40 and nothing outside them', () => {
    expect(rule.time('de', 14, 19)).toBeUndefined();
    expect(rule.time('de', 14, 20)).toMatch(/^20 past is also said around halb/);
    expect(rule.time('de', 14, 21)).toMatch(/^From :21 to :29/);
    expect(rule.time('de', 14, 29)).toMatch(/^From :21 to :29/);
    expect(rule.time('de', 14, 30)).toMatch(/^Halb names the coming hour/);
    expect(rule.time('de', 14, 31)).toMatch(/^From :31 to :39/);
    expect(rule.time('de', 14, 39)).toMatch(/^From :31 to :39/);
    expect(rule.time('de', 14, 40)).toMatch(/^20 to is also said around halb/);
    expect(rule.time('de', 14, 41)).toBeUndefined();
    expect(rule.time('de', 13, 0)).toMatch(/ein Uhr/);
    expect(rule.time('de', 14, 0)).toBeUndefined();
  });

  it('gives Norwegian its halv rules from :20 to :40, and minutter where it applies', () => {
    expect(rule.time('nb', 14, 19)).toMatch(/^Minutes that aren't a multiple of 5/);
    expect(rule.time('nb', 14, 20)).toMatch(/^From :20 to :29/);
    expect(rule.time('nb', 14, 30)).toMatch(/^Halv names the coming hour/);
    expect(rule.time('nb', 14, 40)).toMatch(/^From :31 to :40/);
    expect(rule.time('nb', 14, 41)).toMatch(/^Minutes that aren't/);
    expect(rule.time('nb', 14, 45)).toBeUndefined();
    expect(rule.time('nb', 14, 50)).toBeUndefined();
    // 2:23 is seven minutes to halv: both rules.
    expect(rule.time('nb', 14, 23)).toMatch(/^From :20 to :29.* Minutes that aren't/);
  });

  it('gives Japanese the hour readings and the minute readings', () => {
    expect(rule.time('ja', 16, 0)).toMatch(/^4, 7 and 9 o'clock/);
    expect(rule.time('ja', 4, 30)).toMatch(/^4, 7 and 9 o'clock[^分]*$/);
    expect(rule.time('ja', 14, 5)).toMatch(/^分 is ぷん/);
    expect(rule.time('ja', 21, 6)).toMatch(/^4, 7 and 9 o'clock.* 分 is ぷん/);
    expect(rule.time('ja', 10, 0)).toBeUndefined();
    expect(rule.time('ja', 10, 30)).toBeUndefined();
  });

  it('gives Greek the feminine hour when 1, 3 or 4 is said, and παρά from :35', () => {
    expect(rule.time('el', 13, 0)).toMatch(/^The hour is feminine/);
    expect(rule.time('el', 2, 10)).toBeUndefined();
    expect(rule.time('el', 2, 34)).toMatch(/^The hour is feminine/);
    expect(rule.time('el', 2, 35)).toMatch(/^The hour is feminine.* From :35, παρά/);
    expect(rule.time('el', 5, 35)).toMatch(/^From :35, παρά/);
    expect(rule.time('el', 2, 11)).toBeUndefined();
  });

  it('gives Spanish and French noon and midnight, and Spanish la una', () => {
    expect(rule.time('es', 12, 0)).toMatch(/^Noon and midnight are both las doce/);
    expect(rule.time('es', 0, 0)).toMatch(/^Noon and midnight/);
    expect(rule.time('es', 12, 10)).toBeUndefined();
    expect(rule.time('es', 13, 10)).toMatch(/^One o'clock takes la/);
    expect(rule.time('es', 12, 50)).toMatch(/^From :40.* One o'clock takes la/);
    expect(rule.time('fr', 12, 30)).toMatch(/^In conversation, 12 o'clock is midi or minuit/);
    expect(rule.time('fr', 11, 50)).toMatch(/^In conversation, 12 o'clock.* From :40/);
    expect(rule.time('fr', 14, 21)).toMatch(/^Heure and minute are feminine/);
    expect(rule.time('fr', 0, 59)).toMatch(/Heure and minute are feminine/);
    expect(rule.time('fr', 14, 11)).toBeUndefined();
  });

  it('gives Polish and Russian the way each part of the hour is counted', () => {
    expect(rule.time('pl', 14, 0)).toBeUndefined();
    expect(rule.time('pl', 14, 1)).toMatch(/^Minutes past take po/);
    expect(rule.time('pl', 14, 29)).toMatch(/^Minutes past take po/);
    expect(rule.time('pl', 14, 30)).toMatch(/^Half past/);
    expect(rule.time('pl', 14, 34)).toMatch(/^Just after half past/);
    expect(rule.time('pl', 14, 35)).toMatch(/^From :35, za/);
    expect(rule.time('ru', 14, 0)).toMatch(/^On the hour/);
    expect(rule.time('ru', 14, 1)).toMatch(/^Minutes past count toward the next hour/);
    expect(rule.time('ru', 14, 30)).toMatch(/^Half past/);
    expect(rule.time('ru', 14, 33)).toMatch(/^Just after half past/);
    expect(rule.time('ru', 14, 35)).toMatch(/^From :35, без/);
  });
});

describe('the examples in the money rules', () => {
  it('are what Polish says', () => {
    const said = (whole: number, minor = 0) => moneyEveryday('pl', whole, minor).text;
    expect([22, 12, 5, 20, 21, 1].map((n) => said(n))).toEqual(['dwadzieścia dwa złote', 'dwanaście złotych', 'pięć złotych', 'dwadzieścia złotych', 'dwadzieścia jeden złotych', 'jeden złoty']);
    expect([22, 12, 5, 20, 21, 1].map((n) => said(0, n))).toEqual(['dwadzieścia dwa grosze', 'dwanaście groszy', 'pięć groszy', 'dwadzieścia groszy', 'dwadzieścia jeden groszy', 'jeden grosz']);
    expect(said(2000)).toBe('dwa tysiące złotych');
    expect(said(5000)).toBe('pięć tysięcy złotych');
  });

  it('are what Russian says', () => {
    const said = (n: number) => moneyEveryday('ru', n).text;
    expect([21, 11, 22, 12, 5, 20].map(said)).toEqual(['двадцать один рубль', 'одиннадцать рублей', 'двадцать два рубля', 'двенадцать рублей', 'пять рублей', 'двадцать рублей']);
    expect([2000, 5000, 21000].map(said)).toEqual(['две тысячи рублей', 'пять тысяч рублей', 'двадцать одна тысяча рублей']);
  });

  it('are what French, Spanish and German say', () => {
    const fr = (n: number) => moneyEveryday('fr', n).text;
    expect([21, 71, 81, 91, 80, 82, 200, 210].map(fr)).toEqual(['vingt et un euros', 'soixante et onze euros', 'quatre-vingt-un euros', 'quatre-vingt-onze euros',
      'quatre-vingts euros', 'quatre-vingt-deux euros', 'deux cents euros', 'deux cent dix euros']);
    expect([1, 21, 31].map((n) => moneyEveryday('es', n).text)).toEqual(['un peso', 'veintiún pesos', 'treinta y un pesos']);
    expect([21, 77].map((n) => moneyEveryday('de', n).text)).toEqual(['einundzwanzig Euro', 'siebenundsiebzig Euro']);
  });

  it('are what Greek says', () => {
    expect(moneyEveryday('el', 3).text).toBe('τρία ευρώ');
    expect(moneyEveryday('el', 0, 4).text).toBe('τέσσερα λεπτά');
    expect([1000, 3000, 4000].map((n) => moneyEveryday('el', n).text)).toEqual(['χίλια ευρώ', 'τρεις χιλιάδες ευρώ', 'τέσσερις χιλιάδες ευρώ']);
  });

  it('are what Japanese and Thai say', () => {
    const ja = (n: number) => moneyEveryday('ja', n).roman;
    expect([300, 600, 800, 3000, 8000, 10000, 4, 14].map(ja)).toEqual(['さんびゃくえん', 'ろっぴゃくえん', 'はっぴゃくえん', 'さんぜんえん', 'はっせんえん', 'いちまんえん', 'よえん', 'じゅうよえん']);
    expect([25, 11, 21].map((n) => moneyEveryday('th', n).text)).toEqual(['ยี่สิบห้าบาท', 'สิบเอ็ดบาท', 'ยี่สิบเอ็ดบาท']);
  });
});

describe('which money rule an amount gets', () => {
  it('gives Polish the złoty form its ending takes, 12 to 14 and 21 included', () => {
    expect(rule.money('pl', 1)).toMatch(/^Only 1 itself takes złoty/);
    expect(rule.money('pl', 21)).toMatch(/^A number ending in 1 takes złotych/);
    expect(rule.money('pl', 22)).toMatch(/^A number ending in 2, 3 or 4 takes złote/);
    expect(rule.money('pl', 122)).toMatch(/^A number ending in 2, 3 or 4/);
    for (const n of [12, 13, 14, 112]) expect(rule.money('pl', n)).toMatch(/^11 to 19 take złotych/);
    expect(rule.money('pl', 25)).toMatch(/^A number ending in 0 or 5 to 9 takes złotych/);
    expect(rule.money('pl', 20)).toMatch(/^A number ending in 0 or 5 to 9/);
  });

  it('adds the grosze when their ending takes another form, and the thousands', () => {
    expect(rule.money('pl', 22, 15)).toMatch(/takes złote.* 11 to 19 take groszy/);
    expect(rule.money('pl', 22, 23)).not.toMatch(/grosz/);
    expect(rule.money('pl', 0, 2)).toMatch(/^A number ending in 2, 3 or 4 takes grosze/);
    expect(rule.money('pl', 1999)).not.toMatch(/Tysiąc/);
    expect(rule.money('pl', 2000)).toMatch(/Tysiąc counts the same way/);
  });

  it('gives Russian the рубль form, 11 to 14 included, and the thousands', () => {
    expect(rule.money('ru', 1)).toMatch(/^A number ending in 1 takes рубль/);
    expect(rule.money('ru', 21)).toMatch(/^A number ending in 1 takes рубль/);
    expect(rule.money('ru', 11)).toMatch(/^11 to 19 take рублей/);
    expect(rule.money('ru', 111)).toMatch(/^11 to 19 take рублей/);
    expect(rule.money('ru', 24)).toMatch(/^A number ending in 2, 3 or 4 takes рубля/);
    expect(rule.money('ru', 5000)).toMatch(/рублей.* Тысяча is feminine/);
  });

  it('gives French et and the s of quatre-vingts and the hundreds only where they come up', () => {
    expect(rule.money('fr', 21)).toMatch(/^21, 31, 41, 51, 61 and 71 take et/);
    expect(rule.money('fr', 81)).toMatch(/81 and 91 don't/);
    expect(rule.money('fr', 1021)).toMatch(/take et/);
    expect(rule.money('fr', 11)).toBeUndefined();
    expect(rule.money('fr', 80)).toMatch(/^Quatre-vingts and the hundreds/);
    expect(rule.money('fr', 210)).toMatch(/^Quatre-vingts and the hundreds/);
    expect(rule.money('fr', 150)).toBeUndefined();
  });

  it('gives Spanish un, German the units first, and nothing where they do not come up', () => {
    expect(rule.money('es', 21)).toMatch(/^Uno is cut to un/);
    expect(rule.money('es', 11)).toBeUndefined();
    expect(rule.money('es', 20, 50)).toBeUndefined();
    expect(rule.money('de', 77)).toMatch(/^The units come before the tens/);
    expect(rule.money('de', 17)).toBeUndefined();
    expect(rule.money('de', 70)).toBeUndefined();
    expect(rule.money('nb', 21)).toBeUndefined();
  });

  it('gives Greek the neuter euro and the feminine thousands', () => {
    expect(rule.money('el', 3)).toMatch(/^Euro and λεπτό are neuter/);
    expect(rule.money('el', 11)).toBeUndefined();
    expect(rule.money('el', 3000)).toMatch(/^1,000 is χίλια/);
    expect(rule.money('el', 1003)).toMatch(/neuter.* 1,000 is χίλια/);
  });

  it('gives Japanese the sound changes, 一万 and よえん', () => {
    expect(rule.money('ja', 300)).toMatch(/^百 and 千 change/);
    expect(rule.money('ja', 3000)).toMatch(/^百 and 千 change/);
    expect(rule.money('ja', 6000)).toBeUndefined();
    expect(rule.money('ja', 10000)).toMatch(/^10,000 is 一万/);
    expect(rule.money('ja', 24)).toMatch(/^4 yen is よえん/);
    expect(rule.money('ja', 125)).toBeUndefined();
  });

  it('gives Thai ยี่สิบ and เอ็ด', () => {
    expect(rule.money('th', 25)).toMatch(/^20 is ยี่สิบ/);
    expect(rule.money('th', 101)).toMatch(/^A 1 at the end/);
    expect(rule.money('th', 1)).toBeUndefined();
    expect(rule.money('th', 35)).toBeUndefined();
  });
});

describe('the examples in the date rules', () => {
  it('are what Japanese says', () => {
    expect([4, 7, 9].map((m) => dateEveryday('ja', 2026, m, 12).roman!.split(' ')[0])).toEqual(['しがつ', 'しちがつ', 'くがつ']);
    const day = (d: number) => dateEveryday('ja', 2026, 1, d).roman!.split(' ')[1];
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24].map(day).join(', '))
      .toBe('ついたち, ふつか, みっか, よっか, いつか, むいか, なのか, ようか, ここのか, とおか, じゅうよっか, はつか, にじゅうよっか');
    expect([17, 29].map(day)).toEqual(['じゅうしちにち', 'にじゅうくにち']);
    expect(dateEveryday('ja', 2024, 1, 13, true).roman!.split(' ')[0]).toBe('にせんにじゅうよねん');
  });

  it('are what Polish and Russian say', () => {
    expect(dateEveryday('pl', 2026, 11, 21).text).toBe('dwudziesty pierwszy listopada');
    expect(dateEveryday('pl', 2026, 11, 12).text).toBe('dwunasty listopada');
    expect(dateEveryday('pl', 2026, 11, 12, true).text).toBe('dwunasty listopada dwa tysiące dwudziestego szóstego roku');
    expect(dateEveryday('ru', 2026, 11, 21).text).toBe('двадцать первое ноября');
    expect(dateEveryday('ru', 2026, 11, 12).text).toBe('двенадцатое ноября');
    expect(dateEveryday('ru', 2026, 11, 12, true).text).toBe('двенадцатое ноября две тысячи двадцать шестого года');
  });

  it('are what German, French, Spanish and Greek say', () => {
    expect([12, 20, 1, 3, 7, 8].map((d) => dateEveryday('de', 2026, 11, d).text.split(' ')[1])).toEqual(['zwölfte', 'zwanzigste', 'erste', 'dritte', 'siebte', 'achte']);
    expect(dateEveryday('fr', 2026, 11, 1).text).toBe('premier novembre');
    expect(dateEveryday('fr', 2026, 11, 2).text).toBe('deux novembre');
    expect(dateEveryday('es', 2026, 11, 1).text).toBe('primero de noviembre');
    expect(dateEveryday('es', 2026, 11, 2).text).toBe('dos de noviembre');
    expect([1, 3, 4, 21].map((d) => dateEveryday('el', 2026, 11, d).text)).toEqual(['πρώτη Νοεμβρίου', 'τρεις Νοεμβρίου', 'τέσσερις Νοεμβρίου', 'είκοσι μία Νοεμβρίου']);
  });
});

describe('which date rule a date gets', () => {
  it('gives Japanese its own day readings, the irregular months, and a year ending in 4', () => {
    expect(rule.date('ja', 11, 14)).toMatch(/^1 to 10, 14, 20 and 24 have their own readings/);
    expect(rule.date('ja', 11, 24)).toMatch(/^1 to 10, 14, 20 and 24/);
    expect(rule.date('ja', 11, 13)).toMatch(/^The other days are the number and にち/);
    expect(rule.date('ja', 4, 13)).toMatch(/^April, July and September.* The other days/);
    expect(rule.date('ja', 11, 13, 2024, true)).toMatch(/A year ending in 4 reads よねん/);
    expect(rule.date('ja', 11, 13, 2024, false)).not.toMatch(/year/);
  });

  it('gives Polish and Russian their compound ordinals, and the year only when it is said', () => {
    expect(rule.date('pl', 11, 21)).toMatch(/^In a compound ordinal both words/);
    expect(rule.date('pl', 11, 20)).toMatch(/^The day is an ordinal/);
    expect(rule.date('pl', 11, 30)).toMatch(/^The day is an ordinal/);
    expect(rule.date('pl', 11, 12, 2026, true)).toMatch(/In the year only the tens and units/);
    expect(rule.date('pl', 11, 12, 2000, true)).not.toMatch(/In the year/);
    expect(rule.date('ru', 11, 31)).toMatch(/^In a compound ordinal only the last word/);
    expect(rule.date('ru', 11, 12)).toMatch(/^The day is a neuter ordinal/);
    expect(rule.date('ru', 11, 12, 2026, true)).toMatch(/In the year only the last word/);
  });

  it('gives French, Spanish and Greek the first, and Greek the feminine days', () => {
    expect(rule.date('fr', 11, 1)).toMatch(/^The first is premier/);
    expect(rule.date('fr', 11, 2)).toBeUndefined();
    expect(rule.date('es', 11, 1)).toMatch(/^The first is primero/);
    expect(rule.date('es', 11, 21)).toBeUndefined();
    for (const d of [1, 3, 4, 13, 14, 21, 31]) expect(rule.date('el', 11, d)).toMatch(/^The first is πρώτη/);
    for (const d of [2, 11, 12, 25]) expect(rule.date('el', 11, d)).toBeUndefined();
    expect(rule.date('th', 11, 1)).toBeUndefined();
  });
});

describe('the number rules', () => {
  const said = (language: Language, q: NumberQuestion) => NUMBER_SAYERS[language]!(q).everyday.text;
  const age = (n: number): NumberQuestion => ({ kind: 'age', n });
  const year = (n: number): NumberQuestion => ({ kind: 'year', n });
  const num = (n: number): NumberQuestion => ({ kind: 'number', n });
  const ruleFor = (language: Language, q: NumberQuestion) => numberRule(language, q, said(language, q));

  it('give examples each language says', () => {
    expect(said('fr', { kind: 'phone', written: '06 42 00 00 00' }).startsWith('zéro six, quarante-deux')).toBe(true);
    expect([72, 80, 93].map((n) => said('fr', num(n)))).toEqual(['soixante-douze', 'quatre-vingts', 'quatre-vingt-treize']);
    expect(said('es', { kind: 'phone', written: '55 0500 0000' }).startsWith('cincuenta y cinco, cero cinco')).toBe(true);
    expect(said('de', num(87))).toBe('siebenundachtzig');
    expect(said('pl', { kind: 'phone', written: '512 000 000' }).startsWith('pięćset dwanaście')).toBe(true);
    expect([22, 12, 25].map((n) => said('pl', age(n)))).toEqual(['mam dwadzieścia dwa lata', 'mam dwanaście lat', 'mam dwadzieścia pięć lat']);
    expect(said('pl', year(1987))).toBe('tysiąc dziewięćset osiemdziesiąty siódmy');
    expect(NUMBER_SAYERS.pl!(year(1987)).also[0].text).toBe('w tysiąc dziewięćset osiemdziesiątym siódmym roku');
    expect(said('ru', { kind: 'phone', written: '8 912 345-67-00' })).toContain('девятьсот двенадцать, триста сорок пять, шестьдесят семь');
    expect([21, 22, 25].map((n) => said('ru', age(n)))).toEqual(['мне двадцать один год', 'мне двадцать два года', 'мне двадцать пять лет']);
    expect(said('ru', year(1987))).toBe('тысяча девятьсот восемьдесят седьмой');
    expect(NUMBER_SAYERS.ru!(year(1987)).also[0].text).toBe('в тысяча девятьсот восемьдесят седьмом году');
    expect([1, 8, 10].map((n) => NUMBER_SAYERS.ja!(age(n)).everyday.roman)).toEqual(['いっさいです', 'はっさいです', 'じゅっさいです']);
    expect(NUMBER_SAYERS.ja!(age(20)).everyday.roman).toBe('はたちです');
    expect(NUMBER_SAYERS.ja!(num(12_345)).everyday).toEqual({ text: '一万二千三百四十五', roman: 'いちまんにせんさんびゃくよんじゅうご' });
    expect(said('el', age(34))).toBe('είμαι τριάντα τεσσάρων χρονών');
    expect(said('th', year(1987))).toBe('พ.ศ. สองพันห้าร้อยสามสิบ');
  });

  it('come up only where they apply', () => {
    expect(ruleFor('fr', num(1987))).toContain('quatre-vingts');
    expect(ruleFor('fr', num(1965))).toBeUndefined();
    expect(ruleFor('fr', { kind: 'phone', written: '06 42 17 85 93' })).toContain('in pairs');
    expect(ruleFor('de', num(87))).toBeDefined();
    expect(ruleFor('de', num(80))).toBeUndefined();
    expect(ruleFor('de', num(1915))).toBeUndefined();
    expect(ruleFor('pl', year(2000))).toBeUndefined();
    expect(ruleFor('ru', num(500))).toBeUndefined();
    expect(ruleFor('ja', age(34))).toBeUndefined();
    expect(ruleFor('ja', age(18))).toContain('はっさい');
    expect(ruleFor('el', age(11))).toBeUndefined();
    expect(ruleFor('el', age(25))).toBeUndefined();
    expect(ruleFor('el', age(23))).toBeDefined();
    expect(ruleFor('nb', age(23))).toBeUndefined();
  });
});
