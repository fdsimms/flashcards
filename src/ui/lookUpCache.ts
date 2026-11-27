import { File, Paths } from 'expo-file-system';
import type { Api, GlossLanguage, Word } from '../reader/api';

/**
 * Look it up's glossed texts, kept on the phone (the newest `KEPT`, in the documents folder) so a
 * word looked up before still shows offline. Keyed by language and the text sent: a word typed into
 * Look up, or the text around a word tapped on a card (src/reader/lookUp.ts).
 */
const KEPT = 300;
const file = () => new File(Paths.document, 'look-ups.json');

let kept: Map<string, Word[]> | null = null;
const keyOf = (language: GlossLanguage, text: string) => `${language}\0${text}`;

async function load(): Promise<Map<string, Word[]>> {
  if (kept) return kept;
  const found = new Map<string, Word[]>();
  try {
    const f = file();
    if (f.exists) {
      const parsed: unknown = JSON.parse(await f.text());
      if (Array.isArray(parsed)) for (const entry of parsed) if (Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1])) found.set(entry[0], entry[1] as Word[]);
    }
  } catch {
    // Unreadable: start again; it's only kept for offline use.
  }
  kept = found;
  return found;
}

function save(map: Map<string, Word[]>): void {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify([...map].slice(-KEPT)));
  } catch {
    // Kept in memory for this run.
  }
}

/**
 * `text`'s words, glossed by Read & Listen's server as a card's sentence is: asked now and kept, or,
 * when the server can't be reached, the copy kept from an earlier lookup. Null when the server hasn't
 * read the language's deck yet (the words can then be asked about one by one); throws when the server
 * can't be reached and nothing is kept.
 */
export async function glossText(api: Api, language: GlossLanguage, text: string): Promise<Word[] | null> {
  const map = await load();
  const key = keyOf(language, text);
  try {
    const answer = await api.glosses(language, [{ text, english: '' }]);
    const words = answer.ready ? answer.sentences[0] : undefined;
    if (!words) return map.get(key) ?? null;
    map.delete(key);
    map.set(key, words);
    while (map.size > KEPT) map.delete(map.keys().next().value as string);
    save(map);
    return words;
  } catch (e) {
    const before = map.get(key);
    if (before) return before;
    throw e;
  }
}
