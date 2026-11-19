import { describe, expect, it } from 'vitest';
import { THAI_COUNTING as th } from '../../../src/tools/thai/counting';

const find = (meaning: string) => th.nouns.findIndex((n) => n.meaning === meaning);

describe('counting things in Thai', () => {
  it('puts the noun first, then the number, then its classifier', () => {
    expect(th.say(find('cat'), 3).everyday).toEqual({ text: 'แมวสามตัว', roman: 'maew sǎam dtua' });
    expect(th.say(find('student'), 5).everyday.text).toBe('นักเรียนห้าคน');
    expect(th.say(find('book'), 21).everyday.text).toBe('หนังสือยี่สิบเอ็ดเล่ม');
    expect(th.say(find('cat'), 3).also[0].text).toBe('สามตัว');
  });

  it('offers other classifiers as the wrong choices, and names the right one after a miss', () => {
    expect(th.wrong(find('cat'), 3).map((p) => p.text)).toContain('แมวสามคน');
    expect(th.wrong(find('cat'), 3).map((p) => p.text)).not.toContain('แมวสามตัว');
    expect(th.rule(find('car'), 2)).toContain('คัน (khan) counts vehicles');
  });
});

describe('Thai classifiers in Latin letters', () => {
  it('writes ตัว with dt, as the rest of the app writes ต', () => {
    expect(th.rule(th.nouns.findIndex((n) => n.meaning === 'cat'), 3)).toContain('ตัว (dtua)');
  });
});
