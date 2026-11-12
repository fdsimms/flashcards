import { describe, expect, it } from 'vitest';
import { thaiNumber } from '../../../src/tools/thai/numbers';

const text = (n: number) => thaiNumber(n).map((w) => w[0]).join('');
const roman = (n: number) => thaiNumber(n).map((w) => w[1]).join(' ');

describe('Thai numbers in words', () => {
  it('says the digits', () => {
    expect([0, 1, 2, 5, 9].map(text)).toEqual(['ศูนย์', 'หนึ่ง', 'สอง', 'ห้า', 'เก้า']);
  });

  it('says ten as สิบ, twenty as ยี่สิบ, and a 1 after tens as เอ็ด', () => {
    expect([10, 11, 12, 20, 21, 25, 30, 31, 59].map(text)).toEqual([
      'สิบ', 'สิบเอ็ด', 'สิบสอง', 'ยี่สิบ', 'ยี่สิบเอ็ด', 'ยี่สิบห้า', 'สามสิบ', 'สามสิบเอ็ด', 'ห้าสิบเก้า',
    ]);
  });

  it('says hundreds, thousands, ten and hundred thousands, and millions', () => {
    expect(text(100)).toBe('หนึ่งร้อย');
    expect(text(101)).toBe('หนึ่งร้อยเอ็ด');
    expect(text(110)).toBe('หนึ่งร้อยสิบ');
    expect(text(2569)).toBe('สองพันห้าร้อยหกสิบเก้า');
    expect(text(10_000)).toBe('หนึ่งหมื่น');
    expect(text(250_000)).toBe('สองแสนห้าหมื่น');
    expect(text(1_000_000)).toBe('หนึ่งล้าน');
    expect(text(1_000_001)).toBe('หนึ่งล้านเอ็ด');
    expect(text(21_000_000)).toBe('ยี่สิบเอ็ดล้าน');
  });

  it('romanizes word by word', () => {
    expect(roman(21)).toBe('yîi sìp èt');
    expect(roman(45)).toBe('sìi sìp hâa');
  });

  it('refuses what is not a whole number from 0', () => {
    expect(() => thaiNumber(-1)).toThrow(RangeError);
    expect(() => thaiNumber(1.5)).toThrow(RangeError);
  });
});
