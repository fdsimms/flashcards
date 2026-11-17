import { describe, expect, it } from 'vitest';
import { needsRecording, planRecordings, recordingName, recordingRequest, recordingText, recordingVoice, withRecording } from '../../src/core/recording';
import { omniNote } from '../support/fixtures';

describe('recording a card with an Azure voice', () => {
  it('reads the Entry as text, and records only Omnilanguage notes with a language and no recording', () => {
    expect(recordingText(omniNote({ Entry: '<b>หนังสือ</b>&nbsp; เล่ม' }))).toBe('หนังสือ เล่ม');
    // A noun's article is said with it where the language has one, and left out where it is only a reminder.
    expect(recordingText(omniNote({ Entry: 'Einstellung', Language: 'german', Gender: 'f' }))).toBe('die Einstellung');
    expect(recordingText(omniNote({ Entry: 'amertume', Language: 'french', Gender: 'f' }))).toBe("l'amertume");
    expect(recordingText(omniNote({ Entry: 'el agua', Language: 'spanish', Gender: 'f' }))).toBe('el agua');
    expect(recordingText(omniNote({ Entry: 'кошка', Language: 'russian', Gender: 'f' }))).toBe('кошка');
    expect(needsRecording(omniNote())).toBe(true);
    expect(needsRecording(omniNote({ Audio: '[sound:book.mp3]' }))).toBe(false);
    expect(needsRecording(omniNote({ Entry: '' }))).toBe(false);
    expect(needsRecording({ ...omniNote({ Language: '' }), deck: 'Misc' })).toBe(false);
    expect(needsRecording({ id: 'b', deck: 'Thai', model: 'Basic', fields: { Front: 'x', Back: 'y' }, tags: [] })).toBe(false);
  });

  it("names the file as the MCP's add_tts_audio does, so either one's recording is the same file", () => {
    // hashlib.sha1("th-TH-PremwadeeNeural\n1.0\nหนังสือ".encode()).hexdigest()[:16]
    expect(recordingName('หนังสือ', 'th-TH-PremwadeeNeural')).toBe('franki-tts-00b4a24cf90d8f1b.mp3');
  });

  it("names a recording made from a Japanese word's reading apart from one made from the word", () => {
    // hashlib.sha1("ja-JP-NanamiNeural\n1.0\n今日\nこんにち".encode()).hexdigest()[:16]
    expect(recordingName('今日', 'ja-JP-NanamiNeural', 1, 'こんにち')).toBe('franki-tts-9862666779f46db3.mp3');
    expect(recordingName('今日', 'ja-JP-NanamiNeural', 1, 'こんにち')).not.toBe(recordingName('今日', 'ja-JP-NanamiNeural'));
  });

  it("asks for a Japanese word with its reading, and any other language without one", () => {
    const ja = { ...omniNote({ Entry: '今日', Language: 'japanese', KanaReading: 'こんにち', Transliteration: '' }), deck: '日本語' };
    expect(recordingRequest(ja)).toEqual({ text: '今日', language: 'ja-JP', reading: 'こんにち' });
    expect(recordingRequest({ ...ja, fields: { ...ja.fields, KanaReading: '' } })).toEqual({ text: '今日', language: 'ja-JP' });
    expect(recordingRequest(omniNote())).toEqual({ text: 'หนังสือ', language: 'th-TH' });
  });

  it('adds the recording after anything already in Audio', () => {
    expect(withRecording(omniNote(), 'a.mp3').Audio).toBe('[sound:a.mp3]');
    expect(withRecording(omniNote({ Audio: 'note' }), 'a.mp3').Audio).toBe('note [sound:a.mp3]');
  });

  it("uses the voice chosen for the note's language, and counts the notes in a language with none", () => {
    const settings = { th: { azureVoice: 'th-TH-PremwadeeNeural' } };
    expect(recordingVoice(omniNote(), settings)).toBe('th-TH-PremwadeeNeural');
    const polish = { ...omniNote({ Entry: 'kot', Language: 'Polish' }), id: 'p' };
    const done = { ...omniNote({ Audio: '[sound:x.mp3]' }), id: 'd' };
    const plan = planRecordings([omniNote(), polish, done], settings);
    expect(plan.ready.map((r) => [r.note.id, r.voice])).toEqual([['n1', 'th-TH-PremwadeeNeural']]);
    expect([...plan.noVoice]).toEqual([['pl', 1]]);
  });
});
