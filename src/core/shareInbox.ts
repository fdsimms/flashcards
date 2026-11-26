// Text shared to Franki from another app (the share extension, targets/share/): what the extension
// leaves in the App Group, read back leniently, and the small decisions about it. Pure, so it's
// tested; the phone's side is src/ui/shareInbox.ts (the store) and src/ui/useShareInbox.ts.
import { MAX_QUEUED, type QuickWord } from './quickAdd';

/** The App Group the extension writes to (plugins/withAppGroup.js, targets/share/SharedInbox.swift). */
export const APP_GROUP_ID = 'group.com.fdsimms.franki';
/** The file it writes there (SharedInbox.swift's fileName). */
export const INBOX_FILE = 'share_inbox.json';

/** A share opens its screen by itself only this soon after it was made; an older one waits on Today. */
export const FRESH_MS = 60 * 60 * 1000;

/** How many shares are kept, the newest: as many as the extension keeps. */
export const MAX_SHARES = 20;

export interface SharedItem {
  id: string;
  /** Chosen on the extension's card: read it in Read & Listen (Your own text), or add it as words (Quick add). */
  kind: 'read' | 'words';
  text: string;
  /** A Safari page's title, when it came from one. */
  title?: string;
  url?: string;
  /** When it was shared, epoch ms. */
  sharedAt: number;
}

/** What the extension wrote (or the app kept), read leniently: anything unreadable is dropped. */
export function parseShares(raw: unknown): SharedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const { id, kind, text, title, url, sharedAt } = x as Record<string, unknown>;
    if (typeof id !== 'string' || !id || (kind !== 'read' && kind !== 'words')) continue;
    if (typeof text !== 'string' || !text.trim() || typeof sharedAt !== 'number' || !Number.isFinite(sharedAt)) continue;
    out.push({
      id, kind, text, sharedAt,
      ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
      ...(typeof url === 'string' && url ? { url } : {}),
    });
  }
  return out;
}

/** The shares kept on the phone with those just taken from the App Group: each once, oldest first, the newest `MAX_SHARES`. */
export function mergeShares(kept: readonly SharedItem[], taken: readonly SharedItem[]): SharedItem[] {
  const byId = new Map<string, SharedItem>();
  for (const item of [...kept, ...taken]) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.sharedAt - b.sharedAt).slice(-MAX_SHARES);
}

export const isFresh = (item: Pick<SharedItem, 'sharedAt'>, now: number): boolean => now - item.sharedAt < FRESH_MS;

/**
 * The share to open now, if any: the newest one shared within `FRESH_MS` and not opened already in
 * this run of the app (`opened`), so coming back to Franki doesn't open it again. A read needs Read &
 * Listen (`canRead`); without it the share waits on Today, which says to turn it on.
 */
export function shareToOpen(items: readonly SharedItem[], opened: ReadonlySet<string>, canRead: boolean, now: number): SharedItem | undefined {
  return [...items].reverse().find((s) => isFresh(s, now) && !opened.has(s.id) && (s.kind === 'words' || canRead));
}

/**
 * The language a share's script says it's in, where only one of the app's languages is written that
 * way: Thai, Japanese (kana, or kanji, the only CJK language here), Russian (the only Cyrillic one),
 * Greek. Undefined for Latin letters, which could be any of the others.
 */
export function scriptLanguage(text: string): 'th' | 'ja' | 'ru' | 'el' | undefined {
  const counts = { th: 0, ja: 0, ru: 0, el: 0 };
  for (const ch of text) {
    if (/[฀-๿]/.test(ch)) counts.th++;
    else if (/[぀-ヿ㐀-鿿]/.test(ch)) counts.ja++;
    else if (/[Ѐ-ӿ]/.test(ch)) counts.ru++;
    else if (/[Ͱ-Ͽ]/.test(ch)) counts.el++;
  }
  const [best, n] = (Object.entries(counts) as [keyof typeof counts, number][]).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : undefined;
}

/** A share as words for Quick add: one per line, comma or semicolon, each once, at most what Quick add takes. */
export function sharedWords(text: string): QuickWord[] {
  const seen = new Set<string>();
  const words: QuickWord[] = [];
  for (const piece of text.split(/[\n,;、，；]+/)) {
    const entry = piece.replace(/\s+/g, ' ').trim().replace(/^[\s"'“”‘’«»(]+|[\s"'“”‘’«».!?:)]+$/g, '');
    if (!entry || seen.has(entry.toLowerCase())) continue;
    seen.add(entry.toLowerCase());
    words.push({ entry, meaning: '' });
    if (words.length === MAX_QUEUED) break;
  }
  return words;
}

/** Where it came from, as a line on the screen it opens: "From wiadomosci.example.pl". */
export function shareSource(item: Pick<SharedItem, 'url'>): string {
  try {
    const host = item.url ? new URL(item.url).host.replace(/^www\./, '') : '';
    if (host) return `From ${host}`;
  } catch {
    // Not an address: said as shared.
  }
  return 'Shared from another app';
}

/** What Today's banner calls it: the page's title, else the start of the text. */
export function shareName(item: Pick<SharedItem, 'title' | 'text'>): string {
  const name = item.title ?? item.text.replace(/\s+/g, ' ').trim();
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}

/**
 * The deck shared words go to: `preferred` (the deck last added to) when it's in the language the
 * words' script says, else the first deck in that language, else `preferred`. Latin letters say no
 * language, so the deck last added to stands.
 */
export function deckForShare<D extends { deck: string; speechTag?: string }>(decks: readonly D[], text: string, preferred: string | undefined): string | undefined {
  const language = scriptLanguage(text);
  const inLanguage = (d: D | undefined) => !!language && !!d?.speechTag && d.speechTag.toLowerCase().split('-')[0] === language;
  const last = decks.find((d) => d.deck === preferred);
  if (!language || inLanguage(last)) return preferred;
  return decks.find(inLanguage)?.deck ?? preferred;
}
