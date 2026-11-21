---
paths:
  - "src/anki/**"
  - "src/db/ankiLink.ts"
  - "src/db/ankiApply.ts"
  - "src/ui/AnkiTransfer.tsx"
  - "src/ui/SyncSettings.tsx"
  - "src/ui/useSync.ts"
  - "modules/anki-unicase/**"
  - "tests/anki/**"
  - "tests/fixtures/anki/**"
  - "tests/support/**"
---

# The kept Anki collection and sync

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## The Anki collection (`src/anki/`, `src/db/ankiLink.ts`)

Franki keeps a whole Anki collection file and writes every answer into it. It gets there by sync
(below) or by file: a collection package (.colpkg) from AnkiMobile's Export, packed back up for
Anki with "Send to Anki", one app holding the collection at a time.

- **Notes added, edited and deleted in Franki go into the kept collection as Anki writes them**
  (`src/anki/noteWrites.ts`, through `noteService.ts`, which keeps Franki's tables in step), checked
  live against Anki. A deck or note type is found by reading the whole table (`NOT INDEXED`) and
  comparing names here, since a lookup by name needs Anki's collation.
- **Anki's collection is the record.** A package import replaces every Anki card's scheduling
  (`applyAnkiCollection`), studied here or not, unlike a TSV re-import; the screen warns first
  when answers haven't been sent to Anki yet.
- **Franki writes an answer into the kept collection the way Anki writes one**
  (`src/anki/writeback.ts`: card columns, one review log row, both usn -1, and the collection's
  modified stamp, `COL_MODIFIED_SQL`, without which a sync never sees the answer), plus the
  "studied today" counts of the card's deck and every deck above it (`src/anki/deckStats.ts`),
  which Anki's daily limits read instead of the review log.
  Every answer and undo in Review goes through `writeAnkiAnswer` / `undoAnkiAnswer`, which wait on
  `lockAnki` while a sync or an import holds the collection. A sync also writes what Anki's own
  sync writes (notes, graves, config, decks in place).
- **An answer is owed to the collection until it's written there** (`src/anki/owedAnswers.ts`, the
  `anki_owed` table). Review saves Franki's rows and the owed row first (`reviewWrites`), then
  writes the collection in a second queue (`ankiWrites`), because that write can wait a long time
  behind a sync stuck on the network and the next answers' rows mustn't wait with it.
  `writeAnkiAnswer` deletes the owed row in its own transaction and writes nothing when the row is
  already gone, so an answer can't be written twice. Whatever is still owed at launch is written
  then, before the first sync (`useOwedAnswers`). `reviewWrites.idle()` waits for both queues.
- **Anki's three collated tables (fields, templates, notetypes) are read from a scratch copy**
  with the `unicase` collation stripped (`STRIP_UNICASE_SQL`), which works on any build. Never
  strip it from the kept collection: its indexes are ordered by it.
- **The app registers Anki's `unicase` collation itself** (`modules/anki-unicase`, a local Expo
  module, on every connection via expo-sqlite's `exsqlite3_auto_extension`), so a sync can write
  the collated tables. Its ordering is measured against Anki's own, quirks included
  (`make-table.py` says which); change the table only by rerunning that script, and check with
  `tests/anki/sync/unicase.test.ts`. The tests load the same C as a SQLite extension
  (`tests/support/unicase.ts`).
- **Blobs are protobuf.** Read and write only field numbers taken from `proto/anki/*.proto` in
  ankitects/anki, named where they're used (`collection.ts`, `packageFormat.ts`); don't guess.
- **Packages are written with zstd's uncompressed blocks** (`RawZstdEncoder`): there's no JS zstd
  compressor, and Anki reads raw blocks like any other. Each media file needs its SHA-1 in the
  media list, or Anki refuses the package.
- **Everything streams** (`ByteSource` / `ByteSink` in `package.ts`), so a package with hundreds
  of megabytes of media is never whole in memory.
- **Test against what Anki itself writes.** `tests/fixtures/anki/` holds a collection and its
  .colpkg made by Anki (`make-collection.py` rebuilds them with the `anki` Python package); extend
  that script for a new case. After changing what goes into a package, run
  `tests/fixtures/anki/verify-package.py`, which imports Franki's package with Anki's own code and
  checks the answers are there (it needs the `anki` package, so CI can't run it).

## Sync (`src/anki/sync/`)

Anki's sync protocol (v11), as an Anki client speaks it, against the user's own Anki sync server
(`server/` sets one up). AnkiWeb's terms allow only Anki's own apps, so never point it there.

- **Test against Anki's own server.** `tests/anki/sync/live.test.ts` starts `anki.syncserver` and
  uses Anki's own client (`sync-device.py`) as the other device, then compares both collections row
  by row: `FRANKI_ANKI_PYTHON=<venv>/bin/python npx vitest run tests/anki/sync/live.test.ts`. CI
  skips it (no Anki), so run it after any change to the sync. The CI tests use a scripted server and
  fixtures Anki made (`make-sync-fixtures.py`); the protocol's shapes come from rslib/src/sync.
- **Decks, deck options, note types and tags are merged in place as Anki's merge does**
  (`deckRows.ts`, `deckConfigRow.ts`, `notetypeRows.ts`, each checked against rows Anki wrote),
  when the collation is registered. Without it (a build made before the module) a sync still updates
  an existing deck in place and otherwise finishes, so Franki's answers reach the server, then
  downloads the whole collection (`downloadNeeded`). The live test runs both ways.
- **A preset changed in Franki (`presetWrites.ts`: the new card order) is written into the kept collection
  as Anki writes one** (`config` edited in place, `mtime_secs`, usn -1, the collection's modified stamp)
  and sent in `applyChanges` as the JSON Anki's own client sends (`deckConfigJson`, the inverse of
  `deckConfigRow`, checked against presets Anki wrote). **A note type's templates and styling changed in
  Franki** (`notetypeWrites.ts`, the Note type screen) are written the same way, with the card requirements
  Anki works out from the fronts (`cardRequirements`) and the templates' mtime and usn zeroed as Anki's
  `update_dict` leaves them (`notetype-vectors.json`), and sent in `applyChanges` as `notetypeJson`. That
  needs the collation; without it a note type pending still needs a full upload, so the change is refused.
  Franki never adds, removes or renames a field or card type: that changes the schema (`scm`), and every
  device then has to replace its collection. Anki adds a card when a template edit makes a note generate
  one, which Franki doesn't yet, so such an edit is refused (`notesGainingCards`).
- **Media made in Franki (a recording) is sent by the upload half of Anki's media sync**
  (`pushMedia` in `mediaSync.ts`). A file joins the pending list only once a note is saved with it,
  and a pending file the server also changed is settled by Anki's rules (`mediaAction`). The live
  test checks it with Anki's own client reading the file back.
- **Sync JSON keeps 64-bit integers exact** (`sync/json.ts`): note type fields and templates carry
  random 64-bit ids that `JSON.parse` would round. Read and write sync JSON only through it.
- **A sync runs on its own connection to the kept collection, in one transaction, inside
  `lockAnki`**: a failure rolls back every local change and aborts on the server.
- **The server's sign-in key lives in the Keychain** (`expo-secure-store`); the password is never
  stored. Settings are this phone's own and stay out of a backup.
