import { type DateParts, type DateSaying, type CalendarDate, isValidDate, weekdayOf } from '../date';
import { distinct, phrase, type Phrase, type Word } from '../phrase';
import { thaiNumber } from './numbers';

/*
 * A date in Thai: วัน + the weekday, ที่ + the day as a number, the month's full name, and the
 * year counted from the Buddha (พ.ศ., the Christian year + 543), the parts set apart by spaces as
 * Thai writes a date. Without the weekday it opens วันที่. In conversation the weekday and the
 * month are shortened (วันพฤหัส, พฤศจิกา), and the Christian year (ค.ศ.) is heard too.
 */

/** Sunday first, as `weekdayOf` counts: the full name, and the short one heard in speech. */
const WEEKDAYS: [full: Word, short: Word][] = [
  [['อาทิตย์', 'aa-thít'], ['อาทิตย์', 'aa-thít']],
  [['จันทร์', 'jan'], ['จันทร์', 'jan']],
  [['อังคาร', 'ang-khaan'], ['อังคาร', 'ang-khaan']],
  [['พุธ', 'phút'], ['พุธ', 'phút']],
  [['พฤหัสบดี', 'phá-rúe-hàt-sà-bor-dii'], ['พฤหัส', 'phá-rúe-hàt']],
  [['ศุกร์', 'sùk'], ['ศุกร์', 'sùk']],
  [['เสาร์', 'sǎo'], ['เสาร์', 'sǎo']],
];

/** January first: the full name, and the short one heard in speech (the ending คม/ยน/พันธ์ left off). */
const MONTHS: [full: Word, short: Word][] = [
  [['มกราคม', 'mók-gà-raa-khom'], ['มกรา', 'mók-gà-raa']],
  [['กุมภาพันธ์', 'gum-phaa-phan'], ['กุมภา', 'gum-phaa']],
  [['มีนาคม', 'mii-naa-khom'], ['มีนา', 'mii-naa']],
  [['เมษายน', 'mee-sǎa-yon'], ['เมษา', 'mee-sǎa']],
  [['พฤษภาคม', 'phrúet-sà-phaa-khom'], ['พฤษภา', 'phrúet-sà-phaa']],
  [['มิถุนายน', 'mí-thù-naa-yon'], ['มิถุนา', 'mí-thù-naa']],
  [['กรกฎาคม', 'gà-rá-gà-daa-khom'], ['กรกฎา', 'gà-rá-gà-daa']],
  [['สิงหาคม', 'sǐng-hǎa-khom'], ['สิงหา', 'sǐng-hǎa']],
  [['กันยายน', 'gan-yaa-yon'], ['กันยา', 'gan-yaa']],
  [['ตุลาคม', 'dtù-laa-khom'], ['ตุลา', 'dtù-laa']],
  [['พฤศจิกายน', 'phrúet-sà-jì-gaa-yon'], ['พฤศจิกา', 'phrúet-sà-jì-gaa']],
  [['ธันวาคม', 'than-waa-khom'], ['ธันวา', 'than-waa']],
];

const WAN: Word = ['วัน', 'wan'];
const THII: Word = ['ที่', 'thîi'];
/** The Buddhist Era and the Christian Era, said before a year. */
export const BE: Word = ['พ.ศ.', 'phor-sǒr'];
export const CE: Word = ['ค.ศ.', 'khor-sǒr'];

/** The year counted from the Buddha. */
export const buddhistYear = (year: number) => year + 543;

/** Phrases set apart by spaces, as the parts of a Thai date are. */
function spaced(parts: Phrase[], note?: string): Phrase {
  return { text: parts.map((p) => p.text).join(' '), roman: parts.map((p) => p.roman).join(' '), ...(note ? { note } : {}) };
}

export function sayThaiDate(d: CalendarDate, parts: DateParts): DateSaying {
  if (!isValidDate(d)) throw new RangeError(`Not a date: ${d.year}-${d.month}-${d.day}`);
  const [weekday, weekdayShort] = WEEKDAYS[weekdayOf(d)];
  const [month, monthShort] = MONTHS[d.month - 1];
  const day = thaiNumber(d.day);
  const opening = (w: Word, dayWords: Word[]) => phrase(parts.weekday ? [WAN, w, THII, ...dayWords] : [WAN, THII, ...dayWords], '');
  const yearSaid = (era: Word, y: number) => spaced([phrase([era], ''), phrase(thaiNumber(y), '')]);
  const be = buddhistYear(d.year);

  const said = (w: Word, m: Word, yearPart: Phrase[], note?: string) => spaced([opening(w, day), phrase([m], ''), ...yearPart], note);
  const everyday = said(weekday, month, parts.year ? [yearSaid(BE, be)] : []);
  const also: Phrase[] = [said(weekdayShort, monthShort, parts.year ? [yearSaid(BE, be)] : [], 'Shortened, as it is said in conversation')];
  if (parts.year) {
    also.push(said(weekday, month, [phrase(thaiNumber(be), '')], 'Without พ.ศ.'));
    also.push(said(weekday, month, [yearSaid(CE, d.year)], 'The Christian year (ค.ศ.)'));
  }
  // Written with digits after ที่ and the era, apart by spaces: วันพฤหัสบดีที่ 12 พฤศจิกายน พ.ศ. 2569.
  const opener = (parts.weekday ? [WAN, weekday, THII] : [WAN, THII]).map((w) => w[0]).join('');
  const written = { text: [opener, String(d.day), month[0], ...(parts.year ? [BE[0], String(be)] : [])].join(' ') };
  return { everyday, also: distinct([everyday, ...also]).slice(1), written };
}
