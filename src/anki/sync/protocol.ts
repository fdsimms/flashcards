/**
 * The shapes Anki's sync protocol (version 11) sends, as JSON. There's no spec outside Anki's own
 * source: every name and tuple order here is from rslib/src/sync in ankitects/anki
 * (collection/*.rs, media/*.rs, login.rs), with the Rust struct named beside each.
 *
 * Tuples (`Serialize_tuple` in Rust) are positional arrays; their order is the column order of the
 * matching table, which is also how Franki reads and writes them.
 */

export const SYNC_VERSION = 11;
/** Sent as the client version (`c` in the header, `cv` in meta). The server only logs it. */
export const CLIENT_VERSION = 'franki,1.0,ios';
/** Objects per chunk, as Anki (`CHUNK_SIZE`). */
export const CHUNK_SIZE = 250;
/** Media files per download request, as Anki (`MAX_MEDIA_FILES_IN_ZIP`). */
export const MEDIA_FILES_PER_REQUEST = 25;

/** `SyncMeta`. Times are milliseconds except `ts`, the server's clock in seconds. */
export interface SyncMeta {
  mod: number;
  scm: number;
  usn: number;
  ts: number;
  msg: string;
  cont: boolean;
  hostNum: number;
  empty?: boolean;
  media_usn?: number;
}

/** `Graves`: what was deleted, by id. */
export interface Graves {
  cards: number[];
  decks: number[];
  notes: number[];
}

/** `NoteEntry`: id, guid, mid, mod, usn, tags, flds, sfld (always ""), csum (always ""), flags, data. */
export type NoteEntry = [number, string, number, number, number, string, string, string, string, number, string];

/** `CardEntry`: the `cards` table's columns in order. */
export type CardEntry = [
  id: number, nid: number, did: number, ord: number, mod: number, usn: number, type: number, queue: number,
  due: number, ivl: number, factor: number, reps: number, lapses: number, left: number, odue: number,
  odid: number, flags: number, data: string,
];

/** `RevlogEntry`: the `revlog` table's columns in order. */
export type RevlogEntry = [id: number, cid: number, usn: number, ease: number, ivl: number, lastIvl: number, factor: number, time: number, type: number];

/** `Chunk`. An empty list may be left out. */
export interface Chunk {
  done: boolean;
  revlog?: RevlogEntry[];
  cards?: CardEntry[];
  notes?: NoteEntry[];
}

/** `DeckSchema11`, the JSON form of a deck (both kinds). Only what Franki reads is named. */
export interface DeckJson {
  id: number | string;
  name: string;
  mod?: number | string;
  usn: number;
  dyn: number | boolean;
  [key: string]: unknown;
}

/** `UnchunkedChanges`: note types, decks with their options, tags, and maybe the whole config. */
export interface UnchunkedChanges {
  models: { id: number | string; mod?: number }[];
  decks: [DeckJson[], { id: number | string; mod?: number }[]];
  tags: string[];
  conf?: Record<string, unknown>;
  crt?: number;
}

/** `SanityCheckCounts`: [[new, learn, review], cards, notes, revlog, graves, models, decks, deck_config]. */
export type SanityCounts = [[number, number, number], number, number, number, number, number, number, number];

export interface SanityResponse {
  status: 'ok' | 'bad';
  c?: SanityCounts;
  s?: SanityCounts;
}

/** `MediaChange`: name, usn, sha1 (empty when the file was deleted). */
export type MediaChange = [string, number, string];

export type SyncErrorKind =
  /** The server refused the user name or password, or the saved sign-in. */
  | 'auth'
  /** Couldn't reach the server, or it answered with something other than Anki's protocol. */
  | 'network'
  /** The server said something went wrong; `message` is its text. */
  | 'server'
  /** The phone's clock is more than five minutes off the server's; Anki refuses to sync then. */
  | 'clock'
  /** Franki and the server checked their counts at the end and they differed: a full sync is needed. */
  | 'sanity';

export class SyncError extends Error {
  constructor(readonly kind: SyncErrorKind, message: string) {
    super(message);
  }
}
