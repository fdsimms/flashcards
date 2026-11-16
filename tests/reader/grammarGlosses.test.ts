import { describe, expect, it } from 'vitest';
import { explanationParagraphs } from '../../src/core/grammar';
import type { Word } from '../../src/reader/api';
import { explanationGlosses, explanationRequest } from '../../src/reader/grammarGlosses';

const word = (text: string, status: Word['status'] = 'known'): Word => ({ text, status: text.trim() ? status : null, gloss: null, stretch: false, deck: true, grammar: null });
const paragraphs = explanationParagraphs('**ไหม** at the end: **ไปไหม**, "are you going?"\n\n**ไหม** again, and **เผ็ดไหม**.');

describe('the phrases an explanation asks about', () => {
  it("takes each phrase in the language's words once, with no English", () => {
    expect(explanationRequest('th', paragraphs)).toEqual({
      language: 'th',
      sentences: [{ text: 'ไหม', english: '' }, { text: 'ไปไหม', english: '' }, { text: 'เผ็ดไหม', english: '' }],
    });
  });

  it('asks about nothing when the explanation has none', () => {
    expect(explanationRequest('th', explanationParagraphs('No examples here.'))).toBeNull();
  });
});

describe('the answer', () => {
  const request = explanationRequest('th', paragraphs)!;

  it('is kept by phrase', () => {
    const glosses = explanationGlosses(request, [[word('ไหม')], [word('ไป'), word('ไหม')], [word('เผ็ด'), word('ไหม')]]);
    expect([...glosses.keys()]).toEqual(['ไหม', 'ไปไหม', 'เผ็ดไหม']);
    expect(glosses.get('ไปไหม')?.map((w) => w.text)).toEqual(['ไป', 'ไหม']);
  });

  it("leaves out a phrase whose words don't spell it", () => {
    const glosses = explanationGlosses(request, [[word('ไหม')], [word('ไป')], []]);
    expect([...glosses.keys()]).toEqual(['ไหม']);
  });
});
