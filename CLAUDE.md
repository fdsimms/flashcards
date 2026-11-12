# CLAUDE.md

Guidance for Claude Code working in this repo. Many rules here were carried over from the owner's
much larger todo app (dundundun), where each exists because the mistake it prevents shipped there,
often more than once. Expo-specific guidance (versioned docs, `npx expo install`, EAS) is in
AGENTS.md:

@AGENTS.md

## What this app is

Franki: a personal, lightweight Anki replacement for iPhone (the repo is still `flashcards`): language vocab (Thai, Polish, Russian, German
and others) plus the odd trivia deck. It doesn't need Anki's full feature set, but it must import
the owner's existing Anki decks and keep their scheduling. Where Anki has a convention the owner is
used to (the study day starting at 4 AM, a review being due for its whole day, re-imports keeping
progress), match it unless there's a stated reason not to.

It also has **Read & Listen**, which replaced the owner's separate app (fdsimms/ailing): texts
written from the words in the deck, to read and listen to. See "Read & Listen" below.

## Commands

```bash
npm install          # node_modules isn't checked in; a fresh clone needs this first
npm run ios:device   # build the development build in Xcode and install it on a plugged-in iPhone
npx expo start       # dev server for that build (no Expo Go; builds are all local, see README)
npm run typecheck    # tsc --noEmit
npm test             # vitest, the whole suite in under a second
npx vitest run tests/core/queue.test.ts   # one file, while iterating
npm run test:tz      # the suite in UTC+14, UTC-11 and Newfoundland (half-hour offset, DST)
npm run verify       # the whole verification loop, below
cd server/reader && uv run ruff check . ../speech && uv run ruff format --check . ../speech && uv run mypy && uv run mypy ../speech && uv run pytest -q && uv run pytest -q ../speech/tests
                     # Read & Listen's server and the shared Azure client: their loop, after any change under server/reader or server/speech
```

**The verification loop is `npm run verify`** (`tsc --noEmit && vitest run && git status --short`).
Run it, not a subset, before committing. Read the closing `git status`: an uncommitted file looks
exactly like a passing run. All of it is green on `main`; if anything is red, it's you. That holds
even when it's red before you've touched anything: fix a small, obvious break in the same PR and
say so, and ask about anything bigger.

**CI (`.github/workflows/test.yml`) runs typecheck and the suite on every PR and every push to
`main`**, the suite in UTC+14 and in shuffled order, and `npx expo export --platform ios` on `main`
and on PRs touching a bundle-relevant path. Don't run `expo export` locally unless you changed an
import path, an asset, `app.json` or a dependency: it only catches bundle-time breakage.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## PR workflow

Once a change is complete and verified (`npm run verify` green, the feature exercised where that's
possible), open a PR without waiting to be asked. Skip it only for a concrete reason (the work is
incomplete, checks are red, or the user said to hold off), and say why.

**Before pushing a follow-up fix to a PR you opened, check whether it already merged**
(`git fetch origin main && git merge-base --is-ancestor <branch> origin/main`). Commits pushed to a
merged branch never reach `main`. If it merged, cut a fresh branch from `origin/main` and open a new
PR; if not, push to the existing one.

**Target every PR at `main`; never base one on another PR's branch.** A PR stacked on a sibling
merges into that branch once the sibling has landed, and its work never reaches `main`. When work
depends on an unmerged PR, branch from it but open against `main`, and say which PR merges first.

**One session's work is one PR when the pieces are likely to conflict.** Split only when the pieces
touch disjoint files and either can merge first. If unsure, combine them.

**Batch pushes.** Each push reruns CI, and Actions minutes are a fixed allowance. When several
review comments or failures land together, fix them all locally, run the loop, and push once. Push
and wait only when the next fix depends on seeing this one's CI result.

## Bugs, siblings, orphans and follow-ups

**A real bug found in passing, with a small, obvious fix (one function, no design call): fix it in
the same PR** and note it in the description. Anything that needs a design decision, touches several
files, or you're not sure is wrong: **stop and ask** (`AskUserQuestion` if the harness has it, a
plain question otherwise). "Say so" means ask, not a line in a PR description nobody rereads.

**When a fix applies to one component, look for its siblings yourself.** Grep for the same shape
(the same copy-pasted structure, the same missing treatment). The same mechanical change applied
again goes in the same PR; a sibling that needs its own design call gets a question.

**Remove what your own change orphaned** (a prop, a style, a helper, an export, a comment
describing behavior you took out) in the same PR, after grepping every caller, tests included.
Code that was already dead before you arrived is a different case: ask before removing it.

**Never file a GitHub issue without asking first**, unless the user directly asked for one. For
every piece of adjacent work you decided not to do, ask with three options: fix it now, file an
issue, or leave it. A "What's left" section in a PR body is not a decision; it's a decision
avoided.

**Offer to write down a rule when a fix's cause isn't obvious from the code** and a future reader
would plausibly repeat the mistake. Say in one line what it would say and where, and let the user
decide. The home is the narrowest one a reader will still find: a comment at the site, then this
file only for rules that cut across the app. Better still is making the mistake impossible: a shared
helper, or a test that fails the build (`tests/noUtcDayKey.test.ts` is the shape). Write the rule
and its reason, not the story of the PR that found it.

## GitHub issue labels

When creating an issue, apply exactly four labels:

1. **Type**: `bug` · `enhancement` · `chore` (refactor, tooling, tracking) · `explore` (research or
   a design question, not yet committed to building)
2. **Area**: `area:review` (the review screen, the queue, FSRS scheduling, TTS) · `area:import`
   (Anki TSV/JSON import, `.apkg`, media) · `area:decks` (the deck list, note types, card rendering,
   editing cards) · `area:app-wide` (settings, theming, storage, build, anything cross-cutting)
3. **Model**: `model:haiku` (trivial, one file) · `model:sonnet` (typical feature or fix, the
   default) · `model:opus` (spans many layers, real design tradeoffs)
4. **Effort**: `effort:low` · `effort:medium` (the default) · `effort:high` · `effort:xhigh`

For a direct "file this" with nothing else said, use enhancement / area:app-wide / model:haiku /
effort:low.

## User-facing copy

**Plain, literal terms.** Say what a setting or button does, the way the rest of the app talks. No
jokey metaphors or cutesy voice. Read each line aloud and rewrite it if nobody would say it that way.

**An error says what happened, then what to do.** "Couldn't import deck.apkg. Anki package files
can't be read yet. In Anki, export as..." rather than "failed: <exception>". Buttons name the action.

**American English** in anything a user sees. **No em dashes** in UI text, alerts, commit messages,
PR descriptions or issue bodies: use a period, colon, comma or parentheses. Code comments are
exempt from both.

**Never offer an input a code path can drop without saying so.** A file the importer can't read is
refused with the reason; warnings past the display limit are counted ("and 12 more warnings"), not
cut off silently. A field that's shown gets honored, refused inline with the reason, or not shown.

## Finding your way around

```
src/core     types, FSRS wrapper, queue, deck tree, study day, card rendering, Anki templates,
             session bookkeeping (undo), stats, config (pure TS)
src/import   TSV + Anki JSON importers, re-import matching (reconcile.ts)
src/db       Repo interface + MemoryRepo (tests), SQLite repo (app), backup planning
src/media    the media folder (expo-file-system)
src/ui       screens, the shared pieces they're built from (kit.tsx), the theme, CardWebView;
             Read & Listen's screens are Read*.tsx and Reader.tsx
src/reader   Read & Listen's side of the app: its server's API, the reading session, playback (pure,
             tested; storage.ts keeps the passphrase in the Keychain)
src/anki     Anki collection packages: reading, writing answers back, packing (pure, tested);
             sync/ syncs with an Anki sync server (pure, tested; syncService.ts is the phone's side)
server/      a ready-to-run Anki sync server (Docker, Caddy); server/mcp is the MCP for Claude (Python);
             server/reader is Read & Listen's server (Python); server/speech is the Azure client both use
docs/read-and-listen/   Read & Listen's spec (brief.md) and the decisions since (architecture.md)
tests/       vitest, mirroring src/ (src/core/queue.ts -> tests/core/queue.test.ts)
```

**Tests mirror source 1:1**, and only pure logic is tested (`src/core`, `src/import`, `src/db`'s
MemoryRepo and backup planning, `src/anki` except files.ts, `src/reader` except storage.ts). Vitest runs in `node` with no React renderer, so there are no
screen tests. Don't add a renderer to cover a UI change: verify by reasoning about the code and say
so plainly rather than implying you ran it. Keep logic out of screens so it can be tested: if a
screen grows a decision worth testing, move it into `src/core`.

**Fixtures are local times**: `new Date(2026, 10, 11, 12)` or `'2026-11-11T12:00'`, never a `...Z`
literal that the code then reads back as a local date. `tests/support/fixtures.ts` holds the shared
ones.

## Architecture and the rules that come with it

### Data flow

SQLite (expo-sqlite, WAL) -> `src/db/sqliteRepo.ts` (implements `Repo`) -> screens. **Write to
SQLite first, then update React state**, so a crash between the two loses the screen's copy, not
the review. `MemoryRepo` is the reference implementation and must behave like the SQLite one
(re-import rules included), since every repo test runs against it.

**Audio plays with the silent switch on** (`setAudioModeAsync({ playsInSilentMode: true })` in
`App.tsx`): iOS otherwise mutes an app's recordings, TTS and WebView audio alike, which made every
play button look broken. `expo-audio`'s config plugin adds no microphone permission (Franki never
records) but does allow background audio, which only Read & Listen's reader turns on, while it's
open (`shouldPlayInBackground`), so listening goes on with the screen locked.

**Everything stays on the device, except sync and Read & Listen.** TTS is `expo-speech` (on-device
voices) and storage is local SQLite. The network calls are sync with the user's own Anki sync
server (`src/anki/sync/`), off until they sign in, and Read & Listen, which talks to its server
beside the sync server and is off until its passphrase is entered (Settings, Read & Listen). A
future feature that needs the network (a dictionary lookup, an AI hint) ships behind its own setting
that defaults to off.

### The study day

**The day starts at the collection's "Next day starts at" (`CollectionSettings.dayStartsAtHour`,
read from Anki's `rollover`; 4 AM by default, `DAY_STARTS_AT_HOUR`), not midnight.** A 1 AM
session still belongs to the day before: its new cards come out of that day's limit.
`src/core/day.ts` owns this; screens read the hour from `repo.collectionSettings()`.

- **Anything that decides which day something belongs to goes through `studyDayStart` /
  `nextStudyDayStart`**, never `setHours(0, 0, 0, 0)`, `toDateString()` or a bare `new Date()`
  standing in for "today". A bare `new Date()` is right for a timestamp (`reviewedAt`).
- **Never cut a day key out of `toISOString()`.** It's UTC; a study day is local. Use `dayKeyOf` /
  `studyDayKey`. `tests/noUtcDayKey.test.ts` fails the build on it, and CI runs in UTC+14 so a
  UTC/local mix-up shows. `npm run test:tz` shows one before CI does.
- **Day-dependent functions take `now` and `dayStartsAtHour` as parameters** rather than reading
  the clock or a setting, so tests can pin both.

### Scheduling

FSRS via `ts-fsrs`, wrapped in `src/core/scheduler.ts`; a card's whole FSRS state is `Card.sched`,
with dates as ISO strings. **A Review-state card is due for its whole study day** (its due instant
carries the time of day it was last answered); **a Learning/Relearning card is due at its exact
instant** (`isDue` in `src/core/queue.ts`). Once nothing else is left, learning cards come up to
the collection's learn-ahead limit early, and the review screen waits for the next one rather
than declaring the deck done.

**Learning steps are Anki's, applied on top of FSRS** (`stepOutcome` in `scheduler.ts`, from
rslib's states/steps.rs): the ts-fsrs engines run with no steps, for the memory state and
intervals, because ts-fsrs's own steps graduate a card on a step of a day or more and give Hard a
different delay. Each deck's preset steps apply, else Anki's defaults. A step crossing into a
later day is Anki's queue 3 (`isInterdayLearning`); its answers count as reviews and use the
review limit. **Leeches** follow the preset (`becameLeech`): tagged, suspended if it says so.

**Fuzz and the load balancer are Anki's, bit for bit** (`src/core/ankiFuzz.ts`, `loadBalance.ts`):
the ts-fsrs engines don't fuzz; intervals get Anki's fuzz from Rust's StdRng (ChaCha12) seeded by
the Anki card id plus reps before the answer, in f32 as Anki computes them, or the load balancer's
day from a snapshot taken when the session is built. `tests/fixtures/anki/fuzz-vectors.json` holds
outputs recorded from the real `anki` package; a change here has to keep matching them.

**Each deck schedules with its Anki preset's FSRS weights and desired retention** (`DeckParams`,
read from the collection's deck options when it's imported). `paramsForDeck` falls back to
the nearest ancestor deck, then to the `ts-fsrs` defaults. Every `review`/`previewIntervals` call
passes the deck's params; one that doesn't silently schedules with the defaults.

**Daily limits are per deck, from its Anki preset** (`DeckParams.newPerDay` / `reviewsPerDay`, or
a today-only limit from Custom Study on its day), with `NEW_PER_DAY` / `REVIEWS_PER_DAY` in
`src/core/config.ts` only for a deck that has none.

**A study session is built as Anki's v3 scheduler builds it** (`treeQueue` in
`src/core/deckTree.ts`, orders in `src/core/order.ts`; each rule's source in rslib is named where
it's implemented). Limits form a tree from the deck opened down: a card in Polski::Odmiana counts
against Odmiana's limit and Polski's when Polski is opened, but Polski's limits don't apply when
Odmiana is opened unless the collection's "apply all parent limits" is on. New cards studied today
also use review room, unless "new cards ignore review limit" is on. Steps within the day are never
limited. The preset's gather, sort, review and mix orders decide the order (Anki's new-card
position for new cards). A card is always scheduled with **its own home** deck's settings
(`cardHomeDeck`), never the parent being studied, and is studied in the deck it's in
(`cardDeck`): an Anki filtered deck takes its cards out of their home decks.

**Today's counts include answers given on every device** (`studiedToday` in `src/core/queue.ts`):
Anki's cards are counted from the kept collection's review log, which holds answers synced from
AnkiMobile and Anki as well as Franki's own, and only Franki-only cards from Franki's table.
Counting Franki's table alone offered new cards already studied in Anki that day. **A card Anki
buried today is held back until the next study day** (`isBuried`, from the card's `mod` when it
was imported); one buried on an earlier day is studied, as Anki unburies at each new day. **Answering
in Franki buries siblings as Anki does** (`siblingsToBury`, by the answered card's own preset's
Burying options), in Franki's tables and in the kept collection in the answer's own transaction
(queue -2), and undo restores them with the answer.

**Counts shown in two places come from one function.** The deck list (`deckRows`) and the review
screen both call `treeQueue`, with input from `queueInput`, so a deck never says "20 new" and then
opens with none. A check that
predicts what another code path will do calls that code path's function; don't write a lookalike.

**A progress gate replaces a deck's daily new-card limit** (`DeckSettings.gateCap`, set on Deck
options): new cards come in only while fewer than the cap are in progress in that deck and its
subdecks, and no daily new limit applies anywhere under it. **In progress is read from the card's
current FSRS schedule every time, never stored** (`isInProgress`, `src/core/progress.ts`): started,
and not yet a Review scheduled `GURU_INTERVAL_DAYS` (7, WaniKani's Guru interval) or more out. So a
card that drops back under a week (a lapse, a shorter interval) counts again at once. Counting
correct answers instead was tried and dropped: FSRS spaces reviews too fast for "four right in a
row" to track how well a card is known. A gate on a deck above the one
opened still applies, so the review screen loads every card, not just the opened subtree.
`DeckSettings` is the app's own and an import never writes it; `DeckParams` is Anki's and every
import replaces it. A setting the user makes here goes in the first.

**Undo restores the card as it was and deletes the review row** (`AnswerRecord` in
`src/core/session.ts`), and today's counts go back down by the same rule they went up
(`bumpStudied`). The undone card is shown next. As in Anki, undo stops at the last sync: a synced
answer is already in the server's history (`undoAnkiAnswer` refuses it, under `lockAnki`).

### Import

- **Ids are derived, never random.** A note's id comes from its source (Anki's note id, the TSV
  GUID column, or `tsv:<deck>:<entry>`), and a card's id is `<noteId>:<kind>`, so re-importing the
  same file updates rows instead of duplicating them. Any row the app writes unattended follows
  the same rule.
- **A re-import finds a note it already has even when the id differs** (`reconcileIds`): same id
  first, else the one stored note with the same note type and front field (`matchKey`), in any
  deck. Several matches means a homograph: import as new and warn, never guess. Import screens
  always pass results through it before writing.
- **Re-importing never resets a card already studied here.** The upsert only overwrites scheduling
  and suspension on a card still in state New. Keep that true in both repos.
- **A card whose kind the note no longer generates is `retired`, not deleted or suspended.**
  `suspended` comes from Anki and a TSV re-import doesn't carry it, so the two must stay separate;
  retiring keeps the card's history, and turning the kind back on restores it.
- **An Anki card's `ord` is its template's position in the note type**, fixed whichever cards a
  note generates (`omnilanguageKindByOrd`). Matching it against the list of kinds a note happens to
  generate dropped the audio card's scheduling on notes with no reverse card.
- **`omnilanguageFieldNames` must match the live note type exactly** (check with AnkiMCP's
  `model_field_names`): a TSV without `#columns` is mapped by position, so a field added in Anki
  and missing here shifts every field after it.
- **An unreadable file is refused with the reason and what to export instead**, never parsed as
  something else and left to fail with an unrelated message (`.apkg`, and a backup `.db`, on the
  Import screen).

### Card rendering

- **Omnilanguage renders natively** (`renderCard`), playing the note's recorded `Audio` file
  (`RenderedCard.audioFile`, via `expo-audio`) and falling back to TTS only when there's none or
  the file isn't on the phone; **every other note type renders its
  Anki templates** (`src/core/template.ts`) in `CardWebView`, one `t<ord>` card per Anki card.
  Template rendering follows Anki's rules where they matter: a field holding only whitespace,
  `<br>` or `<div>` is empty but an image isn't (`fieldIsEmpty`), and a cloze card's ordinal is its
  cloze number - 1.
- **The WebView loads a page written to a file, not an HTML string**, with read access to the
  documents folder and `<base href>` at the media folder. iOS's WebView only reads local files for
  a page that came from a file URL; an HTML string with a file:// baseUrl shows no images.

### Screens and styling

- **Build screens from `src/ui/kit.tsx`** (`Screen`, `Button`, `Card`, `Help`, `HeaderAction`,
  `Count`, `MessageList`) before styling a `Pressable` or a box by hand, so a header or a button
  looks the same everywhere.
- **`Screen` pads by the safe-area insets; never pad a screen's top or bottom by a fixed number.**
  The status bar and Dynamic Island differ by iPhone, and a hard-coded 56 put headers under them.
- **Every color, gap, corner and text size comes from `src/ui/theme.ts`** (`useTheme()`, `space`,
  `radius`, `type`). `tests/noRawColors.test.ts` fails the build on a hex color in a screen; add a
  token with a light and a dark value instead. Text grows with the system text size, so a box
  holding text gets padding or a `minHeight`, never a fixed `height`.

### The Anki collection (`src/anki/`, `src/db/ankiLink.ts`)

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
- **Franki writes the kept collection only through `cards` and `revlog`, the way Anki writes
  an answer** (`src/anki/writeback.ts`: card columns, one review log row, both usn -1, and the
  collection's modified stamp, `COL_MODIFIED_SQL`, without which a sync never sees the answer).
  Every answer and undo in Review goes through `writeAnkiAnswer` / `undoAnkiAnswer`, which wait on
  `lockAnki` while a sync or an import holds the collection. A sync also writes what Anki's own
  sync writes (notes, graves, config, decks in place).
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

### Sync (`src/anki/sync/`)

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
- **Sync JSON keeps 64-bit integers exact** (`sync/json.ts`): note type fields and templates carry
  random 64-bit ids that `JSON.parse` would round. Read and write sync JSON only through it.
- **A sync runs on its own connection to the kept collection, in one transaction, inside
  `lockAnki`**: a failure rolls back every local change and aborts on the server.
- **The server's sign-in key lives in the Keychain** (`expo-secure-store`); the password is never
  stored. Settings are this phone's own and stay out of a backup.

### The MCP (`server/mcp/`)

A Python MCP that gives Claude the collection, run beside the sync server. It's **one more Anki
client of the user's sync server, built on Anki's own `anki` package**, never Franki's TypeScript
and never the server's files, so searches, note adds, scheduling and sync behave exactly as in Anki.

- **Every tool goes through `CollectionManager.read` / `write`** (`collection.py`): one call at a
  time (the `anki` package isn't thread-safe), a sync before reading, a sync after every change. A
  full sync the server asks for is taken as a download, unless the MCP has changes that never
  reached the server: then it refuses with the reason rather than overwrite either side.
- **An error the caller can fix raises the SDK's `ToolError`** with what to change; any other
  exception reaches the model as a bare "Error executing tool". Batch tools report each item's
  result or reason rather than failing the whole call.
- **Studying follows Anki's queue**: Anki only answers the card at the top of it, so `rate_card`
  checks that first, and the server instructions tell Claude to show the answer and get the user's
  rating before calling it.
- **Sign-in is OAuth for one person** (`auth.py`): registration only for Claude's callback
  addresses and loopback (any port, RFC 8252), a password page, rotating refresh tokens, tokens
  stored hashed.
- **Tests run against a real `anki.syncserver`** with Anki itself as the other device
  (`tests/conftest.py`), and Azure faked (`FakeAzure`): `cd server/mcp && python -m pytest`, after
  `pip install -r requirements-dev.txt ../speech`. CI runs them in their own job.
- **Azure is called through one client shared with Read & Listen** (`server/speech`, the
  `franki_speech` package), so a fix to how Azure is called reaches both. Both images are built from
  `server/` to copy it (`server/.dockerignore` keeps `.env` out of the build). Azure's request
  shapes are unverified against a live key (its docstring says which parts were checked).
- Keep `anki` in `requirements.txt` at the version the sync server runs (`ANKI_VERSION`;
  `tests/test_anki_version.py` checks).
- **A merge to `main` that touches `server/` deploys itself** (`server/update.sh`, on a timer, within
  about 15 minutes) and restarts sync, the MCP and Read & Listen. A server change must work with nothing done by
  hand on the server; if one truly needs a step there (a new `.env` setting), the PR says so plainly.

### Read & Listen (`server/reader/`, `src/reader/`)

Texts (dialogues, short stories) written by Claude from the words already in the Thai and Spanish
decks, checked in code to be 95-98% known words, recorded with Azure's voices, read in the app with
a gloss on every word. **`docs/read-and-listen/brief.md` is the spec, with the evidence behind each
rule; `architecture.md` beside it has every decision since.** Where they and this file disagree,
they win and this is stale. The rules that must not break:

- **Never grade FSRS from exposure, and never create Anki cards or reviews without an explicit
  approval step.** The server only reads the collection (`collection.py`; `test_collection.py`
  checks a read leaves nothing to send), and the app's side imports nothing that schedules or
  writes cards (`tests/reader/noGrading.test.ts` fails the build on it). Adding a marked word to the
  deck goes through the note editor, opened by `App.tsx`, where saving is the approval, and at most
  `MINING_PER_DAY` a study day (`src/reader/mining.ts`).
- **Generate, then verify in code.** The model writes lines as `|`-split strings with stretch words
  in `*asterisks*`; the server re-segments every line itself (lexicon-first for Thai, by lemma for
  Spanish) and sends drafts under the floor back with the unknown words named. Never trust the
  model to stay in vocabulary.
- **A word counts as known only when its note is studied** (young or mature); a word found only
  inside a studied phrase is partial and counts as unknown. Spanish also counts the 10,000 most
  common word families.
- **Batch and cache.** Texts are written in the background and queued, never inside a request, and
  never one API call per word or page view.
- **The owner picks the topic.** Already rejected, don't revisit: cloze cards, saving generated
  sentences as Anki cards, rescheduling Thai cards.
- **It reads Anki as a sync client of the sync server beside it**, through Anki's own `anki`
  package like the MCP, every read under `with_timeout` (45 seconds) so a server that stops
  answering leaves it on the last snapshot. Keep `anki` in `server/reader/pyproject.toml` at the
  sync server's `ANKI_VERSION` (`tests/test_anki_version.py` checks).
- It runs as the `reader` service in `server/docker-compose.yml`, under `/reader` on the sync
  server's domain, with its own passphrase. Its keys (Claude, Azure) stay on the server, never in
  the app.
- **In the app, the server holds Read & Listen's data** (topics, texts, the reading log, marked
  words, grammar choices, each language's deck); the screens fetch and show it, and keep nothing but
  the passphrase, the reader's speed and highlight, and today's count of words added to the deck
  (`src/reader/storage.ts`). The address is the sync server's plus
  `/reader` (`readerAddress`), so it's on only while sync is.

### Backup

- **A backup is `VACUUM INTO` a file plus a `media` table of the media folder, shared through the
  share sheet; a restore replaces each table's rows inside one transaction** (`restorePlan` in
  `src/db/backup.ts`), copying only the columns both sides have, so a backup from before a
  migration still restores, then rewrites the media folder from the backup's. A new table that
  holds the user's data goes in `RESTORED_TABLES`, or a restore silently leaves it behind.
  `settings` is deliberately not in it: when this phone last backed up isn't the backup's to say.
- **The kept Anki collection travels in the backup too** (`anki_collection`, in 1 MB pieces), with
  the settings that say what of it was already sent (`ANKI_SETTING_KEYS`). Without it, a restore
  would bring back answers that could never reach Anki.

### After an `await`

**Check the result still belongs where it's about to be written, and that the action can't run
twice.** A tap can land again while a write is in flight: `Review`'s `answer` holds an `answering`
ref so a double tap logs one review, not two from the same old state, and updates state with a
functional `setCards(prev => ...)` because the render's own `cards` is stale once the awaits
return. A screen can also be left mid-await; capture what the request was about before the await
and compare after.

### Database

- **A new column is appended to `MIGRATIONS` in `sqliteRepo.ts`**, never added to the
  `CREATE TABLE`, which only runs on a fresh install. Each entry is skipped when `PRAGMA table_info`
  shows the column already exists. Don't switch to a `user_version` counter: it has to be kept in
  step by hand and desyncs when tables are recreated without resetting it.
- **A one-time backfill is behind a done flag**, or it costs a full table scan on every launch.
- Dates are ISO strings; booleans are `0`/`1`; `fields`, `tags` and `sched` are JSON text.

## Working style

**Stay in scope.** Fix what was asked in the pattern the surrounding file already uses. Adjacent
code that merely looks improvable isn't the task (see "Bugs, siblings, orphans and follow-ups" for
what to do about a real bug).

**Verify an unfamiliar API instead of guessing it.** Expo changes every SDK; fetch the versioned
docs (AGENTS.md says how) or read the package's `.d.ts` in `node_modules` before writing a call.
The same goes for `ts-fsrs` and for Anki's export formats: if a format detail can't be confirmed,
say so in a comment at the call site and in the PR description as an open risk.

**Say the sequence before a change that spans layers** (db + core + UI). The constraint usually
lives downstream: the schema and the scheduling rules decide what the UI may do.

**These rules are strong defaults, not settled law.** Most carry their reason. If a case doesn't
fit the reason, or there's a genuinely better approach, say so and ask rather than either following
it blindly or quietly ignoring it.
