import { describe, expect, it } from 'vitest';
import { omnilanguageFieldNames } from '../../src/import/models';
import { importTsv, parseDelimited } from '../../src/import/tsv';
import { NOW } from '../support/fixtures';

describe('TSV import', () => {
  it('parses quoted multi-line fields', () => {
    expect(parseDelimited('a\t"b\nc"\td\n', '\t')).toEqual([['a', 'b\nc', 'd']]);
  });
  it('imports an Omnilanguage TSV with metadata headers and tags column', () => {
    const row = omnilanguageFieldNames.map((n) => ({ Entry: 'Haus', Meaning: 'house', GenerateReverse: 'y', Language: 'German' } as Record<string, string>)[n] ?? '');
    const text = ['#separator:tab', '#html:true', '#notetype:Omnilanguage', '#deck:👅 Languages::🥨 Deutsch', `#tags column:${omnilanguageFieldNames.length + 1}`, [...row, 'noun a1'].join('\t')].join('\n');
    const res = importTsv(text, { now: NOW });
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields.Entry).toBe('Haus');
    expect(res.notes[0].tags).toEqual(['noun', 'a1']);
    expect(res.notes[0].deck).toBe('👅 Languages::🥨 Deutsch');
    expect(res.cards.map((c) => c.kind)).toEqual(['forward', 'reverse']);
  });
  it('uses #columns when present and skips blank rows', () => {
    const text = '#separator:tab\n#columns:Front\tBack\tTags\n#tags column:3\n#deck:Trivia\nQ1\tA1\tgeo\n\n';
    const res = importTsv(text);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].fields).toEqual({ Front: 'Q1', Back: 'A1' });
    expect(res.notes[0].tags).toEqual(['geo']);
  });
  it('derives the same note id on every import, so a re-import updates rather than duplicates', () => {
    const text = '#separator:tab\n#columns:Front\tBack\n#deck:Trivia\nQ1\tA1\n';
    expect(importTsv(text).notes[0].id).toBe(importTsv(text).notes[0].id);
  });
});
