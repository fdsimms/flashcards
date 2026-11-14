import { describe, expect, it } from 'vitest';
import { norwegianNumber } from '../../../src/tools/norwegian/numbers';
import { sayNorwegianTime } from '../../../src/tools/norwegian/time';

const everyday = (hour: number, minute = 0) => sayNorwegianTime({ hour, minute }).everyday.text;
const also = (hour: number, minute = 0) => sayNorwegianTime({ hour, minute }).also.map((p) => p.text);
const formal = (hour: number, minute = 0) => sayNorwegianTime({ hour, minute }).formal.text;

describe('Norwegian numbers', () => {
  it('says ones, teens and tens in today’s counting', () => {
    expect([0, 1, 7, 17, 20, 21, 35, 40, 59].map(norwegianNumber)).toEqual([
      'null', 'en', 'sju', 'sytten', 'tjue', 'tjueen', 'trettifem', 'førti', 'femtini',
    ]);
  });

  it('refuses a number out of range', () => {
    expect(() => norwegianNumber(100)).toThrow(RangeError);
    expect(() => norwegianNumber(0.5)).toThrow(RangeError);
  });
});

describe('a time in Norwegian', () => {
  it('says the hour on a 12-hour clock, one o’clock as ett', () => {
    expect(everyday(14)).toBe('to');
    expect(everyday(1)).toBe('ett');
    expect(everyday(13)).toBe('ett');
    expect(everyday(12)).toBe('tolv');
    expect(everyday(0)).toBe('tolv');
    expect(also(0)).toEqual(['tolv om natta', 'midnatt']);
  });

  it('counts over the hour up to 20 past', () => {
    expect(everyday(14, 5)).toBe('fem over to');
    expect(everyday(14, 10)).toBe('ti over to');
    expect(everyday(14, 15)).toBe('kvart over to');
    expect(everyday(14, 1)).toBe('ett minutt over to');
    expect(everyday(14, 7)).toBe('sju minutter over to');
  });

  it('counts around the half hour, which belongs to the next hour', () => {
    expect(everyday(14, 20)).toBe('ti på halv tre');
    expect(everyday(14, 25)).toBe('fem på halv tre');
    expect(everyday(14, 22)).toBe('åtte minutter på halv tre');
    expect(everyday(14, 30)).toBe('halv tre');
    expect(everyday(12, 30)).toBe('halv ett');
    expect(everyday(14, 35)).toBe('fem over halv tre');
    expect(everyday(14, 40)).toBe('ti over halv tre');
    expect(everyday(14, 31)).toBe('ett minutt over halv tre');
  });

  it('counts to the next hour after 40', () => {
    expect(everyday(14, 45)).toBe('kvart på tre');
    expect(everyday(14, 50)).toBe('ti på tre');
    expect(everyday(11, 55)).toBe('fem på tolv');
    expect(everyday(23, 59)).toBe('ett minutt på tolv');
    expect(everyday(14, 43)).toBe('sytten minutter på tre');
  });

  it('adds the part of the day as another way to say it', () => {
    expect(also(3, 30)).toEqual(['halv fire om natta']);
    expect(also(7)).toEqual(['sju om morgenen']);
    expect(also(10, 15)).toEqual(['kvart over ti på formiddagen']);
    expect(also(12, 30)).toEqual(['halv ett midt på dagen']);
    expect(also(15)).toEqual(['tre på ettermiddagen']);
    expect(also(20, 45)).toEqual(['kvart på ni om kvelden']);
    expect(also(23)).toEqual(['elleve om kvelden']);
  });

  it('gives the formal 24-hour form, digit by digit', () => {
    expect(formal(14, 30)).toBe('fjorten tretti');
    expect(formal(14, 5)).toBe('fjorten null fem');
    expect(formal(14)).toBe('klokka fjorten');
    expect(formal(1)).toBe('klokka ett');
    expect(formal(1, 15)).toBe('ett femten');
    expect(formal(0)).toBe('klokka null null');
    expect(formal(0, 30)).toBe('null null tretti');
    expect(formal(21, 45)).toBe('tjueen førtifem');
  });

  it('refuses what is not a time of day', () => {
    expect(() => sayNorwegianTime({ hour: -1, minute: 0 })).toThrow(RangeError);
    expect(() => sayNorwegianTime({ hour: 3, minute: 60 })).toThrow(RangeError);
  });
});
