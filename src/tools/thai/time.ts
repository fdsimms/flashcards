import { distinct, phrase, type Phrase, type Word } from '../phrase';
import type { ClockTime, TimeSaying } from '../time';
import { thaiNumber } from './numbers';

/*
 * A time of day in Thai. Everyday speech uses the six-hour clock: ตี for 1 to 5 at night,
 * โมงเช้า in the morning, บ่าย…โมง after noon, โมงเย็น toward evening, ทุ่ม for 7 to 11 at night.
 * The formal 24-hour form (นาฬิกา) is what's written and announced. Several everyday forms can be
 * right; the one shown first is the one heard most.
 */

const MOHNG: Word = ['โมง', 'moong'];
const CHAO: Word = ['เช้า', 'cháo'];
const BAAI: Word = ['บ่าย', 'bàai'];
const YEN: Word = ['เย็น', 'yen'];
const THUM: Word = ['ทุ่ม', 'thûm'];
const DTII: Word = ['ตี', 'dtii'];
const THIANG: Word = ['เที่ยง', 'thîang'];
const KHUEN: Word = ['คืน', 'khuen'];
const WAN: Word = ['วัน', 'wan'];
const KHRUENG: Word = ['ครึ่ง', 'khrûeng'];
const NAATHII: Word = ['นาที', 'naa-thii'];
const NAALIGAA: Word = ['นาฬิกา', 'naa-lí-gaa'];

/** The older count starts the morning's hours at 6 a.m.: 7 is "1 o'clock morning", usually with the 1 left out. */
const oldCount = (n: number) => `Older style, counting hours from 6 a.m.: ${n} o'clock in the morning${n === 1 ? ' (the 1 is usually left out)' : ''}`;
/** โมงเช้า and โมงเย็น usually drop เช้า and เย็น once minutes follow: เก้าโมงครึ่ง, ห้าโมงครึ่ง. */
const DROPS_PERIOD = (h: number) => (h >= 6 && h <= 11) || h === 17 || h === 18;

interface HourForm {
  words: Word[];
  note?: string;
  /** Said only on the hour, never with minutes after it. */
  onTheHour?: boolean;
}

/** The ways to say the hour `h`, the usual one first; with minutes after it, `minutes` is true. */
function hourForms(h: number, minutes: boolean): HourForm[] {
  const forms = hourFormsOnTheHour(h).filter((f) => !minutes || !f.onTheHour);
  // The first two are [with เช้า/เย็น, without]: swap them.
  return minutes && DROPS_PERIOD(h) ? [forms[1], forms[0], ...forms.slice(2)] : forms;
}

function hourFormsOnTheHour(h: number): HourForm[] {
  const n = thaiNumber;
  if (h === 0) return [{ words: [THIANG, KHUEN] }];
  if (h <= 5) return [{ words: [DTII, ...n(h)] }];
  if (h <= 11) {
    const forms: HourForm[] = [{ words: [...n(h), MOHNG, CHAO] }, { words: [...n(h), MOHNG] }];
    if (h === 7) forms.push({ words: [MOHNG, CHAO], note: oldCount(1) });
    else if (h > 7) forms.push({ words: [...n(h - 6), MOHNG, CHAO], note: oldCount(h - 6) });
    return forms;
  }
  if (h === 12) return [{ words: [THIANG] }, { words: [THIANG, WAN], onTheHour: true }];
  if (h === 13) return [{ words: [BAAI, MOHNG] }];
  if (h <= 15) return [{ words: [BAAI, ...n(h - 12), MOHNG] }];
  if (h === 16) return [{ words: [BAAI, ...n(4), MOHNG] }, { words: [...n(4), MOHNG, YEN] }];
  if (h <= 18) {
    const forms: HourForm[] = [{ words: [...n(h - 12), MOHNG, YEN] }, { words: [...n(h - 12), MOHNG] }];
    if (h === 17) forms.push({ words: [BAAI, ...n(5), MOHNG] });
    return forms;
  }
  if (h === 19) return [{ words: [...n(1), THUM] }, { words: [THUM, ...n(1)], onTheHour: true }];
  return [{ words: [...n(h - 18), THUM] }];
}

/** What follows the hour: nothing on the hour, ครึ่ง at half past, else the minutes. */
function minuteWords(m: number, withNaathii: boolean): Word[] {
  if (m === 0) return [];
  if (m === 30) return [KHRUENG];
  return [...thaiNumber(m), ...(withNaathii ? [NAATHII] : [])];
}

export function sayThaiTime(t: ClockTime): TimeSaying {
  if (!(t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59)) throw new RangeError(`Not a time of day: ${t.hour}:${t.minute}`);
  const forms = hourForms(t.hour, t.minute > 0);
  const said = (f: HourForm, withNaathii = true) => phrase([...f.words, ...minuteWords(t.minute, withNaathii)], '', f.note);
  const everyday = said(forms[0]);
  const also = distinct([everyday, ...forms.slice(1).map((f) => said(f)), said(forms[0], false)]).slice(1);
  const formal = phrase([...thaiNumber(t.hour), NAALIGAA, ...(t.minute ? [...thaiNumber(t.minute), NAATHII] : [])], '');
  return { everyday, also, formal };
}
