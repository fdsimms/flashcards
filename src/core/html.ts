const NAMED: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * HTML's character references as text: the named ones Anki's editor writes, and any numeric one
 * (`&#39;`, `&#x27;`, which Anki's CSV import writes for an apostrophe in a plain-text file).
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:(nbsp|amp|lt|gt|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (m, name?: string, dec?: string, hex?: string) => {
    if (name) return NAMED[name];
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Anki fields are HTML. Reduce to readable plain text, keeping line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;\s]+;/g, decodeEntities)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The media files a field's [sound:...] tags name, in order. */
export function soundFiles(field: string | undefined): string[] {
  return [...(field ?? '').matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

export function isTruthyField(v: string | undefined): boolean {
  if (!v) return false;
  const t = htmlToText(v).toLowerCase();
  return t !== '' && t !== 'n' && t !== 'no' && t !== '0' && t !== 'false';
}
