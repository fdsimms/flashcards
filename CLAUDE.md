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
npm test             # vitest, the whole suite in about 3 seconds
npx vitest run tests/core/queue.test.ts   # one file, while iterating
npm run test:tz      # the suite in UTC+14, UTC-11 and Newfoundland (half-hour offset, DST)
npm run verify       # the whole verification loop, below
cd server/reader && uv run ruff check . ../speech && uv run ruff format --check . ../speech && uv run mypy && uv run mypy ../speech && uv run pytest -q && uv run pytest -q ../speech/tests
                     # Read & Listen's server and the shared Azure client: their loop, after any change under server/reader or server/speech
```

**The verification loop is `npm run verify`** (`tsc --noEmit`, the suite in your zone and again in
UTC+14 as CI runs it, then `git status --short`). Run it, not a subset, before committing, a
one-line or copy-only change included: if you didn't run it, the PR isn't ready to open. Read the closing `git status`: an uncommitted file looks
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

**Other sessions merge into `main` while your PR is open, so keep the overlap small.** Several
sessions work in parallel, mostly in the same few screens, and every PR that lands first turns
yours into a conflict for the owner to see.
- **Merge `origin/main` into your branch before every push**, then run `npm run verify`, not only
  when GitHub reports a conflict.
- **Don't widen a shared hub; give the feature a file of its own.** App-wide state is a hook in its
  own file that `AppContext` calls in one line (`useSync`, `useCollapsedDecks`, `useReader`), never
  more lines in AppContext's own body, its value or its dependency list. Likewise a route stays a
  thin wrapper, and a screen's new part is a component beside it rather than more lines inside one
  big render.
- **Keep a PR's life short:** open it once it's verified, and don't keep adding new issues to an
  open one; the longer it's open, the more of `main` it has to catch up with.

**Write the PR body as a record of decisions, not a to-do list.** Each item you'd put under "Not
done", "Not changed", "Not covered", "Not included", "Left out", "Known limits", "Not in this PR" or
"follow-up" is a question you haven't asked yet, even with a reason attached: ask it (fix it now,
file an issue, or leave it; "Bugs, siblings, orphans and follow-ups") before opening the PR, and
write the answer or the issue number instead. A known bug never ships as a line in the body. A PR
that changes what a screen looks like or how it moves says `Mock: <shown and picked>` or
`Mock: skipped, <why it's too small to need one>`.

**Batch pushes.** Each push reruns CI, and Actions minutes are a fixed allowance. When several
review comments or failures land together, fix them all locally, run the loop, and push once. Push
and wait only when the next fix depends on seeing this one's CI result.

## Bugs, siblings, orphans and follow-ups

**A real bug found in passing, with a small, obvious fix (one function, no design call): fix it in
the same PR** and note it in the description. Anything that needs a design decision, touches several
files, or you're not sure is wrong: **stop and ask** (`AskUserQuestion` if the harness has it, a
plain question otherwise). "Say so" means ask, not a line in a PR description nobody rereads.

**When a fix applies to one component, look for its siblings yourself.** Grep the whole repo for
the exact thing you changed (the regex, the literal, the element, the copy-pasted block), `server/`
included, since a rule the app checks is often checked again in Python, and say in the PR what
else the grep found. A sibling includes the same value written out in another file; where you find
one, prefer making both use one definition. "Nobody reported that one" is not a reason to skip it. The same mechanical change applied
again goes in the same PR; a sibling that needs its own design call gets a question.

**Remove what your own change orphaned** (a prop, a style, a helper, an export, a comment
describing behavior you took out) in the same PR, after grepping every caller, tests included.
Code that was already dead before you arrived is a different case: ask before removing it.

**Never file a GitHub issue without asking first**, unless the user directly asked for one. For
every piece of adjacent work you decided not to do, ask with three options: fix it now, file an
issue, or leave it. A "What's left" section in a PR body is not a decision; it's a decision
avoided, whatever its heading says (see "Write the PR body as a record of decisions").

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

**Before writing a new message, grep `src` for how the app already says it** and reuse that wording,
or the shared constant where there is one (`NOTE_GONE` and `NOT_IN_ANKI` in `src/core/failure.ts`,
`NO_COLLECTION` in `src/anki/noteService.ts`).

**An error says what happened, then what to do.** "Couldn't import deck.apkg. It was exported with
"Support older Anki versions" turned on. Export it again..." rather than "failed: <exception>". Buttons name the action.
Screens build it with `failureText` (`src/core/failure.ts`): an error written for a person extends
`Refusal` and is shown as it is; any other error's text goes last, in parentheses.
`tests/noRawErrors.test.ts` fails the build on a screen showing an error's text another way.

**"e.g." and not "for example"** in anything a user sees, placeholders included (the owner's choice, 19 November 2026). **American English** in anything a user sees. **No em dashes** in UI text, alerts, commit messages,
PR descriptions or issue bodies: use a period, colon, comma or parentheses. Code comments are
exempt from both.

**Never offer an input a code path can drop without saying so.** A file the importer can't read is
refused with the reason; warnings past the display limit are counted ("and 12 more warnings"), not
cut off silently. A field that's shown gets honored, refused inline with the reason, or not shown.

## Finding your way around

```
src/core     types, FSRS wrapper, queue, deck tree, study day, card rendering, Anki templates,
             session bookkeeping (undo), stats, config, kana input and romaji (pure TS)
src/import   TSV + Anki JSON importers, re-import matching (reconcile.ts)
src/db       Repo interface + MemoryRepo (tests), SQLite repo (app), backup planning
src/media    the media folder (expo-file-system)
src/app      routes (Expo Router): thin wrappers that give a screen in src/ui its props
src/ui       screens, the shared pieces they're built from (kit.tsx), the theme, CardWebView, AppContext;
             Read & Listen's screens are in src/ui/reader/
src/reader   Read & Listen's side of the app: its server's API, the reading session, playback (pure,
             tested; storage.ts keeps the passphrase in the Keychain)
src/wanikani WaniKani as a deck: its API, the study session (undo holds the latest answer), answer
             checking, production notes (pure, tested; storage.ts keeps the token in the Keychain)
src/tools    the Practice tab's tools (similar words, which word fits, sentences, situations, time, dates, money, numbers, counting, script, grammar): the list (tools.ts), each tool's logic, and each
             language's under its own folder (thai/, spanish/...); pure, tested, except storage.ts and extrasStorage.ts. Daily extras (extras.ts) plan the Today tab's strip of drills and texts from the miss tallies; screens are DailyExtras.tsx and DailyExtrasSettings.tsx. A tool
             comes in every app language unless it doesn't apply, and never schedules or writes a card
             (tests/tools/noGrading.test.ts). Skill cards (skills.ts) are the one way practice reaches the collection: Add
             skill cards (Deck options) writes Basic notes through saveNote after a preview the learner approves
             (src/anki/skillCards.ts), or the MCP's hourly job writes them for a deck whose automatic switch the learner turned on (skillSettings.ts), and a drill card in Review is rated by the learner's tap, its suggested rating only outlined. It may check an answer, or take Missed it / Got it, and keep only a
             fading tally of missed patterns on the phone (marks.ts, patterns.ts) that leans the next random
             question toward them. Screens are src/ui/Practice.tsx and src/ui/tools/
src/anki     Anki collection packages: reading, writing answers back, packing (pure, tested);
             sync/ syncs with an Anki sync server (pure, tested; syncService.ts is the phone's side)
server/      a ready-to-run Anki sync server (Docker, Caddy); server/mcp is the MCP for Claude (Python);
             server/reader is Read & Listen's server (Python); server/speech is the Azure client both use
docs/read-and-listen/   Read & Listen's spec (brief.md) and the decisions since (architecture.md)
docs/grammar.md        the grammar catalog Read & Listen and the app share, and its plan
tests/       vitest, mirroring src/ (src/core/queue.ts -> tests/core/queue.test.ts)
```

**Tests mirror source 1:1**, and only pure logic is tested (`src/core`, `src/import`, `src/db`'s
MemoryRepo and backup planning, `src/anki` except files.ts, `src/reader`, `src/tools` and `src/wanikani` except storage.ts). Vitest runs in `node` with no React renderer, so there are no
screen tests. Don't add a renderer to cover a UI change: verify by reasoning about the code and say
so plainly rather than implying you ran it. Keep logic out of screens so it can be tested: if a
screen grows a decision worth testing, move it into `src/core`.

**Fixtures are local times**: `new Date(2026, 10, 11, 12)` or `'2026-11-11T12:00'`, never a `...Z`
or `-05:00` literal that the code then reads back as a local date. `tests/support/fixtures.ts` holds the shared
ones.

## Rules that load by path

Most of the architecture rules live in `.claude/rules/`, one file per area. Each loads only when a
file its `paths:` frontmatter matches is read or edited, so a Thai drill doesn't pay for the sync
rules. A comment or doc that cites "CLAUDE.md" for one of these sections means the file named here.

| Rules file | Loads with | Holds (the CLAUDE.md sections it took) |
|---|---|---|
| `scheduling.md` | `src/core`, `src/db`, `src/wanikani`, Review and the deck screens | Scheduling: FSRS, steps, fuzz, limits, the v3 queue, burying, the progress gate, vacation, undo, misses |
| `import-and-cards.md` | `src/import`, templates and card rendering, `src/db` | Import, Card rendering |
| `screens.md` | `src/ui`, `src/app` | Screens and styling, mocking a UI change |
| `anki-collection.md` | `src/anki`, `src/db/anki*`, `modules/anki-unicase`, `tests/anki` | The Anki collection, Sync |
| `mcp.md` | `server/mcp`, `server/speech` | The MCP |
| `read-and-listen.md` | `server/reader`, `src/reader`, `src/ui/reader`, its routes | Read & Listen |
| `database.md` | `src/db`, the Backup screen | Backup, Database |

`tests/claudeRules.test.ts` keeps this working: it fails when this file passes 25,000 characters or
a rules file passes 38,000 (past about 40,000 a session sees only the start of one), or when a
rules file's `paths:` glob matches nothing. A new rule about one area goes in its rules file, or a
new one with its own `paths:`; this file is for rules that cut across the app.

A few of those rules apply far from their own folder, so they're repeated here:

- **Nothing feeds FSRS but the answer button pressed.** Practice, typed or spoken answers, miss
  reasons, and everything Read & Listen and the tools do are never ratings
  (`tests/reader/noGrading.test.ts`, `tests/tools/noGrading.test.ts`).
- **A check that predicts what another code path will do calls that code path's function**; don't
  write a lookalike. The deck list and the review screen both count through `treeQueue`.
- **Mock up a proposed UI change as an Artifact before building it** (`screens.md` says how),
  motion, gestures and native controls included, and say in the PR that you did.
- **A merge to `main` that touches `server/` deploys itself** (`server/update.sh`, on a timer, within
  about 15 minutes) and restarts sync, the MCP and Read & Listen. A server change must work with nothing done by
  hand on the server; if one truly needs a step there (a new `.env` setting), the PR says so plainly.

## Architecture and the rules that come with it

### Data flow

SQLite (expo-sqlite, WAL) -> `src/db/sqliteRepo.ts` (implements `Repo`) -> screens. **Write to
SQLite first, then update React state**, so a crash between the two loses the screen's copy, not
the user's work. Review's answers are the one exception, so the next card shows without waiting:
the answer is worked out in memory, shown, and written behind it through `reviewWrites`
(`src/core/writeQueue.ts`), one at a time in the order given, and a failed write takes the answer
back off the screen. Anything that reads or undoes what an answer wrote awaits
`reviewWrites.idle()` first. `MemoryRepo` is the reference implementation and must behave like the SQLite one
(re-import rules included), since every repo test runs against it.

**Audio plays with the silent switch on** (`setAudioModeAsync({ playsInSilentMode: true })` in
`src/ui/AppContext.tsx`): iOS otherwise mutes an app's recordings, TTS and WebView audio alike, which made every
play button look broken. `expo-audio`'s config plugin asks for the microphone only for Record
yourself (`useSelfRecording`) and an audio lesson's turns (`useLessonTurns`): a take of your own
voice to play next to a card's, a line's or a lesson's recording, kept in the caches folder until
you move on and never saved or synced, and never sent anywhere (a scoring feature was tried and
removed; `architecture.md`, Speaking). The session allows recording only while a take is made,
since iOS's play-and-record category puts Bluetooth headphones into call quality; the one exception
is a lesson with a microphone setting on, which keeps it for the whole lesson because iOS won't
start a recording in the background, and Settings, Lessons says so. The plugin also allows background audio, which only Read & Listen's
reader turns on, while it's open (`shouldPlayInBackground`), so listening goes on with the screen locked.

**Everything stays on the device, except sync, Read & Listen, WaniKani and font downloads.** TTS is `expo-speech` (on-device
voices, chosen per language in Settings, Voices) and storage is local SQLite. The network calls are
sync with the user's own Anki sync server (`src/anki/sync/`), off until they sign in, and Read &
Listen, which talks to its server beside the sync server and is off until its passphrase is entered
(Settings, Read & Listen). **Answer by speaking** (Settings, Speaking; `src/core/speaking.ts`, `useSpokenAnswer`) is off
until turned on: iOS's recognizer runs with on-device required, which iOS keeps on the phone where
it can for a language and otherwise sends to Apple. The app asks iOS which, per language
(`modules/speech-on-device`): Settings, Speaking says so, and a language heard only by Apple has no
microphone while offline. WaniKani talks to api.wanikani.com only once its token is entered
(Settings, WaniKani); its answers go to WaniKani, which schedules them, and only its production
notes enter the collection. It keeps an offline copy of what's up (`offline.ts`: reviews, lessons, subjects, synonyms, and
recordings as files), made each time WaniKani is reached, so a session can be studied with no connection: its answers go to the
outbox and are sent later, and the copy leaves out items answered since it was made. Recording a card with an Azure voice (`src/core/recording.ts`) goes
through Read & Listen's server, so it's off while Read & Listen is. The three Japanese fonts
(Settings, Font) are too large to bundle: each is downloaded from jsDelivr, version-pinned, only when its row is
tapped, and kept in the documents folder (`src/core/fontDownloads.ts`). A
future feature that needs the network (a dictionary lookup, an AI hint) ships behind its own setting
that defaults to off.

**Every request goes through the connection guard** (`guardedFetch`, `src/core/connection.ts`;
`tests/noBareFetch.test.ts`), so on a subway platform it gives up in seconds instead of iOS's
minute, and every screen learns the servers are out of reach (the header's Offline button). Work
for a server is held on the phone while it can't be reached and sent when it can
(`src/core/held.ts`, `HeldWork`), never dropped or shown as an error. When a server doesn't answer,
one request to Apple's connection-check page tells offline from that server being down.

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

### After an `await`

**Check the result still belongs where it's about to be written, and that the action can't run
twice.** A tap can land again while a write is in flight: `Review`'s `answer` holds a `busy` ref
and checks `lastAnswered` so a double tap logs one review, not two from the same old state, and updates state with a
functional `setCards(prev => ...)` because the render's own `cards` is stale once the awaits
return. A screen can also be left mid-await; capture what the request was about before the await
and compare after.

**A queue sent across an `await` is put back together by a pure function given the queue as it is
now**, never by position or by which objects it held: it can gain, lose or replace items while the
send runs (`afterSend`, `afterWordsSent`, `afterSynonymFlush`).

## Working style

**Recommend the best option.** When there's a choice between several ways to do something,
recommend the best one, even if another option would be simpler. Don't steer toward the simpler
one just because it's less work. The exception is a choice with a real tradeoff, such as a
security or privacy risk, data going to a third party, a cost, or something the owner has to keep
running. In that case, name the tradeoff next to the recommendation so the owner can weigh it.

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
it blindly or quietly ignoring it. When the owner agrees to a change that goes against a rule here
or in `.claude/rules/`, rewrite or delete the rule in the same PR, so the guidance says what the
code does.
