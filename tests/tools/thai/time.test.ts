import { describe, expect, it } from 'vitest';
import { sayThaiTime } from '../../../src/tools/thai/time';

const everyday = (hour: number, minute = 0) => sayThaiTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayThaiTime({ hour, minute }).also.map((p) => p.text);

describe('a time in Thai', () => {
  it('says each hour on the six-hour clock', () => {
    expect([...Array(24).keys()].map((h) => everyday(h))).toEqual([
      'เที่ยงคืน', 'ตีหนึ่ง', 'ตีสอง', 'ตีสาม', 'ตีสี่', 'ตีห้า',
      'หกโมงเช้า', 'เจ็ดโมงเช้า', 'แปดโมงเช้า', 'เก้าโมงเช้า', 'สิบโมงเช้า', 'สิบเอ็ดโมงเช้า',
      'เที่ยง', 'บ่ายโมง', 'บ่ายสองโมง', 'บ่ายสามโมง', 'บ่ายสี่โมง', 'ห้าโมงเย็น',
      'หกโมงเย็น', 'หนึ่งทุ่ม', 'สองทุ่ม', 'สามทุ่ม', 'สี่ทุ่ม', 'ห้าทุ่ม',
    ]);
  });

  it('says half past as ครึ่ง and other minutes with นาที', () => {
    expect(everyday(14, 30)).toBe('บ่ายสองโมงครึ่ง');
    expect(everyday(2, 30)).toBe('ตีสองครึ่ง');
    expect(everyday(20, 30)).toBe('สองทุ่มครึ่ง');
    expect(everyday(12, 15)).toBe('เที่ยงสิบห้านาที');
    expect(everyday(9, 41)).toBe('เก้าโมงสี่สิบเอ็ดนาที');
    expect(everyday(0, 5)).toBe('เที่ยงคืนห้านาที');
  });

  it('drops เช้า and เย็น once minutes follow, keeping them as another way to say it', () => {
    expect(everyday(7, 30)).toBe('เจ็ดโมงครึ่ง');
    expect(everyday(17, 30)).toBe('ห้าโมงครึ่ง');
    expect(everyday(18, 15)).toBe('หกโมงสิบห้านาที');
    expect(also(7, 30)).toContain('เจ็ดโมงเช้าครึ่ง');
    expect(also(18, 15)).toContain('หกโมงเย็นสิบห้านาที');
    expect(everyday(16, 30)).toBe('บ่ายสี่โมงครึ่ง');
  });

  it('gives the other ways the same time is said', () => {
    expect(also(8)).toEqual(['แปดโมง', 'สองโมงเช้า']);
    expect(also(7)).toEqual(['เจ็ดโมง', 'โมงเช้า']);
    expect(also(16)).toEqual(['สี่โมงเย็น']);
    expect(also(17, 30)).toEqual(['ห้าโมงเย็นครึ่ง', 'บ่ายห้าโมงครึ่ง']);
    expect(also(14, 10)).toEqual(['บ่ายสองโมงสิบ']);
    expect(sayThaiTime({ hour: 9, minute: 0 }).also.find((p) => p.text === 'สามโมงเช้า')?.note).toBe("Older style, counting hours from 6 a.m.: 3 o'clock in the morning");
    expect(sayThaiTime({ hour: 7, minute: 3 }).also.find((p) => p.text === 'โมงเช้าสามนาที')?.note).toBe(
      "Older style, counting hours from 6 a.m.: 1 o'clock in the morning (the 1 is usually left out)",
    );
  });

  it('keeps forms said only on the hour off a time with minutes', () => {
    expect(also(12)).toEqual(['เที่ยงวัน']);
    expect(also(12, 30)).toEqual([]);
    expect(also(19)).toEqual(['ทุ่มหนึ่ง']);
    expect(also(19, 30)).toEqual([]);
  });

  it('gives the formal 24-hour form', () => {
    expect(sayThaiTime({ hour: 14, minute: 30 }).formal.text).toBe('สิบสี่นาฬิกาสามสิบนาที');
    expect(sayThaiTime({ hour: 0, minute: 0 }).formal.text).toBe('ศูนย์นาฬิกา');
    expect(sayThaiTime({ hour: 21, minute: 0 }).formal.text).toBe('ยี่สิบเอ็ดนาฬิกา');
  });

  it('romanizes word by word', () => {
    expect(sayThaiTime({ hour: 14, minute: 30 }).everyday.roman).toBe('bàai sǎawng moong khrûeng');
    expect(sayThaiTime({ hour: 21, minute: 15 }).everyday.roman).toBe('sǎam thûm sìp hâa naa-thii');
  });

  it('refuses what is not a time of day', () => {
    expect(() => sayThaiTime({ hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => sayThaiTime({ hour: 3, minute: 60 })).toThrow(RangeError);
  });
});
