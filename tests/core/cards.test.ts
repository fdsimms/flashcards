import { describe, expect, it } from 'vitest';
import { autoplayFor, canRecordYourself, cardKindsFor, playbackFor, renderCard } from '../../src/core/cards';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

describe('cards', () => {
  it('gates reverse/audio cards on the Generate* fields', () => {
    expect(cardKindsFor(omniNote())).toEqual(['forward']);
    expect(cardKindsFor(omniNote({ GenerateReverse: 'y' }))).toEqual(['forward', 'reverse']);
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
  it("hides what Anki's template wraps in {{hint:}} behind a tap-to-show label", () => {
    const note = omniNote({ Transliteration: 'nang-suu', Context: 'Ctx', ContextRomanized: 'rom', ContextTranslation: 'He reads.' });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.find((b) => b.text === 'nang-suu')?.tapLabel).toBe('Show transliteration');
    expect(back.find((b) => b.text === 'rom')?.tapLabel).toBe('Show romanization');
    expect(back.find((b) => b.text === 'He reads.')?.tapLabel).toBe('Show translation');
    expect(back.find((b) => b.text === 'Ctx')?.tapLabel).toBeUndefined();
    expect(back.find((b) => b.text === 'book')?.tapLabel).toBeUndefined();
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
  it('lays out the back as the answer, tags, the example sentence, then the notes', () => {
    const note = omniNote({
      Entry: 'ดม', Transliteration: 'dom', Meaning: 'to smell', PartOfSpeech: 'verb', Register: 'neutral',
      Context: 'ขอดมดอกไม้หน่อยครับ', ContextRomanized: 'khǎaw dom dòk-máai nòi khráp', ContextTranslation: 'May I smell the flower?',
      Notes: 'active smelling',
    });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.map((b) => b.role)).toEqual([undefined, undefined, 'chips', 'example', 'exampleRomanized', 'exampleTranslation', 'note']);
    expect(back.find((b) => b.role === 'chips')?.chips).toEqual(['verb', 'neutral']);
    expect(back.find((b) => b.role === 'example')).toMatchObject({ segments: [{ text: 'ขอ', marked: false }, { text: 'ดม', marked: true }, { text: 'ดอกไม้หน่อยครับ', marked: false }], label: undefined, tapLabel: undefined });
    expect(back.find((b) => b.role === 'exampleRomanized')).toMatchObject({ tapLabel: 'Show romanization' });
    expect(back.find((b) => b.role === 'exampleRomanized')?.segments?.find((s) => s.marked)?.text).toBe('dom');
    expect(back.find((b) => b.role === 'note')?.label).toBe('Notes');
  });
  it("lists the word's forms under the tags and before the example, as Anki's pills show them", () => {
    const note = omniNote({
      Entry: 'die Einstellung', Meaning: 'settings', Language: 'german', Gender: 'f', Register: 'neutral',
      Plural: 'Einstellungen', Genitive: 'der Einstellung', Context: 'Die <b>Einstellungen</b> sind im Menü.', Transliteration: '',
    });
    const back = renderCard(note, 'forward').back.blocks;
    expect(back.map((b) => b.role)).toEqual([undefined, 'chips', 'forms', 'example']);
    expect(back.find((b) => b.role === 'chips')?.chips).toEqual(['feminine', 'neutral']);
    expect(back.find((b) => b.role === 'forms')).toMatchObject({
      label: 'Forms', rows: [{ label: 'plural', value: 'Einstellungen' }, { label: 'genitive', value: 'der Einstellung' }],
    });
    expect(back.find((b) => b.role === 'example')?.segments?.find((s) => s.marked)?.text).toBe('Einstellungen');
  });
  it('shows key forms, the counting word, the auxiliary and the aspect pair as forms, and verb class and dialect as tags', () => {
    const rows = (over: Record<string, string>) => renderCard(omniNote(over), 'forward').back.blocks.find((b) => b.role === 'forms')?.rows;
    expect(rows({ KeyForms: 'warf ab', Auxiliary: 'haben' })).toEqual([{ label: 'key forms', value: 'warf ab' }, { label: 'auxiliary', value: 'haben' }]);
    expect(rows({ Classifier: 'คน' })).toEqual([{ label: 'counting word', value: 'คน' }]);
    expect(rows({ AspectPartner: 'добиться' })).toEqual([{ label: 'aspect pair', value: 'добиться' }]);
    const chips = renderCard(omniNote({ PartOfSpeech: 'verb', VerbClass: 'strong', Dialect: 'Isan', Gender: 'common' }), 'forward')
      .back.blocks.find((b) => b.role === 'chips')?.chips;
    expect(chips).toEqual(['verb', 'common', 'Isan', 'strong']);
  });
  it('labels the Hanzi field Kanji on a Japanese note', () => {
    const block = (over: Record<string, string>) => renderCard(omniNote(over), 'forward').back.blocks.find((b) => b.text.startsWith('劇'));
    expect(block({ Entry: '劇団', Language: 'japanese', Hanzi: '劇(ゲキ) drama' })?.label).toBe('Kanji');
    expect(block({ Entry: '剧团', Language: 'mandarin', Hanzi: '劇 drama' })?.label).toBe('Hanzi');
  });
  it('puts мой / моя / моё before a Russian noun wherever the word is shown, but never speaks it', () => {
    const note = omniNote({ Entry: 'кошка', Meaning: 'cat', Language: 'russian', Gender: 'f', Transliteration: '' });
    const forward = renderCard(note, 'forward');
    expect(forward.front.blocks[0]).toMatchObject({ text: 'кошка', prefix: 'моя' });
    expect(forward.front.speak).toBe('кошка');
    expect(renderCard(note, 'reverse').back.blocks[0]).toMatchObject({ text: 'кошка', prefix: 'моя' });
    expect(renderCard({ ...note, fields: { ...note.fields, Language: 'polish' } }, 'forward').front.blocks[0].prefix).toBeUndefined();
  });
  it('leaves out tags and the example when the note has none', () => {
    const back = renderCard(omniNote({ Meaning: 'book' }), 'forward').back.blocks;
    expect(back.some((b) => b.role)).toBe(false);
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

    it('keeps the recording off the Play button until the answer is shown', () => {
      const r = renderCard(note, 'forward');
      expect(playbackFor(r, false)?.file).toBeUndefined();
      expect(playbackFor(r, true)?.file).toBe(FILE);
      expect(playbackFor(renderCard(note, 'reverse'), false)).toBeUndefined();
    });

    it('speaks the front aloud when there is no recording, and the reverse word when its answer is shown', () => {
      const plain = omniNote({ Entry: 'kot', GenerateReverse: 'y' });
      expect(autoplayFor(renderCard(plain, 'forward'), false)?.text).toBe('kot');
      expect(autoplayFor(renderCard(plain, 'forward'), true)).toBeUndefined();
      expect(autoplayFor(renderCard(plain, 'reverse'), true)?.text).toBe('kot');
    });
  });
});
