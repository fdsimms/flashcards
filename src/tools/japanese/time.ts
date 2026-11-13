import { distinct, phrase, type Phrase, type Word } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { funWord, jiWord } from './numbers';

/*
 * A time of day in Japanese. In conversation it's the 12-hour clock, usually without 午前 (a.m.) or
 * 午後 (p.m.) when the situation makes it clear: 三時十五分, 三時半. Before the hour, 五分前 ("five
 * to") is heard too. The 24-hour clock (十五時十五分) is for timetables, schedules and announcements.
 * Each phrase shows its reading in hiragana, since a time's counters change their sound (四時 よじ,
 * 十分 じゅっぷん).
 */

const GOZEN: Word = ['午前', 'ごぜん'];
const GOGO: Word = ['午後', 'ごご'];
const HAN: Word = ['半', 'はん'];
const MAE: Word = ['前', 'まえ'];
const SHOUGO: Word = ['正午', 'しょうご'];
const CHOUDO: Word = ['ちょうど', 'ちょうど'];

export function sayJapaneseTime(t: ClockTime): TimeSaying {
  if (!(t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  const h12 = t.hour % 12 || 12;
  const period = t.hour < 12 ? GOZEN : GOGO;
  const minutes = (m: number): Word[] => (m === 0 ? [] : m === 30 ? [HAN] : [funWord(m)]);
  const twelve = (words: Word[], note?: string): Phrase => phrase(words, '', note);

  const everyday = twelve([jiWord(h12), ...minutes(t.minute)]);
  const also: Phrase[] = [
    // 午前 and 午後 count from 零時: 午前零時 is midnight and 午後零時 noon. 午前十二時 reads as noon
    // and 午後十二時 as midnight, the opposite of 0:00 and 12:00, so with them the hour is 零時.
    twelve([period, jiWord(t.hour % 12), ...minutes(t.minute)], t.hour < 12 ? 'With 午前, a.m.' : 'With 午後, p.m.'),
  ];
  if (t.minute === 30) also.push(twelve([jiWord(h12), funWord(30)]));
  if (t.minute === 0) also.push(twelve([jiWord(h12), CHOUDO], 'Exactly on the hour'));
  if (t.minute >= 40) {
    const next = (t.hour + 1) % 12 || 12;
    also.push(twelve([jiWord(next), funWord(60 - t.minute), MAE], 'Minutes before the hour'));
  }
  if (t.hour === 12 && t.minute === 0) also.push(twelve([SHOUGO], 'Noon'));
  const formal = phrase([jiWord(t.hour), ...(t.minute ? [funWord(t.minute)] : [])], '');
  return { everyday, also: distinct([everyday, ...also]).slice(1), formal };
}
