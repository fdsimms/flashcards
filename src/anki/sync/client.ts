import { utf8Decode, utf8Encode } from '../protobuf';
import { concat, zstdDecoder, zstdUnwrap, zstdWrap } from '../zstd';
import { parseJson, stringifyJson } from './json';
import { CLIENT_VERSION, SYNC_VERSION, SyncError } from './protocol';

/**
 * Talks to an Anki sync server: Anki's own (`anki.syncserver`, or the one built into Anki
 * desktop), never AnkiWeb, whose terms don't allow other clients.
 *
 * Every request is a POST to `<server>/sync/<method>` (`/msync/` for media) with an `anki-sync`
 * header holding the protocol version, the sign-in key, the client version and a session key
 * the server uses to tie one sync's requests together. Bodies are zstd both ways: Franki sends
 * raw (uncompressed) zstd blocks, which every zstd reader takes, and reads the server's with
 * fzstd. From rslib/src/sync/http_client and request/ in ankitects/anki.
 *
 * The HTTP call itself is passed in (`HttpPost`): expo/fetch on the phone, Node's fetch in tests.
 */

export interface HttpResponse {
  status: number;
  /** The next piece of the body, or null at the end. */
  read(): Promise<Uint8Array | null>;
}

export type HttpPost = (url: string, headers: Record<string, string>, body: Uint8Array) => Promise<HttpResponse>;

async function readAll(r: HttpResponse): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let p = await r.read(); p; p = await r.read()) parts.push(p);
  return concat(parts);
}

/** `<server>/` with exactly one trailing slash, as Anki's `Url::join` needs. */
export function normalizeEndpoint(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '') + '/';
}

function sessionKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export class SyncClient {
  readonly endpoint: string;
  /** One per sync: the server keeps a sync's state under it between requests. */
  private readonly session = sessionKey();

  constructor(endpoint: string, private readonly hkey: string, private readonly post: HttpPost) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  /** Signs in and returns the key Anki keeps instead of the password (`hostKey`). */
  static async login(endpoint: string, username: string, password: string, post: HttpPost): Promise<string> {
    const client = new SyncClient(endpoint, '', post);
    const { key } = await client.call<{ key: string }>('sync/hostKey', { u: username, p: password });
    return key;
  }

  /** A JSON request, answered with JSON (64-bit integers kept exact, see json.ts). */
  async call<T>(path: string, body: unknown): Promise<T> {
    const bytes = await this.callBytes(path, utf8Encode(stringifyJson(body)));
    return parseJson(utf8Decode(bytes)) as T;
  }

  /** A media request: answered with `{ data, err }`, where `err` is the server's complaint. */
  async media<T>(path: string, body: unknown): Promise<T> {
    const r = await this.call<{ data?: T; err?: string }>(`msync/${path}`, body);
    if (r.err) throw new SyncError('server', r.err);
    return r.data as T;
  }

  /** Raw bytes in, raw bytes out (both decompressed). */
  async callBytes(path: string, body: Uint8Array): Promise<Uint8Array> {
    const r = await this.request(path, body);
    return zstdUnwrap(await readAll(r));
  }

  /** Streams a large answer (a full download) to `onData` as it arrives, decompressed. */
  async stream(path: string, body: Uint8Array, onData: (chunk: Uint8Array) => void | Promise<void>): Promise<void> {
    const r = await this.request(path, body);
    const pending: Uint8Array[] = [];
    const dec = zstdDecoder((chunk) => pending.push(chunk));
    let last: Uint8Array | null = null;
    // One piece held back, so the decoder can be told which is the last.
    for (let p = await r.read(); p; p = await r.read()) {
      if (last) dec.push(last, false);
      last = p;
      while (pending.length) await onData(pending.shift()!);
    }
    dec.push(last ?? new Uint8Array(0), true);
    while (pending.length) await onData(pending.shift()!);
  }

  private async request(path: string, body: Uint8Array): Promise<HttpResponse> {
    const header = JSON.stringify({ v: SYNC_VERSION, k: this.hkey, c: CLIENT_VERSION, s: this.session });
    let r: HttpResponse;
    try {
      r = await this.post(this.endpoint + path, { 'anki-sync': header, 'Content-Type': 'application/octet-stream' }, zstdWrap(body));
    } catch (e) {
      throw new SyncError('network', `Couldn't reach ${this.endpoint}. ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.status === 200) return r;
    // Errors come back as plain text (rslib's HttpError), not zstd.
    let text = '';
    try { text = utf8Decode(await readAll(r)).trim(); } catch { /* no body */ }
    if (r.status === 403) throw new SyncError('auth', text || 'The server refused the sign-in.');
    throw new SyncError(r.status >= 500 ? 'server' : 'network', text ? `${r.status}: ${text}` : `The server answered ${r.status}.`);
  }
}
