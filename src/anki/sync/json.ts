/**
 * JSON as Anki's sync writes it, with 64-bit integers kept exact. Anki gives note type fields and
 * templates random 64-bit ids, past what a JavaScript number holds (2^53), and `JSON.parse` would
 * round them: a synced note type would then come back with different ids than the server's. So an
 * integer that doesn't fit a number is read as a bigint, and written back digit for digit.
 * Everything else reads and writes as `JSON.parse` / `JSON.stringify` would.
 */

export type Json = null | boolean | number | bigint | string | Json[] | { [key: string]: Json };

export function parseJson(text: string): Json {
  let i = 0;
  const fail = (what: string): never => { throw new SyntaxError(`Bad JSON from the server: ${what} at ${i}`); };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };

  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const out: { [key: string]: Json } = {};
      ws();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const key = string();
        ws();
        if (text[i++] !== ':') fail('expected ":"');
        out[key] = value();
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return out; }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const out: Json[] = [];
      ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return string();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) return fail('unexpected character');
    i += m[0].length;
    if (m[2] || m[3]) return Number(m[0]);
    const n = Number(m[0]);
    return Number.isSafeInteger(n) ? n : BigInt(m[0]);
  };

  const string = (): string => {
    // From the opening quote: JSON.parse handles the escapes.
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail('unterminated string');
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };

  const out = value();
  ws();
  if (i !== text.length) fail('trailing characters');
  return out;
}

export function stringifyJson(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stringifyJson(v))).join(',')}]`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || typeof v === 'function') continue;
    parts.push(`${JSON.stringify(k)}:${stringifyJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}
