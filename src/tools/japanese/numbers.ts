import type { Word } from '../phrase';

/**
 * Japanese numbers in kanji with their reading in hiragana, and the counters the Practice tools
 * use (時, 分, 円, 年, 月, 日). A counter changes the sound of the number before it (三百 さんびゃく,
 * 六分 ろっぷん, 四日 よっか), so each counted number is one word: the kanji and its whole reading.
 * Japanese numbers group by 万 (10,000), not by thousands.
 */

const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const READING = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
/** 百 and 千 change their sound after some digits: さんびゃく, ろっぴゃく, さんぜん, はっせん. */
const HUNDREDS = ['', 'ひゃく', 'にひゃく', 'さんびゃく', 'よんひゃく', 'ごひゃく', 'ろっぴゃく', 'ななひゃく', 'はっぴゃく', 'きゅうひゃく'];
const THOUSANDS = ['', 'せん', 'にせん', 'さんぜん', 'よんせん', 'ごせん', 'ろくせん', 'ななせん', 'はっせん', 'きゅうせん'];

/**
 * `n` from 1 to 9,999: 二百五十 にひゃくごじゅう. 一 is left off before 十, 百 and 千, except 千
 * after 万 (`afterMan`), which is 一千 いっせん: 二万一千, にまんいっせん.
 */
function belowMan(n: number, afterMan = false): [string, string] {
  const [th, h, t, u] = [Math.floor(n / 1000), Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
  let text = '';
  let reading = '';
  if (th === 1 && afterMan) { text += '一千'; reading += 'いっせん'; }
  else if (th) { text += (th > 1 ? KANJI[th] : '') + '千'; reading += THOUSANDS[th]; }
  if (h) { text += (h > 1 ? KANJI[h] : '') + '百'; reading += HUNDREDS[h]; }
  if (t) { text += (t > 1 ? KANJI[t] : '') + '十'; reading += (t > 1 ? READING[t] : '') + 'じゅう'; }
  if (u) { text += KANJI[u]; reading += READING[u]; }
  return [text, reading];
}

/** `n` (a whole number from 0) in kanji and hiragana: 1,277 is 千二百七十七, せんにひゃくななじゅうなな. */
export function japaneseNumber(n: number): Word {
  if (!Number.isInteger(n) || n < 0 || n >= 100_000_000) throw new RangeError(`Not a whole number from 0 to 99,999,999: ${n}`);
  if (n === 0) return ['零', 'れい'];
  const man = Math.floor(n / 10_000);
  const rest = n % 10_000;
  const [mText, mReading] = man ? belowMan(man) : ['', ''];
  // 一万, not 万: unlike 十, 百 and 千, 万 keeps its 一.
  const head: Word = man ? [(man === 1 ? '一' : mText) + '万', (man === 1 ? 'いち' : mReading) + 'まん'] : ['', ''];
  const [rText, rReading] = rest ? belowMan(rest, man > 0) : ['', ''];
  return [head[0] + rText, head[1] + rReading];
}

/**
 * `n` with a counter whose sound some last digits change. `units` gives the reading of the last
 * digit with the counter, where it isn't the plain digit plus `plain` (四時 よじ); `tens` the reading
 * of a number ending in 0 (十分 じゅっぷん) where it differs.
 */
export function counted(n: number, counter: string, plain: string, units: Record<number, string> = {}, tens?: string): Word {
  const [text] = japaneseNumber(n);
  const u = n % 10;
  const rest = n - u;
  const [, restReading] = rest ? japaneseNumber(rest) : ['', ''];
  let reading: string;
  if (u && units[u] !== undefined) reading = restReading + units[u];
  else if (!u && n && tens !== undefined && restReading.endsWith('じゅう')) reading = restReading.slice(0, -'じゅう'.length) + tens;
  else reading = japaneseNumber(n)[1] + plain;
  return [text + counter, reading];
}

/** An hour: 三時 さんじ, 四時 よじ, 七時 しちじ, 九時 くじ, 零時 れいじ. */
export const jiWord = (h: number): Word => counted(h, '時', 'じ', { 4: 'よじ', 7: 'しちじ', 9: 'くじ' });

/** Minutes: 一分 いっぷん, 三分 さんぷん, 十分 じゅっぷん, 十五分 じゅうごふん. */
export const funWord = (m: number): Word =>
  counted(m, '分', 'ふん', { 1: 'いっぷん', 3: 'さんぷん', 4: 'よんぷん', 6: 'ろっぷん', 8: 'はっぷん' }, 'じゅっぷん');

/** Yen: 四円 よえん, else the number and えん. */
export const enWord = (n: number): Word => counted(n, '円', 'えん', { 4: 'よえん' });

/** A year: 四年 よねん, 二千二十四年 にせんにじゅうよねん. */
export const nenWord = (y: number): Word => counted(y, '年', 'ねん', { 4: 'よねん' });

/** An age: 一歳 いっさい, 八歳 はっさい, 十歳 じゅっさい; 二十歳 is はたち (`japaneseAge`). */
export const saiWord = (n: number): Word => counted(n, '歳', 'さい', { 1: 'いっさい', 8: 'はっさい' }, 'じゅっさい');

/** A month, 1 to 12: 四月 しがつ, 七月 しちがつ, 九月 くがつ. */
export const gatsuWord = (m: number): Word => counted(m, '月', 'がつ', { 4: 'しがつ', 7: 'しちがつ', 9: 'くがつ' });

/** The days whose reading is their own: the first ten (ついたち, ふつか), 14, 20 and 24. */
const DAYS: Record<number, string> = {
  1: 'ついたち', 2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか',
  9: 'ここのか', 10: 'とおか', 14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか',
};

/** A day of the month, 1 to 31: 一日 ついたち, 十三日 じゅうさんにち, 十七日 じゅうしちにち. */
export function nichiWord(d: number): Word {
  if (DAYS[d]) return [japaneseNumber(d)[0] + '日', DAYS[d]];
  return counted(d, '日', 'にち', { 7: 'しちにち', 9: 'くにち' });
}
