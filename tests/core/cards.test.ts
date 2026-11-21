import { describe, expect, it } from 'vitest';
import { autoplayFor, canRecordYourself, cardKindsFor, playbackFor, renderCard, speechLangFor } from '../../src/core/cards';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

describe('cards', () => {
  it('gates reverse/audio cards on the Generate* fields', () => {
    expect(cardKindsFor(omniNote())).toEqual(['forward']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y' }))).toEqual(['forward', 'reverse']);
    // As Anki's {{#GenerateReverse}} and {{^SuppressFrontCard}} read them: anything in the field
    // turns it on, "no" and "0" included; only an empty one (or a bare <br>) is off.
    expect(cardKindsFor(omniNote({ GenerateReverse: 'no' }))).toEqual(['forward', 'reverse']);
    expect(cardKindsFor(omniNote({ GenerateReverse: '<br>', SuppressFrontCard: '0' }))).toEqual([]);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y', GenerateAudioCard: 'y' }))).toEqual(['forward', 'reverse', 'audio']);
    expect(cardKindsFor(omniNote({ SuppressFrontCard: 'y', GenerateAudioCard: 'y' }))).toEqual(['audio']);
  });
  it('renders forward front as the entry and speaks it in the right language', () => {
    const r = renderCard(omniNote(), 'forward');
    expect(r.front.blocks[0].text).toBe('หนังสือ');
    expect(r.front.speak).toBe('หนังสือ');
    expect(r.speechLang).toBe('th-TH');
    expect(r.back.blocks.map((b) => b.text)).toContain('book');
  });
  it('strips HTML and sound tags', () => {
    const r = renderCard(omniNote({ Meaning: 'a <b>book</b><br>(noun) [sound:x.mp3]' }), 'forward');
    expect(r.back.blocks.find((b) => b.text.startsWith('a book'))?.text).toBe('a book\n(noun)');
  });
  it('puts the literal reading on the translation block, so it opens with the translation', () => {
    const back = renderCard(omniNote({ Context: 'Ctx', ContextTranslation: 'I keep working even though I am tired.', ContextLiteral: 'Even though tired, still working.' }), 'forward').back.blocks;
    const translation = back.find((b) => b.role === 'exampleTranslation');
    expect(translation?.text).toBe('I keep working even though I am tired.');
    expect(translation?.literal).toBe('Even though tired, still working.');
    expect(back.some((b) => b.text === 'Even though tired, still working.')).toBe(false);
    expect(renderCard(omniNote({ Context: 'Ctx', ContextTranslation: 'He reads.' }), 'forward').back.blocks.find((b) => b.role === 'exampleTranslation')?.literal).toBeUndefined();
  });
  it("hides what Anki's template wraps in {{hint:}} behind a tap-to-show label", () => {
    const note = omniNote({ Transliteration: 'nang-suu', Context: 'Ctx', ContextRomanized: 'rom', ContextTranslation: 'He reads.' });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.find((b) => b.text === 'nang-suu')?.tapLabel).toBe('Show transliteration');
    expect(back.find((b) => b.text === 'rom')?.tapLabel).toBe('Show romanization');
    expect(back.find((b) => b.text === 'He reads.')?.tapLabel).toBe('Show translation');
    expect(back.find((b) => b.text === 'Ctx')?.tapLabel).toBeUndefined();
    expect(back.find((b) => b.text === 'book')?.tapLabel).toBeUndefined();
  });
  it('puts the answer first, then the transliteration link under it, on the forward and audio cards', () => {
    const note = omniNote({ Entry: 'หนังสือ', Transliteration: 'nang-suu', Meaning: 'book' });
    for (const kind of ['forward', 'audio'] as const) {
      expect(renderCard(note, kind).back.blocks.map((b) => b.text).slice(0, 2)).toEqual(kind === 'audio' ? ['หนังสือ', 'book'] : ['book', 'nang-suu']);
    }
  });
  it("shows the note's Pronunciation plainly on the back, after the answer, and nothing when it has none", () => {
    const note = omniNote({ Entry: 'дом', Meaning: 'house', Transliteration: '', Pronunciation: '[dom]' });
    expect(renderCard(note, 'forward').back.blocks.map((b) => b.text).slice(0, 2)).toEqual(['house', '[dom]']);
    expect(renderCard(note, 'reverse').back.blocks.map((b) => b.text).slice(0, 2)).toEqual(['дом', '[dom]']);
    expect(renderCard(note, 'audio').back.blocks.map((b) => b.text)).toContain('[dom]');
    expect(renderCard(note, 'audio').back.blocks.find((b) => b.text === '[dom]')?.tapLabel).toBeUndefined();
    expect(renderCard(omniNote({ Entry: 'дом', Meaning: 'house', Transliteration: '' }), 'forward').back.blocks.map((b) => b.text)).not.toContain('[dom]');
  });
  it("keeps the Pronunciation behind a tap when the card already hides a transliteration or a reading, after it", () => {
    const thai = omniNote({ Entry: 'ความสุข', Meaning: 'happiness', Transliteration: 'khwaam-sùk', Pronunciation: '/kʰwaːm˧.sùk/' });
    const japanese = omniNote({ Entry: '大人', Meaning: 'adult', KanaReading: 'おとな', Language: 'Japanese', Pronunciation: '/otona/' });
    for (const kind of ['forward', 'reverse', 'audio'] as const) {
      for (const [note, hidden] of [[thai, 'Show transliteration'], [japanese, 'Show reading']] as const) {
        const taps = renderCard(note, kind).back.blocks.filter((b) => b.tapLabel).map((b) => b.tapLabel);
        expect(taps).toContain('Show pronunciation');
        expect(taps).toContain(hidden);
      }
      const blocks = renderCard(thai, kind).back.blocks;
      expect(blocks.findIndex((b) => b.tapLabel === 'Show pronunciation')).toBe(blocks.findIndex((b) => b.tapLabel === 'Show transliteration') + 1);
    }
  });
  it("shows the Pronunciation plainly when the card hides no reading, and nothing for a note with none", () => {
    const german = omniNote({ Entry: 'Haus', Meaning: 'house', Language: 'German', Transliteration: '', Pronunciation: '[haʊ̯s]' });
    expect(renderCard(german, 'forward').back.blocks.find((b) => b.text === '[haʊ̯s]')?.tapLabel).toBeUndefined();
    const thaiNone = omniNote({ Entry: 'ความสุข', Meaning: 'happiness', Transliteration: 'khwaam-sùk' });
    expect(renderCard(thaiNone, 'forward').back.blocks.some((b) => b.tapLabel === 'Show pronunciation')).toBe(false);
  });
  it("shows the audio card's meaning as a gloss under the word, and the forward card's as the headline", () => {
    const note = omniNote({ Entry: 'หนังสือ', Meaning: 'book' });
    const audio = renderCard(note, 'audio').back.blocks;
    expect(audio.find((b) => b.text === 'book')).toMatchObject({ role: 'gloss', emphasis: undefined });
    expect(audio.find((b) => b.text === 'หนังสือ')?.emphasis).toBe(true);
    expect(renderCard(note, 'forward').back.blocks.find((b) => b.text === 'book')?.emphasis).toBe(true);
  });
  it("shows a Japanese word's kana after the word on every card's back, behind a tap as in Anki", () => {
    const note = omniNote({ Entry: '大人', Meaning: 'adult', KanaReading: 'おとな', Language: 'Japanese' });
    for (const kind of ['forward', 'reverse', 'audio'] as const) {
      const back = renderCard(note, kind).back.blocks;
      const at = back.findIndex((b) => b.text === 'おとな');
      expect(back[at]?.tapLabel).toBe('Show reading');
      expect(at).toBeGreaterThan(back.findIndex((b) => b.text === '大人'));
    }
  });
  it('lays out the back as the answer, tags, the mnemonic and notes, then the example sentence', () => {
    const note = omniNote({
      Entry: 'ดม', Transliteration: 'dom', Meaning: 'to smell', PartOfSpeech: 'verb', Register: 'neutral',
      Context: 'ขอดมดอกไม้หน่อยครับ', ContextRomanized: 'khǎaw dom dòk-máai nòi khráp', ContextTranslation: 'May I smell the flower?',
      Notes: 'active smelling', Mnemonic: 'dome',
    });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.map((b) => b.role)).toEqual(['meaning', 'transliteration', 'chips', undefined, 'note', 'example', 'exampleRomanized', 'exampleTranslation']);
    expect(back[3]?.label).toBe('Mnemonic');
    // A neutral register is the ordinary case: the chips leave it out.
    expect(back.find((b) => b.role === 'chips')?.chips).toEqual(['verb']);
    expect(back.find((b) => b.role === 'example')).toMatchObject({ segments: [{ text: 'ขอ', marked: false }, { text: 'ดม', marked: true }, { text: 'ดอกไม้หน่อยครับ', marked: false }], label: undefined, tapLabel: undefined });
    expect(back.find((b) => b.role === 'exampleRomanized')).toMatchObject({ tapLabel: 'Show romanization' });
    expect(back.find((b) => b.role === 'exampleRomanized')?.segments?.find((s) => s.marked)?.text).toBe('dom');
    expect(back.find((b) => b.role === 'note')?.label).toBe('Notes');
  });
  it("puts the word's grammar in one box under the tags and before the example, each form under its name", () => {
    const note = omniNote({
      Entry: 'die Einstellung', Meaning: 'settings', Language: 'german', Gender: 'f', Register: 'neutral',
      Plural: 'Einstellungen', Genitive: 'der Einstellung', Context: 'Die <b>Einstellungen</b> sind im Menü.', Transliteration: '',
    });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.map((b) => b.role)).toEqual(['meaning', 'chips', 'grammar', 'example']);
    expect(back.find((b) => b.role === 'chips')?.chips).toEqual(['feminine']);
    expect(back.find((b) => b.role === 'grammar')).toMatchObject({
      label: 'Grammar', text: 'plural: Einstellungen\ngenitive: der Einstellung',
      cells: [{ label: 'plural', value: 'Einstellungen', segments: [{ text: 'Einstellung', marked: false }, { text: 'en', marked: true }] }, { label: 'genitive', value: 'der Einstellung' }],
    });
    expect(back.find((b) => b.role === 'example')?.segments?.find((s) => s.marked)?.text).toBe('Einstellungen');
  });
  it('shows labeled key forms, the counting word, the auxiliary and the aspect pair as cells, and the verb class as the top line', () => {
    const box = (over: Record<string, string>) => renderCard(omniNote(over), 'forward').back.blocks.find((b) => b.role === 'grammar');
    const cells = (over: Record<string, string>) => box(over)?.cells?.map((c) => [c.label, c.value]);
    expect(cells({ KeyForms: 'past: warf ab', Auxiliary: 'haben' })).toEqual([['past', 'warf ab'], ['auxiliary', 'haben']]);
    // An older note's line with no label stays whole, under the name it has today.
    expect(box({ KeyForms: 'warf ab' })?.cells).toEqual([{ label: 'key forms', value: 'warf ab', wide: true }]);
    expect(cells({ Entry: 'counter', Classifier: '個' })).toEqual([['counting word', '個']]);
    expect(cells({ AspectPartner: 'добиться' })).toEqual([['aspect pair', 'добиться']]);
    const verb = renderCard(omniNote({ PartOfSpeech: 'verb', VerbClass: 'strong', Dialect: 'Isan', Gender: 'common' }), 'forward').back.blocks;
    expect(verb.find((b) => b.role === 'chips')?.chips).toEqual(['verb', 'common', 'Isan']);
    expect(verb.find((b) => b.role === 'grammar')).toMatchObject({ pattern: 'strong', cells: [] });
    // A register that isn't neutral is still a chip.
    expect(renderCard(omniNote({ Register: 'casual' }), 'forward').back.blocks.find((b) => b.role === 'chips')?.chips).toEqual(['casual']);
    expect(renderCard(omniNote({ Register: 'neutral' }), 'forward').back.blocks.some((b) => b.role === 'chips')).toBe(false);
  });
  it('shows a Thai noun counted with its counting word, not as a form', () => {
    const back = (over: Record<string, string>) => renderCard(omniNote(over), 'forward').back.blocks;
    const counting = back({ Entry: 'โรงพยาบาล', Classifier: 'แห่ง' }).find((b) => b.role === 'counting');
    expect(counting).toMatchObject({ label: 'Counting', rows: [{ label: 'แห่ง', value: 'โรงพยาบาลสองแห่ง', counts: { roman: 'hèng', what: expect.stringContaining('hospitals') } }] });
    // A counting word with no description still shows counted.
    expect(back({ Classifier: 'ซอง' }).find((b) => b.role === 'counting')?.rows).toEqual([{ label: 'ซอง', value: 'หนังสือสองซอง' }]);
    // A word that counts itself is shown as "two times", not with its own noun in front.
    expect(back({ Entry: 'ครั้ง', Classifier: 'ครั้ง' }).find((b) => b.role === 'counting')?.rows?.map((r) => r.value)).toEqual(['สองครั้ง']);
    expect(back({ Entry: 'โรงพยาบาล', Classifier: 'แห่ง' }).some((b) => b.role === 'grammar')).toBe(false);
    // Several counting words each get a line; the other forms stay in the Grammar box.
    const several = back({ Classifier: 'ตัว, คัน', Plural: 'x' });
    expect(several.find((b) => b.role === 'counting')?.rows?.map((r) => r.value)).toEqual(['หนังสือสองตัว', 'หนังสือสองคัน']);
    expect(several.find((b) => b.role === 'grammar')?.cells).toEqual([{ label: 'plural', value: 'x' }]);
    expect(back({}).some((b) => b.role === 'counting')).toBe(false);
  });
  it('labels the Hanzi field Kanji on a Japanese note', () => {
    const block = (over: Record<string, string>) => renderCard(omniNote(over), 'forward').back.blocks.find((b) => b.text.startsWith('劇'));
    expect(block({ Entry: '劇団', Language: 'japanese', Hanzi: '劇(ゲキ) drama' })?.label).toBe('Kanji');
    expect(block({ Entry: '剧团', Language: 'mandarin', Hanzi: '劇 drama' })?.label).toBe('Hanzi');
  });
  it('puts этот / эта / это before a Russian noun wherever the word is shown and speaks it with the word', () => {
    const note = omniNote({ Entry: 'кошка', Meaning: 'cat', Language: 'russian', Gender: 'f', Transliteration: '' });
    const forward = renderCard(note, 'forward');
    expect(forward.front.blocks[0]).toMatchObject({ text: 'кошка', prefix: 'эта' });
    expect(forward.front.speak).toBe('эта кошка');
    expect(renderCard(note, 'reverse').back.blocks[0]).toMatchObject({ text: 'кошка', prefix: 'эта' });
  });
  it('puts ten / ta / to before a Polish noun by its Gender, but not before one that already starts with it', () => {
    const note = omniNote({ Entry: 'mężczyzna', Meaning: 'man', Language: 'polish', Gender: 'm', Transliteration: '' });
    const forward = renderCard(note, 'forward');
    expect(forward.front.blocks[0]).toMatchObject({ text: 'mężczyzna', prefix: 'ten' });
    expect(forward.front.speak).toBe('ten mężczyzna');
    expect(renderCard(note, 'reverse').back.blocks[0]).toMatchObject({ prefix: 'ten' });
    expect(renderCard({ ...note, fields: { ...note.fields, Entry: 'kobieta', Gender: 'f' } }, 'forward').front.blocks[0].prefix).toBe('ta');
    expect(renderCard({ ...note, fields: { ...note.fields, Entry: 'dziecko', Gender: 'n' } }, 'forward').front.blocks[0].prefix).toBe('to');
    // Not yet moved out of the Entry, or a plural-only noun with no Gender: nothing is added.
    expect(renderCard({ ...note, fields: { ...note.fields, Entry: 'ten mężczyzna' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
    expect(renderCard({ ...note, fields: { ...note.fields, Entry: 'te spodnie', Gender: '' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
    expect(renderCard({ ...note, fields: { ...note.fields, Language: 'italian' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
  });
  it('puts te before a plural-only Polish noun (Gender pl) and ci before a plural of men (Gender mpl)', () => {
    const note = omniNote({ Entry: 'spodnie', Meaning: 'pants', Language: 'polish', Gender: 'pl', Transliteration: '' });
    const men = { ...note, fields: { ...note.fields, Entry: 'ludzie', Gender: 'mpl' } };
    expect(renderCard(note, 'forward').front.blocks[0]).toMatchObject({ text: 'spodnie', prefix: 'te' });
    expect(renderCard(note, 'forward').front.speak).toBe('te spodnie');
    expect(renderCard(men, 'forward').front.blocks[0]).toMatchObject({ text: 'ludzie', prefix: 'ci' });
  });
  it("puts å before a Norwegian verb and says it, and leaves a phrase or another language's verb alone", () => {
    const note = omniNote({ Entry: 'huske', Meaning: 'to remember', Language: 'norwegian', PartOfSpeech: 'verb', Transliteration: '' });
    const forward = renderCard(note, 'forward');
    expect(forward.front.blocks[0]).toMatchObject({ text: 'huske', prefix: 'å' });
    expect(forward.front.speak).toBe('å huske');
    expect(renderCard(note, 'reverse').back.blocks[0]).toMatchObject({ text: 'huske', prefix: 'å' });
    const phrase = renderCard({ ...note, fields: { ...note.fields, Entry: 'å gå seg vill', PartOfSpeech: 'phrase' } }, 'forward');
    expect(phrase.front.blocks[0].prefix).toBeUndefined();
    expect(phrase.front.speak).toBe('å gå seg vill');
    expect(renderCard({ ...note, fields: { ...note.fields, Entry: 'werfen', Language: 'german' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
  });
  it('adds no Polish gender word before an Entry that already starts with one, whichever it is', () => {
    const note = omniNote({ Entry: 'ci ludzie', Meaning: 'people', Language: 'polish', Gender: 'm', Transliteration: '' });
    for (const entry of ['ci ludzie', 'te drzwi', 'ten mężczyzna', 'ta kobieta', 'to dziecko']) {
      expect(renderCard({ ...note, fields: { ...note.fields, Entry: entry } }, 'forward').front.blocks[0].prefix, entry).toBeUndefined();
    }
  });
  it('puts el / la and en / ei / et before a Spanish or Norwegian noun by its Gender, speaks it, and leaves an Entry that has its own article alone', () => {
    const es = omniNote({ Entry: 'blindaje', Meaning: 'armor plating', Language: 'spanish', Gender: 'm', Transliteration: '' });
    const forward = renderCard(es, 'forward');
    expect(forward.front.blocks[0]).toMatchObject({ text: 'blindaje', prefix: 'el', gender: 'm' });
    expect(forward.front.speak).toBe('el blindaje');
    expect(renderCard({ ...es, fields: { ...es.fields, Entry: 'demora', Gender: 'f' } }, 'forward').front.blocks[0].prefix).toBe('la');
    const nb = omniNote({ Entry: 'tilbakemelding', Meaning: 'feedback', Language: 'norwegian', Gender: 'f', Transliteration: '' });
    expect(renderCard(nb, 'forward').front.blocks[0].prefix).toBe('ei');
    expect(renderCard({ ...nb, fields: { ...nb.fields, Entry: 'bil', Gender: 'm' } }, 'reverse').back.blocks[0].prefix).toBe('en');
    expect(renderCard({ ...nb, fields: { ...nb.fields, Entry: 'hus', Gender: 'n' } }, 'forward').front.blocks[0].prefix).toBe('et');
    // El agua is feminine but takes el: the Entry keeps its article and gets no second one. Likewise a feminine noun written with en.
    const agua = renderCard({ ...es, fields: { ...es.fields, Entry: 'el agua', Gender: 'f' } }, 'forward');
    expect(agua.front.blocks[0].prefix).toBeUndefined();
    expect(agua.front.speak).toBe('el agua');
    expect(renderCard({ ...nb, fields: { ...nb.fields, Entry: 'en bok' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
    // No Gender (a plural-only noun, or not a noun): nothing is added.
    expect(renderCard({ ...es, fields: { ...es.fields, Gender: '' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
  });
  it('puts der / die / das, le / la / l\' and ο / η / το before a German, French or Greek noun by its Gender, and speaks it', () => {
    const de = omniNote({ Entry: 'Einstellung', Meaning: 'attitude', Language: 'german', Gender: 'f', Transliteration: '' });
    expect(renderCard(de, 'forward').front.blocks[0]).toMatchObject({ text: 'Einstellung', prefix: 'die', gender: 'f' });
    expect(renderCard(de, 'forward').front.speak).toBe('die Einstellung');
    const fr = omniNote({ Entry: 'morceau', Meaning: 'piece', Language: 'french', Gender: 'm', Transliteration: '' });
    expect(renderCard(fr, 'forward').front.blocks[0].prefix).toBe('le');
    const elided = renderCard({ ...fr, fields: { ...fr.fields, Entry: 'amertume', Gender: 'f' } }, 'forward');
    expect(elided.front.blocks[0]).toMatchObject({ text: 'amertume', prefix: "l'" });
    expect(elided.front.speak).toBe("l'amertume");
    // An h noun keeps its article in the Entry, so it gets no second one.
    expect(renderCard({ ...fr, fields: { ...fr.fields, Entry: "l'homme" } }, 'forward').front.blocks[0].prefix).toBeUndefined();
    const el = omniNote({ Entry: 'γειτονιά', Meaning: 'neighborhood', Language: 'greek', Gender: 'f', Transliteration: '' });
    expect(renderCard(el, 'forward').front.blocks[0].prefix).toBe('η');
    expect(renderCard(el, 'forward').front.speak).toBe('η γειτονιά');
  });
  it("shows which word is wanted under a reverse card's meaning, and nowhere else", () => {
    const note = omniNote({ Entry: 'esperar', Meaning: 'to wait', Language: 'Spanish', LeechHint: 'hint' });
    expect(renderCard(note, 'reverse', 'Not: aguardar').front.blocks.map((b) => [b.text, b.role]))
      .toEqual([['to wait', undefined], ['Not: aguardar', 'wanted'], ['hint', undefined]]);
    expect(renderCard(note, 'reverse').front.blocks.map((b) => b.text)).toEqual(['to wait', 'hint']);
    for (const kind of ['forward', 'audio'] as const) {
      expect(renderCard(note, kind, 'Not: aguardar').front.blocks.some((b) => b.role === 'wanted')).toBe(false);
    }
  });
  describe("a note's language", () => {
    const inDeck = (deck: string, over: Record<string, string> = {}) => ({ ...omniNote({ Language: '', ...over }), deck });
    it('reads the Language field, in English or as the language writes itself', () => {
      expect(speechLangFor(omniNote({ Language: 'Italian' }))).toBe('it-IT');
      expect(speechLangFor(omniNote({ Language: 'Türkçe' }))).toBe('tr-TR');
      expect(speechLangFor(omniNote({ Language: 'čeština' }))).toBe('cs-CZ');
      expect(speechLangFor(omniNote({ Language: 'Bahasa Indonesia' }))).toBe('id-ID');
    });
    it('finds the language in the deck name when the note has no Language field', () => {
      const cases: [string, string][] = [
        ['Languages::Italiano', 'it-IT'], ['Português::Verbos', 'pt-BR'], ['Languages::中文', 'zh-CN'], ['한국어 단어', 'ko-KR'],
        ['Dutch', 'nl-NL'], ['Svenska', 'sv-SE'], ['Dansk', 'da-DK'], ['Czech vocab', 'cs-CZ'], ['Arabic', 'ar-SA'],
        ['Hebrew', 'he-IL'], ['Hindi', 'hi-IN'], ['Vietnamese', 'vi-VN'], ['Indonesian', 'id-ID'], ['Українська', 'uk-UA'],
        ['👅 Languages::🐘 ภาษาไทย', 'th-TH'],
      ];
      for (const [deck, lang] of cases) expect(speechLangFor(inDeck(deck)), deck).toBe(lang);
      expect(speechLangFor(inDeck('Languages::Klingon'))).toBeUndefined();
    });
    it("doesn't speak a word whose language isn't known, but still plays its recording", () => {
      const note = inDeck('Languages::Klingon', { Entry: 'Qapla’', GenerateReverse: 'y', GenerateAudioCard: 'y' });
      for (const kind of ['forward', 'reverse', 'audio'] as const) {
        const r = renderCard(note, kind);
        expect(r.speechLang).toBeUndefined();
        for (const revealed of [false, true]) {
          expect(autoplayFor(r, revealed), `${kind} ${revealed}`).toBeUndefined();
          expect(playbackFor(r, revealed), `${kind} ${revealed}`).toBeUndefined();
        }
      }
      const recorded = { ...note, fields: { ...note.fields, Audio: '[sound:q.mp3]' } };
      expect(autoplayFor(renderCard(recorded, 'audio'), false)).toEqual({ text: undefined, file: 'q.mp3' });
      expect(autoplayFor(renderCard(recorded, 'reverse'), true)).toEqual({ text: undefined, file: 'q.mp3' });
      expect(playbackFor(renderCard(recorded, 'forward'), true)).toEqual({ text: undefined, file: 'q.mp3' });
    });
    it("says so on an audio card's front when there is nothing to play", () => {
      const note = inDeck('Languages::Klingon', { Entry: 'Qapla’', GenerateAudioCard: 'y' });
      const front = renderCard(note, 'audio').front.blocks;
      expect(front[1]).toMatchObject({ role: 'note' });
      expect(front[1].text).toContain("its language isn't known");
      const recorded = { ...note, fields: { ...note.fields, Audio: '[sound:q.mp3]' } };
      expect(renderCard(recorded, 'audio').front.blocks).toHaveLength(1);
      expect(renderCard(omniNote({ GenerateAudioCard: 'y' }), 'audio').front.blocks).toHaveLength(1);
    });
  });
  it('leaves out tags and the example when the note has none', () => {
    const back = renderCard(omniNote({ Meaning: 'book' }), 'forward').back.blocks;
    // The meaning and the word's transliteration are the blocks with a role the default fixture has.
    expect(back.filter((b) => b.role).map((b) => b.role)).toEqual(['meaning', 'transliteration']);
  });
  it('shows the Sense line right under the meaning on the forward and audio answers, and only when there is one', () => {
    const note = omniNote({ Entry: 'ประสบการณ์', Meaning: 'experience', Sense: 'know-how from doing, or something lived through', GenerateAudioCard: 'y' });
    for (const kind of ['forward', 'audio'] as const) {
      const back = renderCard(note, kind).back.blocks;
      const at = back.findIndex((b) => b.role === 'sense');
      expect(back[at]?.text).toBe('know-how from doing, or something lived through');
      expect(back[at - 1]?.text).toBe('experience');
    }
    expect(renderCard(omniNote({ Meaning: 'book' }), 'forward').back.blocks.some((b) => b.role === 'sense')).toBe(false);
    // The reverse card's prompt is the meaning, so the sense goes with it there, not on its answer.
    const reverse = renderCard(omniNote({ Meaning: 'experience', Sense: 'a skill, or something lived through', GenerateReverse: 'y' }), 'reverse');
    expect(reverse.front.blocks.map((b) => b.role)).toEqual([undefined, 'sense']);
    expect(reverse.back.blocks.some((b) => b.role === 'sense')).toBe(false);
  });
  it('gives an answer that shows a numbered Meaning its senses, and no other side', () => {
    const note = omniNote({ Entry: 'Zug', Language: 'german', Meaning: '1. train<br>2. move (in a game)<br>3. draft (of air)', GenerateReverse: 'y', GenerateAudioCard: 'y' });
    const senses = ['train', 'move (in a game)', 'draft (of air)'];
    expect(renderCard(note, 'forward').back.blocks.find((b) => b.role === 'meaning')?.senses).toEqual(senses);
    expect(renderCard(note, 'audio').back.blocks.find((b) => b.role === 'gloss')?.senses).toEqual(senses);
    // A reverse card's prompt is the senses: nothing on it can be marked.
    const reverse = renderCard(note, 'reverse');
    expect([...reverse.front.blocks, ...reverse.back.blocks].some((b) => b.senses)).toBe(false);
    expect(renderCard(note, 'forward').front.blocks.some((b) => b.senses)).toBe(false);
    expect(renderCard(omniNote({ Meaning: 'fame; glory' }), 'forward').back.blocks.some((b) => b.senses)).toBe(false);
  });
  it('shows the words a Sense rules out on every answer and never on a front', () => {
    const note = omniNote({ Entry: 'ducha', Language: 'spanish', Meaning: 'shower', Sense: 'a bathroom shower, not rain', SenseContrast: 'rain shower = aguacero; chubasco', GenerateReverse: 'y', GenerateAudioCard: 'y' });
    for (const kind of ['forward', 'reverse', 'audio'] as const) {
      const card = renderCard(note, kind);
      expect(card.front.blocks.some((b) => b.role === 'contrast' || b.text.includes('aguacero'))).toBe(false);
      const box = card.back.blocks.find((b) => b.role === 'contrast');
      expect(box?.rows).toEqual([{ label: 'rain shower', value: 'aguacero' }, { label: 'rain shower', value: 'chubasco' }]);
      expect(box?.text).toBe('rain shower: aguacero\nrain shower: chubasco');
    }
    // Right under the Sense where the answer shows one.
    const back = renderCard(note, 'forward').back.blocks;
    expect(back[back.findIndex((b) => b.role === 'sense') + 1]?.role).toBe('contrast');
    expect(renderCard(omniNote({ Sense: 'a bathroom shower, not rain' }), 'forward').back.blocks.some((b) => b.role === 'contrast')).toBe(false);
  });
  it('renders one example box per line of Context when ContextLabels is set, each with its own romanization, translation and tag', () => {
    const note = omniNote({
      Entry: 'ประสบการณ์', Transliteration: 'bprà-sòp-gaan', Meaning: 'experience',
      Context: 'เขามีประสบการณ์เยอะ<br>ฉันมีประสบการณ์ที่ดีที่นั่น',
      ContextRomanized: 'kǎo mii bprà-sòp-gaan yóe<br>chǎn mii bprà-sòp-gaan thîi dii thîi-nân',
      ContextTranslation: 'He has a lot of experience.<br>I had a good experience there.',
      ContextLabels: 'skill<br>event',
    });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.filter((b) => b.role?.startsWith('example')).map((b) => b.role)).toEqual([
      'example', 'exampleRomanized', 'exampleTranslation', 'example', 'exampleRomanized', 'exampleTranslation',
    ]);
    const examples = back.filter((b) => b.role === 'example');
    expect(examples.map((b) => [b.text, b.tag])).toEqual([['เขามีประสบการณ์เยอะ', 'skill'], ['ฉันมีประสบการณ์ที่ดีที่นั่น', 'event']]);
    expect(examples[1].segments?.find((s) => s.marked)?.text).toBe('ประสบการณ์');
    expect(back.filter((b) => b.role === 'exampleTranslation').map((b) => b.text)).toEqual(['He has a lot of experience.', 'I had a good experience there.']);
  });
  it('leaves a note whose Context already runs over two lines as one example when ContextLabels is empty', () => {
    const back = renderCard(omniNote({ Context: 'Line one<br>Line two', ContextTranslation: 'One<br>Two' }), 'forward').back.blocks;
    expect(back.filter((b) => b.role === 'example').map((b) => b.text)).toEqual(['Line one\nLine two']);
  });
  it('renders plain Front/Back notes for trivia', () => {
    const note: Note = { id: 't', deck: 'Trivia', model: 'Basic', fields: { Front: 'Capital of Peru?', Back: 'Lima' }, tags: [] };
    const r = renderCard(note, 'forward');
    expect(r.front.blocks[0].text).toBe('Capital of Peru?');
    expect(r.back.blocks[0].text).toBe('Lima');
  });

  it("names the note's recorded audio, for playing in place of text-to-speech", () => {
    const withAudio = omniNote({ Audio: '[sound:hypertts-cbb27612.mp3]' });
    for (const kind of ['forward', 'reverse', 'audio'] as const) {
      expect(renderCard(withAudio, kind).audioFile).toBe('hypertts-cbb27612.mp3');
    }
    expect(renderCard(omniNote(), 'forward').audioFile).toBeUndefined();
  });

  describe('where the recording plays, as the Omnilanguage templates put {{Audio}}', () => {
    const note = omniNote({ Audio: '[sound:a.mp3]', GenerateReverse: 'y', GenerateAudioCard: 'y' });
    const FILE = 'a.mp3';

    it('plays nothing by itself on the front of a forward or reverse card, and the recording when the answer is shown', () => {
      for (const kind of ['forward', 'reverse'] as const) {
        const r = renderCard(note, kind);
        expect(autoplayFor(r, false)).toBeUndefined();
        expect(autoplayFor(r, true)?.file).toBe(FILE);
      }
    });

    it('plays the recording on the front of the audio card', () => {
      expect(autoplayFor(renderCard(note, 'audio'), false)?.file).toBe(FILE);
    });

    it('offers Record yourself on every side of a card with a recording, and not on one without', () => {
      for (const kind of ['forward', 'reverse', 'audio'] as const) expect(canRecordYourself(renderCard(note, kind))).toBe(true);
      expect(canRecordYourself(renderCard(omniNote({ Entry: 'kot' }), 'forward'))).toBe(false);
    });

    it('keeps the recording off the Play button on the front of a reverse card until the answer is shown', () => {
      expect(playbackFor(renderCard(note, 'reverse'), false)).toBeUndefined();
      expect(playbackFor(renderCard(note, 'reverse'), true)?.file).toBe(FILE);
    });

    it('offers no Play on the front of a forward card, which shows the word, until the answer is shown', () => {
      const r = renderCard(note, 'forward');
      expect(playbackFor(r, false)).toBeUndefined();
      expect(playbackFor(r, true)?.file).toBe(FILE);
    });

    it('still offers Play on the front of the audio card, where the sound is the question', () => {
      expect(playbackFor(renderCard(note, 'audio'), false)?.file).toBe(FILE);
    });

    it('speaks nothing by itself on the front of a forward card, and the word when its answer is shown', () => {
      const plain = omniNote({ Entry: 'kot', GenerateReverse: 'y' });
      expect(autoplayFor(renderCard(plain, 'forward'), false)).toBeUndefined();
      expect(autoplayFor(renderCard(plain, 'forward'), true)?.text).toBe('kot');
      expect(playbackFor(renderCard(plain, 'forward'), false)).toBeUndefined();
      expect(playbackFor(renderCard(plain, 'forward'), true)).toEqual({ text: 'kot', file: undefined });
    });

    it('speaks the reverse word when its answer is shown, and the audio card its word as it comes up', () => {
      const plain = omniNote({ Entry: 'kot', GenerateReverse: 'y', GenerateAudioCard: 'y' });
      expect(autoplayFor(renderCard(plain, 'reverse'), false)).toBeUndefined();
      expect(autoplayFor(renderCard(plain, 'reverse'), true)?.text).toBe('kot');
      expect(autoplayFor(renderCard(plain, 'audio'), false)?.text).toBe('kot');
    });
  });
  describe('what the screen colors', () => {
    const german = (over: Record<string, string> = {}) => omniNote({ Entry: 'die Blutung', Meaning: 'bleeding', Language: 'German', Gender: 'f', Transliteration: '', ...over });

    it("marks the entry and the gender chip with the note's gender", () => {
      const r = renderCard(german(), 'forward');
      expect(r.front.blocks[0].gender).toBe('f');
      expect(r.back.blocks.find((b) => b.role === 'chips')?.gender).toBe('f');
    });

    it('marks the entry of a reverse card too, where the word is the answer', () => {
      expect(renderCard(german(), 'reverse').back.blocks[0].gender).toBe('f');
    });

    it('colors no gender the field does not name as m, f or n', () => {
      expect(renderCard(german({ Gender: 'pl' }), 'forward').front.blocks[0].gender).toBeUndefined();
      expect(renderCard(german({ Gender: '' }), 'forward').front.blocks[0].gender).toBeUndefined();
    });

    it("marks a Thai romanization and its example's romanization for tone colors, and no other language's", () => {
      const thai = renderCard(omniNote({ Context: 'ฉันชื่อนิดา', ContextRomanized: 'chǎn chûue Ni-daa' }), 'forward').back.blocks;
      expect(thai.find((b) => b.tapLabel === 'Show transliteration')?.tones).toBe(true);
      expect(thai.find((b) => b.role === 'exampleRomanized')?.tones).toBe(true);
      const polish = renderCard(omniNote({ Language: 'Polish', Entry: 'kot', Transliteration: 'kót' }), 'forward').back.blocks;
      expect(polish.find((b) => b.tapLabel === 'Show transliteration')?.tones).toBeFalsy();
    });
  });
});
