import { describe, expect, it } from 'vitest';
import { cardWordRuns, furiganaRuns, hasRuby, parseFuriganaMode, plainReading, shownRuns, type Learned } from '../../src/core/furigana';
import { renderCard } from '../../src/core/cards';
import { omniNote } from '../support/fixtures';

// Kanji readings as WaniKani gives them (katakana on'yomi, hiragana kun'yomi).
const KANJI: Record<string, string[]> = {
  劇: ['ゲキ'], 団: ['ダン', 'トン'], 食: ['ショク', 'た'], 学: ['ガク'], 校: ['コウ'], 人: ['ジン', 'ニン', 'ひと'],
  今: ['コン', 'いま'], 日: ['ニチ', 'ジツ', 'ひ', 'か'], 毎: ['マイ'], 年: ['ネン', 'とし'], 上: ['ジョウ', 'うえ'], 演: ['エン'],
};
const readings = (k: string) => KANJI[k];

describe('furiganaRuns', () => {
  it('leaves okurigana bare and puts the rest of the reading over the kanji', () => {
    expect(furiganaRuns('食べる', 'たべる', readings)).toEqual([{ text: '食', ruby: 'た' }, { text: 'べる' }]);
    expect(furiganaRuns('約束を破る', 'やくそくをやぶる')).toEqual([
      { text: '約束', ruby: 'やくそく' }, { text: 'を' }, { text: '破', ruby: 'やぶ' }, { text: 'る' },
    ]);
  });
  it("splits a run of kanji kanji by kanji where their readings allow one way", () => {
    expect(furiganaRuns('劇団', 'げきだん', readings)).toEqual([{ text: '劇', ruby: 'げき' }, { text: '団', ruby: 'だん' }]);
    // A clipped final sound (がく as がっ) and a voiced first one (ひと as びと) still split.
    expect(furiganaRuns('学校', 'がっこう', readings)).toEqual([{ text: '学', ruby: 'がっ' }, { text: '校', ruby: 'こう' }]);
    expect(furiganaRuns('人々', 'ひとびと', readings)).toEqual([{ text: '人', ruby: 'ひと' }, { text: '々', ruby: 'びと' }]);
  });
  it("sets a reading that doesn't split over the whole run", () => {
    expect(furiganaRuns('今日', 'きょう', readings)).toEqual([{ text: '今日', ruby: 'きょう' }]);
    expect(furiganaRuns('劇団', 'げきだん')).toEqual([{ text: '劇団', ruby: 'げきだん' }]);
  });
  it('reads katakana and the first alternative, and sets a reading that misfits over the whole word', () => {
    expect(furiganaRuns('劇団', 'ゲキダン、げきだん', readings)).toEqual([{ text: '劇', ruby: 'げき' }, { text: '団', ruby: 'だん' }]);
    expect(furiganaRuns('食べる', 'くう')).toEqual([{ text: '食べる', ruby: 'くう' }]);
  });
  it('leaves a word with no kanji, or no reading, bare', () => {
    expect(furiganaRuns('ラーメン', 'らーめん')).toEqual([{ text: 'ラーメン' }]);
    expect(furiganaRuns('劇団', '')).toEqual([{ text: '劇団' }]);
    expect(plainReading(' 〜かた ')).toBe('かた');
  });
});

describe('shownRuns', () => {
  const runs = furiganaRuns('劇団', 'げきだん', readings);
  const learned: Learned = { kanji: new Set(['団', '食']), vocabulary: new Set(['食べる']) };
  it('shows nothing when off, and every reading for every kanji', () => {
    expect(hasRuby(shownRuns(runs, 'off', learned, '劇団'))).toBe(false);
    expect(shownRuns(runs, 'all', learned, '劇団')).toEqual(runs);
  });
  it('shows readings only over kanji not learned, per kanji', () => {
    expect(shownRuns(runs, 'unlearned', learned, '劇団')).toEqual([{ text: '劇', ruby: 'げき' }, { text: '団' }]);
  });
  it('shows none over a word learned as vocabulary, by its dictionary form in a sentence', () => {
    const tabeta = furiganaRuns('食べた', 'たべた', readings);
    expect(hasRuby(shownRuns(tabeta, 'unlearned', { kanji: new Set(), vocabulary: new Set(['食べる']) }, '食べた', '食べる'))).toBe(false);
  });
  it('keeps a whole-run reading unless every kanji under it is learned', () => {
    const kyou = furiganaRuns('今日', 'きょう', readings);
    expect(hasRuby(shownRuns(kyou, 'unlearned', { kanji: new Set(['今']), vocabulary: new Set() }, '今日'))).toBe(true);
    expect(hasRuby(shownRuns(kyou, 'unlearned', { kanji: new Set(['今', '日']), vocabulary: new Set() }, '今日'))).toBe(false);
  });
  it('shows every reading without WaniKani data', () => {
    expect(shownRuns(runs, 'unlearned', null, '劇団')).toEqual(runs);
  });
});

describe('parseFuriganaMode', () => {
  it('reads a stored mode, and anything else as off', () => {
    expect(parseFuriganaMode('unlearned')).toBe('unlearned');
    expect(parseFuriganaMode('nonsense')).toBe('off');
    expect(parseFuriganaMode(null)).toBe('off');
  });
});

describe('cardWordRuns', () => {
  const note = { ...omniNote({ Entry: '劇団', Meaning: 'theater company', Language: 'japanese', Transliteration: '', KanaReading: 'げきだん' }), deck: '日本語' };
  const card = renderCard(note, 'forward');
  const blocks = [...card.front.blocks, ...card.back.blocks];
  it("finds the word on the card, with its reading, and marks the reading line as one", () => {
    expect(cardWordRuns(blocks, { mode: 'all', learned: null, readings })).toEqual([{ text: '劇', ruby: 'げき' }, { text: '団', ruby: 'だん' }]);
    expect(card.back.blocks.find((b) => b.text === 'げきだん')?.role).toBe('reading');
  });
  it('is null when off, when every kanji is learned, or for a word in another language', () => {
    expect(cardWordRuns(blocks, { mode: 'off', learned: null })).toBeNull();
    expect(cardWordRuns(blocks, { mode: 'unlearned', learned: { kanji: new Set(['劇', '団']), vocabulary: new Set() } })).toBeNull();
    const thai = renderCard(omniNote(), 'forward');
    expect(cardWordRuns([...thai.front.blocks, ...thai.back.blocks], { mode: 'all', learned: null })).toBeNull();
  });
});
