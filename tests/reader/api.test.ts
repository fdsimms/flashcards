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
  const { impl, calls } = fakeFetch(json({ id: 1, name: 'Taxi', ready: 0 }));
  const api = createApi('https://anki.example.com/reader/', 'open sesame', impl);

  const topic = await api.addTopic('Taxi');

  expect(topic.name).toBe('Taxi');
  expect(calls[0].url).toBe('https://anki.example.com/reader/api/topics');
  expect(calls[0].init.method).toBe('POST');
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer open sesame');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'Taxi' });
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

test("a story episode's pick for what happens next is sent as an index", async () => {
  const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
  const api = createApi('https://x', 'p', impl);
  await api.chooseNext(7, 1);
  expect(calls[0].url).toBe('https://x/api/texts/7/choice');
  expect(calls[0].init.method).toBe('POST');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ choice: 1 });
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

test("asks for every language's grammar choices", async () => {
  const { impl, calls } = fakeFetch(json({ choices: { 'es.preterite': 'practice' } }));
  const got = await createApi('https://x/reader', 'p', impl).grammarChoices();
  expect(calls[0].url).toBe('https://x/reader/api/grammar/choices');
  expect(calls[0].init.method).toBe('GET');
  expect(got.choices['es.preterite']).toBe('practice');
});

test("an explanation comes with the line's grammar, and none from an older server", async () => {
  const grammar = [{ id: 'es.preterite', name: 'Preterite', note: 'Finished past events', state: 'practice' }];
  const { impl, calls } = fakeFetch(json({ points: [{ phrase: 'fuimos', note: 'we went' }], grammar }));
  const got = await createApi('https://x/reader', 'p', impl).explainLine(3, 1, false);
  expect(calls[0].url).toBe('https://x/reader/api/texts/3/lines/1/explain');
  expect(got).toEqual({ points: [{ phrase: 'fuimos', note: 'we went' }], grammar });
  const older = fakeFetch(json({ points: [] }));
  expect((await createApi('https://x', 'p', older.impl).explainLine(3, 1, false)).grammar).toEqual([]);
});

test('a naturalness check is asked of the line and comes back as the server sent it', async () => {
  const answer = { verdict: 'stiff', reason: 'Too written.', alternative: 'Pourquoi tu regardes ça ?' };
  const { impl, calls } = fakeFetch(json(answer));
  const got = await createApi('https://x/reader', 'p', impl).checkNatural(3, 1);
  expect(calls[0].url).toBe('https://x/reader/api/texts/3/lines/1/natural');
  expect(calls[0].init.method).toBe('POST');
  expect(got).toEqual(answer);
});

test('the deck list totals are put to the counts route', async () => {
  const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
  await createApi('https://x', 'p', impl).reportCounts({ due: 12, new: 8 });
  expect(calls[0].url).toBe('https://x/api/franki-counts');
  expect(calls[0].init.method).toBe('PUT');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ due: 12, new: 8 });
});

test("the owner's writing is posted to be checked, and a retelling to its text", async () => {
  const answer = { verdict: 'almost', corrected: 'Potrzebuję narzędzia.', english: 'I need a tool.', notes: ['Genitive.'], used_word: true };
  const { impl, calls } = fakeFetch(json(answer));
  const api = createApi('https://x/reader', 'p', impl);
  const request = { kind: 'sentence' as const, language: 'pl' as const, attempt: 'Potrzebuję narzędzie.', word: 'narzędzie', meaning: 'tool' };
  expect(await api.checkWriting(request)).toEqual(answer);
  expect(calls[0].url).toBe('https://x/reader/api/production/check');
  expect(JSON.parse(String(calls[0].init.body))).toEqual(request);
  const retold = fakeFetch(json({ ...answer, words: [], left_out: '' }));
  await createApi('https://x/reader', 'p', retold.impl).retell(7, 'Marta perdió su perro.');
  expect(retold.calls[0].url).toBe('https://x/reader/api/texts/7/retell');
  expect(JSON.parse(String(retold.calls[0].init.body))).toEqual({ attempt: 'Marta perdió su perro.' });
});

test('sentences are asked for by language and count', async () => {
  const { impl, calls } = fakeFetch(json({ sentences: [], writing: true }));
  expect(await createApi('https://x', 'p', impl).sentences('de', 10)).toEqual({ sentences: [], writing: true });
  expect(calls[0].url).toBe('https://x/api/sentences');
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ language: 'de', count: 10 });
});
