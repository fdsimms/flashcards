import { describe, expect, it } from 'vitest';
import { needsRecording, planRecordings, recordingName, recordingText, recordingVoice, withRecording } from '../../src/core/recording';
import { omniNote } from '../support/fixtures';

describe('recording a card with an Azure voice', () => {
  it('reads the Entry as text, and records only Omnilanguage notes with a language and no recording', () => {
    expect(recordingText(omniNote({ Entry: '<b>หนังสือ</b>&nbsp; เล่ม' }))).toBe('หนังสือ เล่ม');
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
