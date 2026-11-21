import type { CardRequirement } from '../core/noteTypeEdits';
import { decodeMessage, MessageWriter, utf8Encode, type Field } from './protobuf';
import { hasUnicase, type SyncDb } from './sync/collectionSync';
import { COL_MODIFIED_SQL } from './writeback';

/**
 * A note type's card templates and styling changed in Franki, written into the kept Anki
 * collection the way Anki writes them (rslib's update_notetype, checked against Anki's
 * `models.update_dict`, which its card layout screen uses): each template's `config` and the note
 * type's `config` edited in place (a template's mtime and usn zeroed, as Anki leaves them) so every setting Franki doesn't read survives, the card
 * requirements worked out again (`cardRequirements`), the note type's `mtime_secs` set and `usn`
 * -1 so the next sync sends it (`notetypeJson`, in applyChanges), and the collection stamped
 * modified. No field or card type is added or taken away, so the schema doesn't change and no full
 * sync follows. Runs on a connection of its own to the kept collection (`withSyncConnection`),
 * inside `lockAnki`.
 *
 * Needs Anki's collation: the templates table can't be read without it, and without it a sync
 * couldn't send the note type either (it would ask for a full upload).
 */

const NT = { css: 3, reqs: 8 }; // Notetype.Config
const REQ = { cardOrd: 1, kind: 2, fieldOrds: 3 }; // Notetype.Config.CardRequirement
const TEMPLATE = { qfmt: 1, afmt: 2 }; // Notetype.Template.Config
const REQ_KIND = { none: 0, any: 1, all: 2 } as const;

export interface NoteTypeLook {
  /** Every card type of the note type, by ordinal. */
  templates: { ord: number; front: string; back: string }[];
  css: string;
  reqs: CardRequirement[];
}

export type LookWrite = 'saved' | 'noCollation' | 'missing' | 'changed';

/**
 * A message with each field in `replace` given the values there (none takes it out), every other
 * field kept as it was, in
 * field-number order as prost writes a message. A repeated field's values keep their order.
 */
function withFields(bytes: Uint8Array, replace: Map<number, Uint8Array[]>): Uint8Array {
  const fields: [number, Field][] = [];
  for (const [n, list] of decodeMessage(bytes)) {
    if (replace.has(n)) continue;
    for (const f of list) fields.push([n, f]);
  }
  for (const [n, values] of replace) for (const value of values) fields.push([n, { wire: 2, value }]);
  fields.sort((a, b) => a[0] - b[0]);
  const w = new MessageWriter();
  for (const [n, f] of fields) {
    if (f.wire === 0) w.uint(n, f.value);
    else if (f.wire === 2) w.bytes(n, f.value);
    else w.fixed(n, f.wire, f.value);
  }
  return w.finish();
}

/** A string field's value: none when empty, as proto3 leaves a default out. */
const str = (s: string): Uint8Array[] => (s ? [utf8Encode(s)] : []);

function requirementBytes(r: CardRequirement): Uint8Array {
  const w = new MessageWriter();
  if (r.ord) w.uint(REQ.cardOrd, r.ord);
  if (REQ_KIND[r.kind]) w.uint(REQ.kind, REQ_KIND[r.kind]);
  if (r.fieldOrds.length) w.packedUints(REQ.fieldOrds, r.fieldOrds);
  return w.finish();
}

/**
 * Sets a note type's templates (front and back of each card type) and styling. `missing` when the
 * collection has no note type of that name, `changed` when its card types aren't the ones given
 * (it changed in Anki since Franki last took it in), `noCollation` on a build without Anki's
 * collation.
 */
export async function setAnkiNoteTypeLook(db: SyncDb, name: string, look: NoteTypeLook, now: Date): Promise<LookWrite> {
  if (!(await hasUnicase(db))) return 'noCollation';
  // NOT INDEXED, and the name compared here, as everywhere a note type is found by name.
  const nt = (await db.all<{ id: number; name: string; config: Uint8Array }>('SELECT id, name, config FROM notetypes NOT INDEXED')).find((r) => r.name === name);
  if (!nt) return 'missing';
  const rows = await db.all<{ ord: number; config: Uint8Array }>('SELECT ord, config FROM templates WHERE ntid = ? ORDER BY ord', nt.id);
  const byOrd = new Map(look.templates.map((t) => [t.ord, t]));
  if (rows.length !== look.templates.length || rows.some((r) => !byOrd.has(r.ord))) return 'changed';

  await db.transaction(async () => {
    for (const r of rows) {
      const t = byOrd.get(r.ord)!;
      const config = withFields(r.config, new Map([[TEMPLATE.qfmt, str(t.front)], [TEMPLATE.afmt, str(t.back)]]));
      // update_dict stores a template with mtime 0 and usn 0, as sync does: schema 11 carries neither.
      await db.run('UPDATE templates SET config = ?, mtime_secs = 0, usn = 0 WHERE ntid = ? AND ord = ?', config, nt.id, r.ord);
    }
    // Every requirement is written, an empty one (the first card type's, needing nothing) included, as prost writes a repeated message.
    const config = withFields(nt.config, new Map([[NT.css, str(look.css)], [NT.reqs, look.reqs.map(requirementBytes)]]));
    await db.run('UPDATE notetypes SET config = ?, mtime_secs = ?, usn = -1 WHERE id = ?', config, Math.floor(now.getTime() / 1000), nt.id);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return 'saved';
}
