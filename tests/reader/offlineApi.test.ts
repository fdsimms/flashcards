import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, type ReadingLog, type Settings, type Shelf } from '../../src/reader/api';
import { EMPTY_INDEX, type DownloadIndex, type HeldReaderAction } from '../../src/reader/downloads';
import { wholeText, listenKey, withOffline } from '../../src/reader/offlineApi';
import { card, readerText, saved } from '../support/reader';

const LOG = { finished: true, words_glossed: [], words_flagged: [], audio_speed: null, listen_only: false, seconds: 60 } as ReadingLog;

const SETTINGS = { stretch_words: 'any', lines: 8, form: 'dialogue', language: 'pl', decks: {}, voices: {} } as unknown as Settings;

function setup(opts: { unreachable?: boolean; index?: Partial<DownloadIndex>; held?: HeldReaderAction[]; server?: Record<string, unknown> | 'down' } = {}) {
  const held: HeldReaderAction[] = [...(opts.held ?? [])];
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url.replace('https://x', '')}`);
    if (opts.server === 'down') throw new TypeError('Network request failed');
    const body = opts.server?.[url.replace('https://x', '')];
    return body === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(body), { status: 200 });
  });
  const deps = {
    unreachable: () => !!opts.unreachable,
    index: () => ({ ...EMPTY_INDEX, ...opts.index }),
    file: (name: string) => `file:///kept/${name}`,
    held: () => held,
    hold: vi.fn(async (a: HeldReaderAction) => { held.push(a); }),
    shelfRead: vi.fn(),
    stale: vi.fn(),
    lessonsRead: vi.fn(),
    settings: () => SETTINGS,
  };
  return { api: withOffline(createApi('https://x', 'p', fetchImpl), deps), deps, held, calls };
}

describe('withOffline: texts', () => {
  it('opens a kept text without asking the server when it cannot be reached', async () => {
    const { api, calls } = setup({ unreachable: true, index: { texts: [saved(2)] } });
    await expect(api.text(2)).resolves.toMatchObject({ id: 2 });
    expect(calls).toEqual([]);
  });

  it('says so for a text that is not kept', async () => {
    const { api } = setup({ unreachable: true });
    await expect(api.text(2)).rejects.toThrow("This text isn't on this iPhone");
  });

  it('falls back to the kept copy when the request finds no server', async () => {
    const { api } = setup({ server: 'down', index: { texts: [saved(2)] } });
    await expect(api.text(2)).resolves.toMatchObject({ id: 2 });
  });

  it('drops a kept copy the server now gives differently', async () => {
    const changed = { ...readerText(2), title: 'Re-recorded' };
    const { api, deps } = setup({ server: { '/api/texts/2': changed }, index: { texts: [saved(2)] } });
    await expect(api.text(2)).resolves.toMatchObject({ title: 'Re-recorded' });
    expect(deps.stale).toHaveBeenCalledWith(2);
  });
});

describe('withOffline: the shelf', () => {
  it('keeps what the server says, and shows the kept texts when it cannot be reached', async () => {
    const shelf: Shelf = { language: 'pl', languages: [], texts: [card({ id: 2 })], writing: [], story: null };
    const online = setup({ server: { '/api/shelf': shelf } });
    await online.api.shelf();
    expect(online.deps.shelfRead).toHaveBeenCalledWith(shelf);

    const offline = setup({ unreachable: true, index: { texts: [saved(2)], shelves: { pl: shelf } } });
    await expect(offline.api.shelf()).resolves.toMatchObject({ texts: [{ id: 2 }] });
  });

  it('gives an empty shelf with nothing kept, so the screen can say so', async () => {
    const { api } = setup({ server: 'down' });
    await expect(api.shelf()).resolves.toMatchObject({ language: 'pl', texts: [] });
  });
});

describe('withOffline: switching language offline', () => {
  it("holds the switch, answers with that language's kept texts, and keeps them until the switch is sent", async () => {
    const thai: Shelf = { language: 'th', languages: [], texts: [card({ id: 5 })], writing: [], story: null };
    const { api, held, calls } = setup({ unreachable: true, index: { texts: [saved(5, { language: 'th' })], shelves: { th: thai } } });
    await expect(api.updateSettings({ language: 'th' })).resolves.toMatchObject({ language: 'th' });
    expect(held).toEqual([{ kind: 'language', language: 'th' }]);
    await expect(api.shelf()).resolves.toMatchObject({ language: 'th', texts: [{ id: 5 }] });
    await expect(api.settings()).resolves.toMatchObject({ language: 'th' });
    expect(calls).toEqual([]);
  });

  it('says a language has nothing kept with an empty shelf, not an error', async () => {
    const { api } = setup({ unreachable: true, held: [{ kind: 'language', language: 'de' }] });
    await expect(api.shelf()).resolves.toMatchObject({ language: 'de', texts: [] });
  });

  it("doesn't hold any other settings change", async () => {
    const { api } = setup({ unreachable: true, server: 'down' });
    await expect(api.updateSettings({ lines: 6 })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('withOffline: what is sent', () => {
  it('holds a reading when the server cannot be reached', async () => {
    const { api, held, calls } = setup({ unreachable: true });
    await api.logReading(2, LOG);
    expect(held).toEqual([{ kind: 'reading', textId: 2, log: LOG }]);
    expect(calls).toEqual([]);
  });

  it('holds a reading the request could not deliver', async () => {
    const { api, held } = setup({ server: 'down' });
    await api.logReading(2, LOG);
    expect(held.map((a) => a.kind)).toEqual(['reading']);
  });

  it('holds a reading behind its held choice, so the choice is sent first', async () => {
    const { api, held, calls } = setup({ held: [{ kind: 'choice', textId: 2, choice: 1 }] });
    await api.logReading(2, LOG);
    expect(held.map((a) => a.kind)).toEqual(['choice', 'reading']);
    expect(calls).toEqual([]);
  });

  it('sends at once when nothing is waiting', async () => {
    const { api, held, calls } = setup();
    await api.chooseNext(2, 1);
    expect(held).toEqual([]);
    expect(calls).toEqual(['POST /api/texts/2/choice']);
  });
});

describe('withOffline: a lesson heard', () => {
  it('is sent when the server answers, and held when it cannot be reached or the request is lost', async () => {
    const on = setup();
    await on.api.lessonHeard(7);
    expect(on.calls).toEqual(['POST /api/lessons/7/heard']);
    expect(on.held).toEqual([]);

    const off = setup({ unreachable: true });
    await off.api.lessonHeard(7);
    expect(off.held).toEqual([{ kind: 'lessonHeard', lessonId: 7 }]);
    expect(off.calls).toEqual([]);

    const down = setup({ server: 'down' });
    await down.api.lessonHeard(7);
    expect(down.held).toEqual([{ kind: 'lessonHeard', lessonId: 7 }]);
  });

  it("doesn't hold a text's reading back", async () => {
    const { api, calls } = setup({ held: [{ kind: 'lessonHeard', lessonId: 2 }] });
    await api.logListen(2, 'k');
    expect(calls).toEqual(['POST /api/texts/2/listen']);
  });
});

describe('withOffline: a listen', () => {
  it('is held with an id of its own, and sent with that id', async () => {
    const off = setup({ unreachable: true });
    await off.api.logListen(4);
    const [action] = off.held;
    expect(action).toMatchObject({ kind: 'listen', textId: 4 });
    expect((action as { key?: string }).key).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);

    const on = setup();
    await on.api.logListen(4, 'm1x-abc');
    expect(on.calls).toEqual(['POST /api/texts/4/listen']);
    expect(listenKey(1_700_000_000_000, () => 0.5)).not.toBe(listenKey(1_700_000_000_001, () => 0.5));
  });
});

describe('withOffline: audio', () => {
  it('plays kept lines from the phone, and asks the server for the rest', () => {
    const { api } = setup({ index: { texts: [saved(2, { slow: { 0: [[0, 100]] } })] } });
    expect(api.audioSource(2, 1)).toEqual({ uri: 'file:///kept/text-2/line-1.mp3' });
    expect(api.audioSource(2, 0, 0.8)).toEqual({ uri: 'file:///kept/text-2/line-0.slow.mp3' });
    expect(api.audioSource(2, 1, 0.8).uri).toBe('https://x/api/texts/2/lines/1/audio?speed=slow');
    expect(api.audioSource(3, 0).headers).toEqual({ Authorization: 'Bearer p' });
  });

  it('plays the lines saved so far from a text still being kept as it plays', () => {
    const { api } = setup({ index: { texts: [saved(2, { complete: false, lines: [0], slow: {} })] } });
    expect(api.audioSource(2, 0)).toEqual({ uri: 'file:///kept/text-2/line-0.mp3' });
    expect(api.audioSource(2, 1).uri).toBe('https://x/api/texts/2/lines/1/audio');
  });

  it("answers a kept slow line's times, and fails fast offline for one not kept", async () => {
    const { api } = setup({ unreachable: true, index: { texts: [saved(2, { slow: { 0: [[0, 100]] } })] } });
    await expect(api.slowTimes(2, 0)).resolves.toEqual({ times: [[0, 100]] });
    await expect(api.slowTimes(2, 1)).rejects.toBeInstanceOf(ApiError);
  });

  it('knows when a text has every recording it needs', () => {
    const text = readerText(2, [true, false, true]);
    expect(wholeText(text, [0, 2], null)).toBe(true);
    expect(wholeText(text, [0, 2], [0])).toBe(false);
    expect(wholeText(text, [0], null)).toBe(false);
  });
});
