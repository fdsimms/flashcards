import { describe, expect, it } from 'vitest';
import { sayThaiNumber } from '../../../src/tools/thai/number';

describe('a number in Thai', () => {
  it('says a plain number, with a romanization', () => {
    expect(sayThaiNumber({ kind: 'number', n: 1971 }).everyday).toEqual({ text: 'หนึ่งพันเก้าร้อยเจ็ดสิบเอ็ด', roman: 'nùeng phan gâo rói jèt sìp èt' });
  });

  it('reads a phone number digit by digit, a pause between its groups', () => {
    expect(sayThaiNumber({ kind: 'phone', written: '081 234 5670' }).everyday).toEqual({
      text: 'ศูนย์แปดหนึ่ง สองสามสี่ ห้าหกเจ็ดศูนย์',
      roman: 'sǔun bpàet nùeng, sǒng sǎam sìi, hâa hòk jèt sǔun',
    });
  });

  it('says a year in the Buddhist Era, with the Christian year heard too', () => {
    const s = sayThaiNumber({ kind: 'year', n: 1987 });
    expect(s.everyday.text).toBe('พ.ศ. สองพันห้าร้อยสามสิบ');
    expect(s.also.map((p) => p.text)).toEqual(['ค.ศ. หนึ่งพันเก้าร้อยแปดสิบเจ็ด']);
  });

  it('says an age with อายุ and ปี', () => {
    expect(sayThaiNumber({ kind: 'age', n: 21 }).everyday).toEqual({ text: 'อายุยี่สิบเอ็ดปี', roman: 'aa-yú yîi sìp èt bpii' });
  });
});
