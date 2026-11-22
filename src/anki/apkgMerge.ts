import { ankiToday } from '../core/order';
import { Refusal } from '../core/failure';
import { readDeckKind } from './collection';
import { canonicalTags } from './noteWrites';
import { utf8Decode } from './protobuf';
import { hasUnicase, type SqlValue, type SyncDb } from './sync/collectionSync';
import { parseJson } from './sync/json';
import { COL_MODIFIED_SQL, queueForType } from './writeback';

/**
 * A deck package (.apkg, Anki's "Deck package" export) merged into the kept collection, as
 * Anki's own import of one does (rslib/src/import_export/package/apkg/import): notes are matched
 * by guid, and a note the collection already has is left exactly as it is, scheduling and all,
 * so importing the same file again changes nothing. Every other note comes in with its cards,
 * their scheduling and their review log, written as unsent (usn -1) like a note added in
 * Franki, so a sync or Send to Anki carries them, and their later answers, to Anki.
 *
 * The package's collection is attached to the kept collection's connection as `pkg`. What's
 * checked against what Anki's import makes of the same package: tests/fixtures/anki/make-apkg.py.
 *
 * - Note types are matched by id, as Anki matches them, and reused when their fields and card
 *   templates are the same; otherwise the package's is added as a new note type.
 * - Decks are matched by name; a missing one is added, and so is the preset it uses when the
 *   collection doesn't have it. A card a filtered deck had borrowed goes to its home deck.
 * - A review card's due day is counted from the collection's creation day, which differs between
 *   the two collections, so it's moved by the difference, as Anki's import does. A new card keeps
 *   its position (Anki's import keeps it too, and leaves `nextPos` alone).
 *
 * Note types, decks and tags are Anki's collated tables, so a merge needs the collation
 * (modules/anki-unicase); without it the package is refused rather than half-merged.
 */

/** A deck package that can't be merged, with what to do about it. */
export class DeckPackageRefused extends Refusal {}

export interface DeckPackagePlan {
  /** Notes the collection doesn't have yet, which the merge adds. */
  newNotes: number;
  /** Notes the collection already has (same guid): left as they are. */
  alreadyHere: number;
  /** Cards and review log rows the merge adds, with the new notes. */
  cards: number;
  reviews: number;
  /** The decks the new notes' cards go into ("A::B"), and those of them the collection doesn't have yet. */
  decks: string[];
  newDecks: string[];
  /** Note types added to the collection. A note type changed here can only reach the server by a full upload. */
  newNoteTypes: string[];
}

type Row = Record<string, SqlValue>;
const n = (v: SqlValue): number => Number(v);
const human = (native: string) => native.split('\x1f').join('::');
const fold = (s: string) => s.toLowerCase();

/** `ATTACH`es `pkgPath` as `pkg` for `fn`, outside any transaction, and detaches it after. */
async function withPackage<T>(db: SyncDb, pkgPath: string, fn: () => Promise<T>): Promise<T> {
  await db.run('ATTACH DATABASE ? AS pkg', pkgPath);
  try {
    return await fn();
  } finally {
    await db.run('DETACH DATABASE pkg');
  }
}

async function creationOffset(db: SyncDb, schema: string): Promise<number | undefined> {
  const row = await db.first<{ val: Uint8Array }>(`SELECT val FROM ${schema}.config WHERE KEY = 'creationOffset'`);
  if (!row) return undefined;
  try { const v = Number(parseJson(utf8Decode(row.val))); return Number.isFinite(v) ? v : undefined; } catch { return undefined; }
}

/** A day-numbered due (a review, or learning across days) rather than a position or a timestamp. */
const dueIsDay = (type: number, queue: number, due: number) => type !== 0 && queue !== 1 && queue !== 4 && Math.abs(due) < 1_000_000_000;

/** An id as Anki gives one, moved past every id already taken. */
function idTaker(taken: Set<number>, start: number) {
  let next = start;
  for (const id of taken) if (id > next) next = id;
  next++;
  return (wanted: number): number => {
    if (!taken.has(wanted)) { taken.add(wanted); return wanted; }
    while (taken.has(next)) next++;
    taken.add(next);
    return next++;
  };
}

interface Work {
  plan: DeckPackagePlan;
  write: () => Promise<void>;
}

async function prepare(db: SyncDb, ctx: { now: Date; dayStartsAtHour: number }): Promise<Work> {
  // Note types, decks and tags are kept under Anki's collation: they can't be read reliably or
  // added to without it.
  if (!(await hasUnicase(db))) {
    throw new DeckPackageRefused("This build of Franki can't add decks or note types to the Anki collection. Rebuild the app, then try again.");
  }
  const all = <T = Row>(sql: string) => db.all<T>(sql);
  const nowSecs = Math.floor(ctx.now.getTime() / 1000);

  // ---- notes: by guid ----
  const keptGuids = new Set((await all<{ guid: string }>('SELECT guid FROM main.notes')).map((r) => r.guid));
  const pkgNotes = await all<Row>('SELECT id, guid, mid, mod, tags, flds, sfld, csum, flags, data FROM pkg.notes ORDER BY id');
  const adding = pkgNotes.filter((r) => !keptGuids.has(String(r.guid)));
  const alreadyHere = pkgNotes.length - adding.length;
  const addingIds = new Set(adding.map((r) => n(r.id)));
  const pkgCards = (await all<Row>('SELECT id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM pkg.cards ORDER BY id'))
    .filter((c) => addingIds.has(n(c.nid)));
  const addingCards = new Set(pkgCards.map((c) => n(c.id)));
  const pkgRevlog = (await all<Row>('SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM pkg.revlog ORDER BY id'))
    .filter((r) => addingCards.has(n(r.cid)));

  // ---- decks: by name, a card in a filtered deck at its home deck ----
  const keptDecks = await all<{ id: number; name: string }>('SELECT id, name FROM main.decks NOT INDEXED');
  const keptDeckByName = new Map(keptDecks.map((d) => [fold(d.name), n(d.id)]));
  const pkgDecks = new Map((await all<Row>('SELECT id, name, mtime_secs, common, kind FROM pkg.decks NOT INDEXED')).map((d) => [n(d.id), d]));
  const homeDeck = (c: Row) => (n(c.odid) ? n(c.odid) : n(c.did));
  const usedDecks = new Set(pkgCards.map(homeDeck));
  // A used deck's parents come along too, so the tree stays whole.
  const neededNames = new Set<string>();
  for (const id of usedDecks) {
    const d = pkgDecks.get(id);
    if (!d) throw new DeckPackageRefused("It's missing a deck its cards are in. Export it from Anki again.");
    const parts = String(d.name).split('\x1f');
    for (let i = 1; i <= parts.length; i++) neededNames.add(parts.slice(0, i).join('\x1f'));
  }
  const pkgDeckByName = new Map([...pkgDecks.values()].map((d) => [fold(String(d.name)), d]));
  const newDeckNames = [...neededNames].filter((name) => !keptDeckByName.has(fold(name))).sort((a, b) => a.split('\x1f').length - b.split('\x1f').length);

  // ---- note types: by id, reused when fields and templates match ----
  const usedTypes = new Set(adding.map((r) => n(r.mid)));
  const keptTypes = await all<{ id: number; name: string }>('SELECT id, name FROM main.notetypes NOT INDEXED');
  const keptTypeIds = new Set(keptTypes.map((t) => n(t.id)));
  const keptTypeNames = new Set(keptTypes.map((t) => fold(t.name)));
  const shape = async (schema: string, ntid: number) => JSON.stringify([
    (await db.all<{ name: string }>(`SELECT name FROM ${schema}.fields NOT INDEXED WHERE ntid = ? ORDER BY ord`, ntid)).map((f) => f.name),
    (await db.all<{ name: string }>(`SELECT name FROM ${schema}.templates NOT INDEXED WHERE ntid = ? ORDER BY ord`, ntid)).map((t) => t.name),
  ]);
  const typeMap = new Map<number, number>();
  const typesToAdd: { from: number; id: number; name: string }[] = [];
  const takeTypeId = idTaker(new Set(keptTypeIds), ctx.now.getTime());
  for (const mid of usedTypes) {
    const row = await db.first<{ name: string }>('SELECT name FROM pkg.notetypes NOT INDEXED WHERE id = ?', mid);
    if (!row) throw new DeckPackageRefused("It's missing a note type its notes use. Export it from Anki again.");
    if (keptTypeIds.has(mid) && (await shape('main', mid)) === (await shape('pkg', mid))) { typeMap.set(mid, mid); continue; }
    // A new note type, or one changed since: added beside what's here, under a name of its own.
    let name = row.name;
    for (let i = 1; keptTypeNames.has(fold(name)); i++) name = `${row.name} (imported${i > 1 ? ` ${i}` : ''})`;
    keptTypeNames.add(fold(name));
    const id = takeTypeId(mid);
    typeMap.set(mid, id);
    typesToAdd.push({ from: mid, id, name });
  }

  const deckOf = (pkgDid: number): string => human(String(pkgDecks.get(pkgDid)!.name));
  const plan: DeckPackagePlan = {
    newNotes: adding.length,
    alreadyHere,
    cards: pkgCards.length,
    reviews: pkgRevlog.length,
    decks: [...new Set([...usedDecks].map(deckOf))].sort(),
    newDecks: newDeckNames.map(human),
    newNoteTypes: typesToAdd.map((t) => t.name),
  };

  const write = async () => {

    // Decks, with any preset the collection doesn't have.
    const takeDeckId = idTaker(new Set(keptDecks.map((d) => n(d.id))), ctx.now.getTime());
    const keptConfigs = new Set((await all<{ id: number }>('SELECT id FROM main.deck_config NOT INDEXED')).map((c) => n(c.id)));
    for (const name of newDeckNames) {
      const src = pkgDeckByName.get(fold(name));
      const kind = src ? readDeckKind(src.kind as Uint8Array) : undefined;
      if (src && !kind) throw new DeckPackageRefused(`Its deck "${human(name)}" is a filtered deck here and holds cards of its own. Export it from Anki again.`);
      // A parent the package left out takes its first child's settings.
      const like = src ?? [...pkgDecks.values()].find((d) => String(d.name).startsWith(`${name}\x1f`))!;
      const configId = readDeckKind(like.kind as Uint8Array)?.configId ?? 1;
      if (!keptConfigs.has(configId)) {
        await db.run('INSERT INTO main.deck_config (id, name, mtime_secs, usn, config) SELECT id, name, ?, -1, config FROM pkg.deck_config NOT INDEXED WHERE id = ?', nowSecs, configId);
        keptConfigs.add(configId);
      }
      // A left-out parent has no id of its own to keep: a new one, as Anki gives one (never 0, which no deck has).
      const id = takeDeckId(src ? n(src.id) : ctx.now.getTime());
      await db.run('INSERT INTO main.decks (id, name, mtime_secs, usn, common, kind) VALUES (?, ?, ?, -1, ?, ?)', id, name, nowSecs, like.common, like.kind);
      keptDeckByName.set(fold(name), id);
    }
    const deckMap = new Map([...usedDecks].map((pkgDid) => [pkgDid, keptDeckByName.get(fold(String(pkgDecks.get(pkgDid)!.name)))!]));

    // Note types, with their fields and card templates.
    for (const t of typesToAdd) {
      await db.run('INSERT INTO main.notetypes (id, name, mtime_secs, usn, config) SELECT ?, ?, ?, -1, config FROM pkg.notetypes NOT INDEXED WHERE id = ?', t.id, t.name, nowSecs, t.from);
      await db.run('INSERT INTO main.fields (ntid, ord, name, config) SELECT ?, ord, name, config FROM pkg.fields NOT INDEXED WHERE ntid = ?', t.id, t.from);
      await db.run('INSERT INTO main.templates (ntid, ord, name, mtime_secs, usn, config) SELECT ?, ord, name, ?, -1, config FROM pkg.templates NOT INDEXED WHERE ntid = ?', t.id, nowSecs, t.from);
    }

    // Notes, then their cards, then the cards' review log.
    const takeNoteId = idTaker(new Set((await all<{ id: number }>('SELECT id FROM main.notes')).map((r) => n(r.id))), 0);
    const noteMap = new Map<number, number>();
    for (const r of adding) {
      const id = takeNoteId(n(r.id));
      noteMap.set(n(r.id), id);
      const tags = await canonicalTags(db, String(r.tags).split(' ').filter(Boolean), true);
      await db.run(
        'INSERT INTO main.notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?)',
        id, r.guid, typeMap.get(n(r.mid))!, r.mod, tags, r.flds, r.sfld, r.csum, r.flags, r.data,
      );
    }
    const clock = async (schema: string) => ankiToday(ctx.now, ctx.dayStartsAtHour, n((await db.first<{ crt: number }>(`SELECT crt FROM ${schema}.col`))!.crt), await creationOffset(db, schema))!;
    const shift = (await clock('main')) - (await clock('pkg'));
    const takeCardId = idTaker(new Set((await all<{ id: number }>('SELECT id FROM main.cards')).map((r) => n(r.id))), 0);
    const cardMap = new Map<number, number>();
    for (const c of pkgCards) {
      const id = takeCardId(n(c.id));
      cardMap.set(n(c.id), id);
      // A card a filtered deck borrowed comes home as Anki's Empty sends it (`emptyFilteredDeck`): its
      // own due, and the queue its type puts it in, since a deck built without rescheduling puts new
      // cards in the review queue. Suspended or buried stays so.
      const borrowed = n(c.odid) !== 0;
      const due = borrowed && n(c.odue) !== 0 ? n(c.odue) : n(c.due);
      const type = n(c.type);
      const queue = borrowed && n(c.queue) >= 0 ? queueForType(type, due) : n(c.queue);
      await db.run(
        'INSERT INTO main.cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
        id, noteMap.get(n(c.nid))!, deckMap.get(homeDeck(c))!, c.ord, c.mod, type, queue,
        dueIsDay(type, queue, due) ? due + shift : due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.flags, c.data,
      );
    }
    const takeRevlogId = idTaker(new Set((await all<{ id: number }>('SELECT id FROM main.revlog')).map((r) => n(r.id))), 0);
    for (const r of pkgRevlog) {
      await db.run(
        'INSERT INTO main.revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?)',
        takeRevlogId(n(r.id)), cardMap.get(n(r.cid))!, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type,
      );
    }
    await db.run(COL_MODIFIED_SQL.replace('UPDATE col', 'UPDATE main.col'), ctx.now.getTime());
  };
  return { plan, write };
}

/** What merging the package at `pkgPath` would add, without writing anything. */
export function planDeckPackage(db: SyncDb, pkgPath: string, ctx: { now: Date; dayStartsAtHour: number }): Promise<DeckPackagePlan> {
  return withPackage(db, pkgPath, async () => (await prepare(db, ctx)).plan);
}

/**
 * Merges the package at `pkgPath` into the collection, in one transaction, and returns what it
 * added (worked out again here, since the collection can change between a preview and this).
 */
export function mergeDeckPackage(db: SyncDb, pkgPath: string, ctx: { now: Date; dayStartsAtHour: number }): Promise<DeckPackagePlan> {
  return withPackage(db, pkgPath, async () => {
    let plan!: DeckPackagePlan;
    await db.transaction(async () => {
      const work = await prepare(db, ctx);
      if (work.plan.newNotes) await work.write();
      plan = work.plan;
    });
    return plan;
  });
}

export interface PackageMediaFile {
  /** Its entry in the package ("0", "1"...). */
  index: number;
  name: string;
  /** SHA-1 as hex, from the package's media list. */
  sha1?: string;
}

/**
 * Which of a package's media files to add: those not here. A file here with the same content is
 * already in place; one here with the same name and different content is kept, and named in
 * `kept`, so the screen can say so rather than replace an image other notes show. (Anki's own
 * import renames the incoming file and rewrites the notes that use it; Franki doesn't yet.)
 */
export function packageMediaPlan(files: PackageMediaFile[], here: (name: string) => string | null | undefined): { add: PackageMediaFile[]; kept: string[] } {
  const add: PackageMediaFile[] = [];
  const kept: string[] = [];
  for (const f of files) {
    if (!f.name || f.name.includes('/') || f.name === '.' || f.name === '..') continue;
    const existing = here(f.name);
    if (existing === undefined) add.push(f);
    else if (existing === null || existing !== f.sha1) kept.push(f.name);
  }
  return { add, kept };
}

const count = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** The preview's message: what importing the package adds, and what it leaves as it is. */
export function deckPackagePreviewText(plan: DeckPackagePlan, media: number, syncOn: boolean): string {
  const here = plan.alreadyHere ? ` ${count(plan.alreadyHere, 'note is', 'notes are')} already here and stay as ${plan.alreadyHere === 1 ? 'it is' : 'they are'}.` : '';
  const paras = [
    plan.newNotes
      ? `Adds ${count(plan.newNotes, 'new note', 'new notes')} (${count(plan.cards, 'card', 'cards')}, ${count(plan.reviews, 'past review', 'past reviews')}) to ${list(plan.decks)}.${here}`
      : `No new notes.${here}`,
  ];
  const adds = [
    plan.newDecks.length ? `${plan.newDecks.length === 1 ? 'New deck' : 'New decks'}: ${list(plan.newDecks)}.` : '',
    plan.newNoteTypes.length ? `${plan.newNoteTypes.length === 1 ? 'New note type' : 'New note types'}: ${list(plan.newNoteTypes)}.` : '',
    media ? `Also adds ${count(media, 'image or sound', 'images and sounds')}.` : '',
  ].filter(Boolean);
  if (adds.length) paras.push(adds.join(' '));
  if (syncOn && plan.newNoteTypes.length) {
    paras.push(`Because it adds a note type, the next sync asks whether to upload Franki's whole collection. Sync now first, so nothing on the server is lost.`);
  }
  return paras.join('\n\n');
}

/** The log's lines after an import: what it added, and any media file it kept instead. */
export function deckPackageResultLines(name: string, plan: DeckPackagePlan, media: number, kept: string[]): string[] {
  const lines = plan.newNotes || media
    ? [`Imported ${name}: ${count(plan.newNotes, 'note', 'notes')}, ${count(plan.cards, 'card', 'cards')}, ${count(plan.reviews, 'past review', 'past reviews')}, ${count(media, 'image or sound', 'images and sounds')}.`
      + (plan.alreadyHere ? ` ${count(plan.alreadyHere, 'note was', 'notes were')} already here and ${plan.alreadyHere === 1 ? "wasn't" : "weren't"} changed.` : '')]
    : [plan.alreadyHere
      ? `${name} has nothing new: ${plan.alreadyHere === 1 ? 'its note is' : `all ${plan.alreadyHere} notes are`} already here. Nothing was changed.`
      : `${name} has no notes in it. Nothing was changed.`];
  if (kept.length) {
    lines.push(`${count(kept.length, 'image or sound', 'images and sounds')} in it ${kept.length === 1 ? 'has' : 'have'} the same name as a different file here (e.g. ${kept[0]}), so Franki kept its own.`);
  }
  return lines;
}
