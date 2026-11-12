import { describe, expect, it } from 'vitest';
import { countForm, russianNumber, russianNumberGenitive } from '../../../src/tools/russian/numbers';
import { sayRussianTime } from '../../../src/tools/russian/time';
import { russianTranslit } from '../../../src/tools/russian/translit';

const say = (hour: number, minute = 0) => sayRussianTime({ hour, minute });
const everyday = (hour: number, minute = 0) => say(hour, minute).everyday.text;
const also = (hour: number, minute = 0) => say(hour, minute).also.map((p) => p.text);

describe('Russian numbers', () => {
  it('says them in the nominative, feminine where asked', () => {
    expect([0, 1, 2, 11, 20, 21, 22, 45].map((n) => russianNumber(n))).toEqual(['ноль', 'один', 'два', 'одиннадцать', 'двадцать', 'двадцать один', 'двадцать два', 'сорок пять']);
    expect([1, 2, 21, 22].map((n) => russianNumber(n, 'f'))).toEqual(['одна', 'две', 'двадцать одна', 'двадцать две']);
  });

  it('says them in the genitive', () => {
    expect([1, 2, 5, 11, 15, 20, 21, 25, 40, 50].map((n) => russianNumberGenitive(n, 'f'))).toEqual(
      ['одной', 'двух', 'пяти', 'одиннадцати', 'пятнадцати', 'двадцати', 'двадцати одной', 'двадцати пяти', 'сорока', 'пятидесяти'],
    );
    expect(russianNumberGenitive(1)).toBe('одного');
    expect(() => russianNumberGenitive(0)).toThrow(RangeError);
  });

  it('picks the noun form after a number', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 23, 25].map((n) => countForm(n, 'час', 'часа', 'часов'))).toEqual(
      ['час', 'часа', 'часа', 'часов', 'часов', 'часов', 'часов', 'час', 'часа', 'часов'],
    );
  });

  it('refuses what is out of range', () => {
    expect(() => russianNumber(60)).toThrow(RangeError);
    expect(() => russianNumber(-1)).toThrow(RangeError);
  });
});

describe('a time in Russian', () => {
  it('says each hour on the hour, one o\'clock as час', () => {
    expect([...Array(13).keys()].map((h) => everyday(h))).toEqual([
      'двенадцать часов', 'час', 'два часа', 'три часа', 'четыре часа', 'пять часов', 'шесть часов',
      'семь часов', 'восемь часов', 'девять часов', 'десять часов', 'одиннадцать часов', 'двенадцать часов',
    ]);
    expect(everyday(14)).toBe('два часа');
  });

  it('counts minutes past toward the next hour', () => {
    expect(everyday(14, 1)).toBe('одна минута третьего');
    expect(everyday(14, 2)).toBe('две минуты третьего');
    expect(everyday(14, 10)).toBe('десять минут третьего');
    expect(everyday(14, 21)).toBe('двадцать одна минута третьего');
    expect(everyday(14, 15)).toBe('четверть третьего');
    expect(everyday(14, 30)).toBe('половина третьего');
    expect(everyday(12, 10)).toBe('десять минут первого');
    expect(everyday(0, 30)).toBe('половина первого');
  });

  it('says the minutes left after half past with без', () => {
    expect(everyday(14, 45)).toBe('без четверти три');
    expect(everyday(14, 50)).toBe('без десяти три');
    expect(everyday(14, 35)).toBe('без двадцати пяти три');
    expect(everyday(14, 58)).toBe('без двух минут три');
    expect(everyday(14, 59)).toBe('без одной минуты три');
    expect(everyday(14, 39)).toBe('без двадцати одной минуты три');
    expect(everyday(12, 50)).toBe('без десяти час');
  });

  it('gives the part of the day and the other ways to say it', () => {
    expect(also(2)).toEqual(['два часа ночи', 'два ноль-ноль']);
    expect(also(9, 7)).toEqual(['семь минут десятого утра', 'девять ноль семь', 'девять часов семь минут']);
    expect(also(14, 30)).toEqual(['половина третьего дня', 'полтретьего', 'два тридцать', 'четырнадцать часов тридцать минут']);
    expect(also(14, 15)).toContain('пятнадцать минут третьего');
    expect(also(14, 45)).toContain('без пятнадцати три');
    expect(also(19, 50)).toContain('без десяти восемь вечера');
    expect(also(12)).toEqual(['двенадцать часов дня', 'полдень', 'двенадцать ноль-ноль']);
    expect(also(0)).toEqual(['двенадцать часов ночи', 'полночь']);
    expect(say(14, 30).also.find((p) => p.text === 'полтретьего')?.note).toBe('Colloquial');
    expect(say(14, 30).also.find((p) => p.text === 'два тридцать')?.note).toBe('As read off a digital clock');
  });

  it('gives the formal 24-hour form', () => {
    expect(say(14, 30).formal.text).toBe('четырнадцать тридцать');
    expect(say(14, 5).formal.text).toBe('четырнадцать ноль пять');
    expect(say(14).formal.text).toBe('четырнадцать часов');
    expect(say(21).formal.text).toBe('двадцать один час');
    expect(say(22).formal.text).toBe('двадцать два часа');
    expect(say(0).formal.text).toBe('ноль часов');
    expect(say(0, 30).formal.text).toBe('ноль тридцать');
  });

  it('romanizes every phrase', () => {
    expect(say(14, 30).everyday.roman).toBe("polovina tret'ego");
    expect(say(4, 45).formal.roman).toBe('chetyre sorok pyat\'');
    expect(say(14, 30).also.every((p) => !!p.roman)).toBe(true);
    expect(russianTranslit('Щука, съел, ёж, Юля')).toBe('Shchuka, s"el, yozh, Yulya');
  });

  it('refuses what is not a time of day', () => {
    expect(() => say(24, 0)).toThrow(RangeError);
    expect(() => say(3, 60)).toThrow(RangeError);
    expect(() => say(3.5, 0)).toThrow(RangeError);
  });
});
