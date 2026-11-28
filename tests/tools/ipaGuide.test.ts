import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Language } from '../../src/reader/api';
import { exampleSpans, IPA_GUIDES, ipaBreakdown, ipaLanguageFor, ipaMarks, ipaSections } from '../../src/tools/ipaGuide';

// Read & Listen's IPA tables (server/reader's ipa.py): Wiktionary's IPA per word, the same that fills a card's Pronunciation field.
const DATA = join(__dirname, '../../server/reader/src/franki_reader/data');

function wiktionary(code: Language): Map<string, string> {
  const path = join(DATA, 'ipa', `${code}.tsv.gz`);
  const table = new Map<string, string>();
  if (!existsSync(path)) return table;
  for (const line of gunzipSync(readFileSync(path)).toString('utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) table.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return table;
}

function common(code: Language, n: number): string[] {
  const path = join(DATA, `${code}_common.txt`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')[0].trim()).slice(0, n);
}

const guides = Object.entries(IPA_GUIDES) as [Language, NonNullable<(typeof IPA_GUIDES)[Language]>][];
const tables = new Map(guides.map(([code]) => [code, wiktionary(code)]));

describe('the IPA guides', () => {
  it('covers every language studied with IPA (all but English)', () => {
    expect(guides.map(([l]) => l).sort()).toEqual(['de', 'el', 'es', 'fr', 'ja', 'nb', 'pl', 'ru', 'th']);
  });

  it('gives every sound a word and a hint, in plain copy', () => {
    for (const [, guide] of guides) {
      const hints = [...guide.sounds.map((s) => s.hint), ...Object.values(guide.marks ?? {})];
      for (const hint of hints) {
        expect(hint).not.toMatch(/—|for example/i);
        expect(hint.trim()).toBe(hint);
      }
      for (const sound of guide.sounds) {
        expect(sound.example).not.toMatch(/[\s,]/);
        // The highlighted letters are in the word, so the highlight never quietly vanishes.
        if (sound.spelled) expect(sound.example.toLowerCase()).toContain(sound.spelled.toLowerCase());
      }
      expect(new Set(guide.sounds.map((s) => s.ipa)).size).toBe(guide.sounds.length);
    }
  });

  it("has each sound in its example word, as Wiktionary writes the word", () => {
    const wrong: string[] = [];
    for (const [code, guide] of guides) {
      const table = tables.get(code)!;
      for (const sound of guide.sounds) {
        const ipa = table.get(sound.example);
        if (!ipa) continue;
        if (!ipaBreakdown(ipa, code).parts.some((p) => p.sound === sound)) wrong.push(`${code} ${sound.ipa} in ${sound.example} ${ipa}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("explains every symbol in the IPA of a language's common words", () => {
    const unknown = new Map<string, string>();
    for (const [code] of guides) {
      const table = tables.get(code)!;
      for (const w of common(code, 3000).filter((w) => table.has(w))) {
        for (const p of ipaBreakdown(table.get(w)!, code).parts) if (!p.sound) unknown.set(`${code} ${p.written}`, `${w} ${table.get(w)}`);
      }
    }
    // A sound the guide has no row for still shows (as its own row saying so), but none in a common word.
    expect([...unknown]).toEqual([]);
  });
});

describe('ipaBreakdown', () => {
  it('splits a Norwegian word into its sounds, with length as a mark', () => {
    const b = ipaBreakdown('/ɡɾɑː/', 'nb');
    expect(b.parts.map((p) => [p.written, p.sound?.ipa])).toEqual([['ɡ', 'ɡ'], ['ɾ', 'ɾ'], ['ɑː', 'ɑ']]);
    expect(b.marks.map((m) => m.mark)).toEqual(['ː']);
  });

  it("reads a tie bar's sound as one, and a Thai tone as a mark", () => {
    const b = ipaBreakdown('/t͡ɕʰan˩˩˦/', 'th');
    expect(b.parts.map((p) => p.sound?.ipa)).toEqual(['tɕʰ', 'a', 'n']);
    expect(b.marks).toEqual([{ mark: '˩˩˦', hint: 'Rising tone: starts low, dips, then rises.' }]);
  });

  it('explains a Thai tone written as an accent on the vowel', () => {
    const b = ipaBreakdown('/kʰwaːm˧.sùk/', 'th');
    expect(b.parts.map((p) => p.written)).toEqual(['kʰ', 'w', 'aː', 'm', 's', 'ù', 'k']);
    expect(b.marks.map((m) => m.hint)).toContain('An accent like à: low tone, low and level, dropping a little.');
  });

  it('shows each sound once, in order, and stress and syllable marks once', () => {
    const b = ipaBreakdown('/ˈma.ma/', 'pl');
    expect(b.parts.map((p) => p.written)).toEqual(['m', 'a']);
    expect(b.marks.map((m) => m.mark)).toEqual(['ˈ', '.']);
  });

  it('keeps a soft Russian consonant whole and explains the softness', () => {
    const b = ipaBreakdown('[nʲɪ]', 'ru');
    expect(b.parts.map((p) => p.written)).toEqual(['nʲ', 'ɪ']);
    expect(b.marks[0].mark).toBe('ʲ');
  });

  it("prefers a nasal vowel or a diphthong over its first letter", () => {
    expect(ipaBreakdown('/bɔ̃/', 'fr').parts.map((p) => p.sound?.ipa)).toEqual(['b', 'ɔ̃']);
    expect(ipaBreakdown('[ˈmaɪ̯n]', 'de').parts.map((p) => p.sound?.ipa)).toEqual(['m', 'aɪ̯', 'n']);
  });

  it("keeps a symbol the guide doesn't know, without a row", () => {
    expect(ipaBreakdown('/aɮa/', 'es').parts).toEqual([
      { written: 'a', sound: expect.objectContaining({ ipa: 'a' }) },
      { written: 'ɮ' },
    ]);
  });

  it("reads a hand-typed IPA's ASCII g, ' and :", () => {
    const b = ipaBreakdown("'ga:", 'nb');
    expect(b.parts.map((p) => p.written)).toEqual(['ɡ', 'aː']);
    expect(b.marks.map((m) => m.mark)).toEqual(['ˈ', 'ː']);
  });

  it('explains an optional sound in parentheses, and a tone a language has no name for', () => {
    expect(ipaBreakdown('/a(t)/', 'fr').marks.map((m) => m.mark)).toEqual(['( )']);
    expect(ipaBreakdown('a˧˥', 'th').marks[0].hint).toMatch(/^Tone letters/);
  });
});

describe('the IPA tab', () => {
  it("finds the guide for a card's speech language", () => {
    expect(ipaLanguageFor('nb-NO')).toBe('nb');
    expect(ipaLanguageFor('es-ES')).toBe('es');
    expect(ipaLanguageFor('en-US')).toBeUndefined();
    expect(ipaLanguageFor(undefined)).toBeUndefined();
  });

  it('splits the sounds into vowels and consonants and lists the marks, a language\'s own wording first', () => {
    expect(ipaSections('nb').map((s) => s.title)).toEqual(['Vowels', 'Consonants']);
    expect(ipaMarks('nb').map((m) => m.mark)).toContain('²');
    // Only the marks a language's IPA uses: Spanish has no soft consonants to explain.
    expect(ipaMarks('es').map((m) => m.mark)).toEqual(['ˈ', 'ˌ']);
    for (const [code] of guides) expect(ipaMarks(code).every((x) => x.hint), code).toBe(true);
    expect(ipaMarks('ja').filter((m) => m.mark === 'ː')).toHaveLength(1);
    expect(ipaMarks('ja').find((m) => m.mark === 'ː')!.hint).toMatch(/っ/);
  });

  it('highlights the letters that make the sound', () => {
    const far = IPA_GUIDES.nb!.sounds.find((s) => s.example === 'far')!;
    expect(exampleSpans(far)).toEqual([{ text: 'f', marked: false }, { text: 'a', marked: true }, { text: 'r', marked: false }]);
    expect(exampleSpans({ ...far, spelled: undefined })).toEqual([{ text: 'far', marked: false }]);
  });
});
