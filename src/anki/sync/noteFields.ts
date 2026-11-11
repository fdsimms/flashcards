import { utf8Encode } from '../protobuf';
import { sha1 } from '../sha1';

/**
 * What Anki stores beside a note's fields and works out itself, since a synced note arrives
 * without them (`NoteEntry`'s sfld and csum are always empty): the sort field (`sfld`, what the
 * browser sorts by) and the first field's checksum (`csum`, what duplicate checks look up). As
 * `Note::prepare_for_update` in rslib/src/notes/mod.rs: both are taken with HTML stripped but
 * media file names kept (`strip_html_preserving_media_filenames`, rslib/src/text.rs).
 *
 * One difference: Anki decodes every HTML entity (the `htmlescape` crate); this knows the common
 * ones and leaves the text undecoded on any other, as Anki does on an entity it can't read. At
 * worst such a note sorts as its raw HTML would; Anki's Check Database recomputes both.
 */

const HTML = /(<!--.*?-->)|(<style.*?>.*?<\/style>)|(<script.*?>.*?<\/script>)|(<.*?>)/gis;

const MEDIA_TAGS = new RegExp(
  '<\\b(?:img|audio|video|object|source)\\b' +
  `(?:[^>]|"[^"]+?"|'[^']+?')+?` +
  '\\b(?:src|data)\\b=' +
  `(?:"([^"]+?)"[^>]*>|'([^']+?)'[^>]*>|([^ >]+?)(?: [^>]*>|>))`,
  'gis',
);

const NAMED: Record<string, number> = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221,
  hellip: 8230, bull: 8226, euro: 8364, trade: 8482, middot: 183, laquo: 171, raquo: 187,
  copy: 169, reg: 174, deg: 176, plusmn: 177, times: 215, divide: 247, para: 182, sect: 167,
};
// HTML 4's Latin-1 letters, in code point order from 192 (À).
const LATIN1 = 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
LATIN1.forEach((name, i) => { NAMED[name] ??= 192 + i; });

/**
 * Decodes entities, or returns the text unchanged if any "&" doesn't start one it can read, a
 * bare "&" included: what Anki's `htmlescape` does ("Tom & Jerry &amp; co" stays as it is).
 */
export function decodeEntities(html: string): string {
  if (!html.includes('&')) return html;
  let failed = false;
  const out = html.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*)?;?/g, (m, body: string | undefined) => {
    if (!body || !m.endsWith(';')) { failed = true; return m; }
    let code: number | undefined;
    if (body[0] === '#') code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    else code = NAMED[body];
    if (code === undefined || !Number.isFinite(code) || code > 0x10ffff) { failed = true; return m; }
    return String.fromCodePoint(code);
  });
  return failed ? html : out.replace(/\u00a0/g, ' ');
}

export function stripHtmlPreservingMediaFilenames(html: string): string {
  const withNames = html.replace(MEDIA_TAGS, (_m, a?: string, b?: string, c?: string) => ` ${a ?? ''}${b ?? ''}${c ?? ''} `);
  return decodeEntities(withNames.replace(HTML, ''));
}

/** The first four bytes of the SHA-1 of the stripped first field, as an unsigned number. */
export function fieldChecksum(stripped: string): number {
  const d = sha1(utf8Encode(stripped));
  return ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
}

/** A field as Anki stores it: control characters other than newline and tab removed. */
export function cleanField(field: string): string {
  // eslint-disable-next-line no-control-regex
  return field.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** `sfld` and `csum` for a note's fields, given its note type's sort field. */
export function sortFieldAndChecksum(fields: string[], sortFieldIdx: number): { sfld: string; csum: number } {
  const first = stripHtmlPreservingMediaFilenames(fields[0] ?? '');
  const sfld = sortFieldIdx === 0 ? first : stripHtmlPreservingMediaFilenames(fields[sortFieldIdx] ?? '');
  return { sfld, csum: fieldChecksum(first) };
}
