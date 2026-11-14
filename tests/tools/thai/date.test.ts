import { describe, expect, it } from 'vitest';
import { buddhistYear, sayThaiDate } from '../../../src/tools/thai/date';

const nov12 = { year: 2026, month: 11, day: 12 };
const all = { weekday: true, year: true };
const bare = { weekday: false, year: false };

describe('a date in Thai', () => {
  it('says the weekday, the day, the month and the Buddhist year, set apart by spaces', () => {
    const s = sayThaiDate(nov12, all);
    expect(s.everyday.text).toBe('วันพฤหัสบดีที่สิบสอง พฤศจิกายน พ.ศ. สองพันห้าร้อยหกสิบเก้า');
    expect(s.everyday.roman).toBe('wan phá-rúe-hàt-sà-baaw-dii thîi sìp sǎawng phrúet-sà-jì-gaa-yon phaaw-sǎaw sǎawng phan hâa ráawy hòk sìp gâo');
    expect(s.written.text).toBe('วันพฤหัสบดีที่ 12 พฤศจิกายน พ.ศ. 2569');
  });

  it('counts the year from the Buddha', () => {
    expect(buddhistYear(2026)).toBe(2569);
    expect(buddhistYear(1958)).toBe(2501);
  });

  it('opens with วันที่ without the weekday, and leaves the year off when asked', () => {
    const s = sayThaiDate(nov12, bare);
    expect(s.everyday.text).toBe('วันที่สิบสอง พฤศจิกายน');
    expect(s.written.text).toBe('วันที่ 12 พฤศจิกายน');
    expect(sayThaiDate(nov12, { weekday: true, year: false }).everyday.text).toBe('วันพฤหัสบดีที่สิบสอง พฤศจิกายน');
    expect(sayThaiDate(nov12, { weekday: false, year: true }).everyday.text).toBe('วันที่สิบสอง พฤศจิกายน พ.ศ. สองพันห้าร้อยหกสิบเก้า');
  });

  it('gives the shortened spoken form, the year without พ.ศ., and the Christian year', () => {
    expect(sayThaiDate(nov12, all).also.map((p) => p.text)).toEqual([
      'วันพฤหัสที่สิบสอง พฤศจิกา พ.ศ. สองพันห้าร้อยหกสิบเก้า',
      'วันพฤหัสบดีที่สิบสอง พฤศจิกายน สองพันห้าร้อยหกสิบเก้า',
      'วันพฤหัสบดีที่สิบสอง พฤศจิกายน ค.ศ. สองพันยี่สิบหก',
    ]);
    expect(sayThaiDate(nov12, bare).also.map((p) => p.text)).toEqual(['วันที่สิบสอง พฤศจิกา']);
  });

  it('says the first and a day ending in one', () => {
    expect(sayThaiDate({ year: 1958, month: 3, day: 1 }, all).everyday.text).toBe('วันเสาร์ที่หนึ่ง มีนาคม พ.ศ. สองพันห้าร้อยเอ็ด');
    expect(sayThaiDate({ year: 2026, month: 1, day: 21 }, bare).everyday.text).toBe('วันที่ยี่สิบเอ็ด มกราคม');
  });

  it('refuses a day the month does not have', () => {
    expect(() => sayThaiDate({ year: 2026, month: 2, day: 30 }, all)).toThrow(RangeError);
  });
});
