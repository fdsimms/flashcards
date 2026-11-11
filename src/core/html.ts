const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Anki fields are HTML. Reduce to readable plain text, keeping line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
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
