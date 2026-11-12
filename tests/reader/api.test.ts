import { expect, test, vi } from 'vitest';
import { ApiError, createApi, readerAddress } from '../../src/reader/api';

type Call = { url: string; init: RequestInit };

function fakeFetch(response: Response | Error) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('sends the passphrase and the body to the right route', async () => {
  const { impl, calls } = fakeFetch(json({ id: 1, name: 'Taxi', favorite: true, ready: 0 }));
  const api = createApi('https://anki.example.com/reader/', 'open sesame', impl);

  const topic = await api.addTopic('Taxi');

  expect(topic.name).toBe('Taxi');
  expect(calls[0].url).toBe('https://anki.example.com/reader/api/topics');
  expect(calls[0].init.method).toBe('POST');
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer open sesame');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'Taxi', favorite: true });
});

test('a 204 resolves with nothing', async () => {
  const { impl } = fakeFetch(new Response(null, { status: 204 }));
  await expect(createApi('https://x', 'p', impl).check()).resolves.toBeUndefined();
});

test("the server's own sentence becomes the error message", async () => {
  const { impl } = fakeFetch(json({ detail: 'The server has no Claude API key yet.' }, 503));
  const error = await createApi('https://x', 'p', impl).nextText(1).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.message).toBe('The server has no Claude API key yet.');
  expect(error.status).toBe(503);
});

test('a wrong passphrase says so', async () => {
  const { impl } = fakeFetch(json({ detail: 'Wrong passphrase.' }, 401));
  await expect(createApi('https://x', 'p', impl).check()).rejects.toThrow("That passphrase isn't right.");
});

test('a non-JSON error and a network failure still read plainly', async () => {
  const html = fakeFetch(new Response('<html>', { status: 500 }));
  await expect(createApi('https://x', 'p', html.impl).shelf()).rejects.toThrow(
    'Something went wrong on the server (500). Try again.',
  );
  const offline = fakeFetch(new TypeError('Network request failed'));
  await expect(createApi('https://x', 'p', offline.impl).shelf()).rejects.toThrow(
    "Couldn't reach the server. Check your connection and try again.",
  );
});

test('a text still being written comes back as null', async () => {
  const { impl } = fakeFetch(json({ writing: true }, 202));
  await expect(createApi('https://x', 'p', impl).nextText(1)).resolves.toBeNull();
});

test('a rejected passphrase tells the app, so it can ask again', async () => {
  const { impl } = fakeFetch(json({ detail: 'Wrong passphrase.' }, 401));
  const onUnauthorized = vi.fn();
  await createApi('https://x', 'p', impl, onUnauthorized).shelf().catch(() => {});
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test("other errors don't log the app out", async () => {
  const { impl } = fakeFetch(json({ detail: 'The server has no Claude API key yet.' }, 503));
  const onUnauthorized = vi.fn();
  await createApi('https://x', 'p', impl, onUnauthorized).nextText(1).catch(() => {});
  expect(onUnauthorized).not.toHaveBeenCalled();
});

test('changing a setting sends only that field', async () => {
  const { impl, calls } = fakeFetch(json({ stretch_words: 'any' }));
  const settings = await createApi('https://x', 'p', impl).updateSettings({ stretch_words: 'any' });
  expect(settings.stretch_words).toBe('any');
  expect(calls[0].url).toBe('https://x/api/settings');
  expect(calls[0].init.method).toBe('PATCH');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ stretch_words: 'any' });
});

test('clearing a marked word posts it, and skipping a text posts to it', async () => {
  const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
  const api = createApi('https://x', 'p', impl);
  await api.clearWord('ทอน');
  await api.skip(3);
  expect(calls[0].url).toBe('https://x/api/words/clear');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ word: 'ทอน' });
  expect(calls[1].url).toBe('https://x/api/texts/3/skip');
  expect(calls[1].init.method).toBe('POST');
});

test('the shelf writes a typed topic, starts a story and lists a story\'s episodes', async () => {
  const { impl, calls } = fakeFetch(new Response(null, { status: 202 }));
  const api = createApi('https://x', 'p', impl);
  await api.writeAbout('Haggling', 'story');
  await api.startStory('');
  expect(calls[0].url).toBe('https://x/api/shelf/write');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'Haggling', form: 'story' });
  expect(calls[1].url).toBe('https://x/api/story');
  expect(JSON.parse(calls[1].init.body as string)).toEqual({ about: '' });
  const past = fakeFetch(json([]));
  await createApi('https://x', 'p', past.impl).pastTexts(4);
  expect(past.calls[0].url).toBe('https://x/api/texts?story=4');
});

test('the server is under /reader beside the sync server', () => {
  expect(readerAddress('https://anki.example.com/')).toBe('https://anki.example.com/reader');
  expect(readerAddress('https://anki.example.com')).toBe('https://anki.example.com/reader');
});

test("says so when the reader isn't running on the server", async () => {
  const { impl } = fakeFetch(new Response('', { status: 502 }));
  await expect(createApi('https://anki.example.com/reader', 'p', impl).shelf()).rejects.toThrow("Read & Listen isn't running on your sync server");
});

test('asks for a text practicing chosen words, and sends no body without them', async () => {
  const { impl, calls } = fakeFetch(new Response(null, { status: 202 }));
  const api = createApi('https://anki.example.com/reader', 'p', impl);
  expect(await api.nextText(3, ['กิน', 'ครับ'])).toBeNull();
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ words: ['กิน', 'ครับ'] });
  await api.nextText(3);
  await api.nextText(3, []);
  expect(calls[1].init.body).toBeUndefined();
  expect(calls[2].init.body).toBeUndefined();
});

test('asks for memory hints for a word and returns the list', async () => {
  const { impl, calls } = fakeFetch(json({ hints: ['one', 'two', 'three'] }));
  const api = createApi('https://x/reader', 'p', impl);
  const hints = await api.mnemonics({ language: 'th', entry: 'ทุก', meaning: 'every; all' });
  expect(hints).toEqual(['one', 'two', 'three']);
  expect(calls[0].url).toBe('https://x/reader/api/mnemonics');
  expect(calls[0].init.method).toBe('POST');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ language: 'th', entry: 'ทุก', meaning: 'every; all' });
});
