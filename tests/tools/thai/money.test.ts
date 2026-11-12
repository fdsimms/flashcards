import { describe, expect, it } from 'vitest';
import { sayThaiMoney } from '../../../src/tools/thai/money';

const baht = (n: number) => sayThaiMoney(n * 100);

describe('an amount in baht', () => {
  it('says the number, then บาท', () => {
    expect(baht(1).everyday.text).toBe('หนึ่งบาท');
    expect(baht(21).everyday.text).toBe('ยี่สิบเอ็ดบาท');
    expect(baht(71).everyday.text).toBe('เจ็ดสิบเอ็ดบาท');
    expect(baht(1277).everyday).toEqual({ text: 'หนึ่งพันสองร้อยเจ็ดสิบเจ็ดบาท', roman: 'nùeng phan sǒng rói jèt sìp jèt bàat' });
  });

  it('leaves a leading หนึ่ง off as another way to say it', () => {
    expect(baht(180).also.map((p) => p.text)).toEqual(['ร้อยแปดสิบบาท']);
    expect(baht(1277).also.map((p) => p.text)).toEqual(['พันสองร้อยเจ็ดสิบเจ็ดบาท']);
    expect(baht(10000).also.map((p) => p.text)).toEqual(['หมื่นบาท']);
    expect(baht(200).also).toEqual([]);
    expect(baht(1).also).toEqual([]);
  });

  it('says satang after the baht', () => {
    expect(sayThaiMoney(127750).everyday.text).toBe('หนึ่งพันสองร้อยเจ็ดสิบเจ็ดบาทห้าสิบสตางค์');
    expect(sayThaiMoney(50).everyday.text).toBe('ห้าสิบสตางค์');
  });

  it('writes it with the baht sign and commas', () => {
    expect(baht(1277).written.text).toBe('฿1,277');
    expect(sayThaiMoney(127750).written.text).toBe('฿1,277.50');
    expect(sayThaiMoney(50).written.text).toBe('฿0.50');
  });

  it('refuses an amount that is not one', () => {
    expect(() => sayThaiMoney(0)).toThrow(RangeError);
    expect(() => sayThaiMoney(1.5)).toThrow(RangeError);
  });
});
