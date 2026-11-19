---
paths:
  - "server/reader/**"
  - "src/reader/**"
  - "src/ui/reader/**"
  - "src/ui/useReader.ts"
  - "src/app/read*.tsx"
  - "docs/read-and-listen/**"
  - "tests/reader/**"
---

# Read & Listen

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## Read & Listen (`server/reader/`, `src/reader/`)

Texts (dialogues, short stories) written by Claude from the words already in the language decks
(Thai, Spanish, German, French, Russian, Greek, Polish, Norwegian, Japanese, English), checked in code to be 95-98% known words, recorded with Azure's voices, read in the app with
a gloss on every word. **`docs/read-and-listen/brief.md` is the spec, with the evidence behind each
rule; `architecture.md` beside it has every decision since.** Where they and this file disagree,
they win and this is stale. The rules that must not break:

- **Never grade FSRS from exposure, and never create Anki cards or reviews without an explicit
  approval step.** The server only reads the collection (`collection.py`; `test_collection.py`
  checks a read leaves nothing to send), and the app's side imports nothing that schedules or
  writes cards (`tests/reader/noGrading.test.ts` fails the build on it). Adding a marked word or a
  selected phrase to the deck goes through the note editor, opened by the `read-words` and `reader`
  routes (and the vocabulary check), where saving is the approval. The saves outside it each follow
  an alert: linking a verb's aspect partner already in the deck, after "Link them" in an alert naming
  both (`useAddMinedWord`), and the note queue's "Approve all", after "Add N notes" in an alert naming
  how many (`useApproveQueued`), which saves the ready notes as written. Both are listed in the
  test's `EXEMPT`. There is no daily cap on additions.
- **Generate, then verify in code.** The model writes lines as `|`-split strings with stretch words
  in `*asterisks*`; the server re-segments every line itself (lexicon-first for Thai, by lemma for
  the rest, `spaced.py`) and sends drafts under the floor back with the unknown words named. Never trust the
  model to stay in vocabulary. Japanese is split by SudachiPy (`japanese.py`).
- **A word counts as known only when its note is studied** (young or mature); a word found only
  inside a studied phrase is partial and counts as unknown. Every language but Thai also counts as
  many of its most common word families as its `common` setting says, and Japanese also counts
  WaniKani vocabulary at Guru or above (`wanikani.py`, read with the server's `WANIKANI_TOKEN`).
- **Batch and cache.** Texts are written in the background and queued, never inside a request, and
  never one API call per word or page view.
- **The owner asks for each text.** The shelf (`architecture.md`, Shelf) holds only texts asked for
  (a typed topic, Surprise me) and each running story's next episode, once its last is read; nothing is written ahead. Already rejected, don't
  revisit: cloze cards, saving generated sentences as Anki cards, rescheduling Thai cards.
- **It reads Anki as a sync client of the sync server beside it**, through Anki's own `anki`
  package like the MCP, every read under `with_timeout` (45 seconds) so a server that stops
  answering leaves it on the last snapshot. Keep `anki` in `server/reader/pyproject.toml` at the
  sync server's `ANKI_VERSION` (`tests/test_anki_version.py` checks).
- It runs as the `reader` service in `server/docker-compose.yml`, under `/reader` on the sync
  server's domain, with its own passphrase. Its keys (Claude, Azure) stay on the server, never in
  the app.
- **In the app, the server holds Read & Listen's data** (topics, texts, the reading log, marked
  words, grammar choices, each language's deck); the screens fetch and show it, and keep nothing but
  the passphrase, the reader's own settings (`src/reader/prefs.ts`, which include whether the deck
  list's counts are shared for dundundun, off by default) and today's count of words added to the
  deck (`src/reader/storage.ts`). For offline use the phone also keeps copies, each replaced when
  the server is read again: the server's settings (`saveSettingsCopy`), card glosses
  (`useCardGlosses`), the shelf's texts with their audio and the lessons downloaded
  (`src/reader/downloads.ts`), and what's done offline until it's sent: words for the note queue
  (`src/reader/heldNotes.ts`), and readings and story choices (`heldReader`). Screens reach the
  server through `withOffline` (`src/reader/offlineApi.ts`), which answers from those copies. The address is the sync server's plus
  `/reader` (`readerAddress`), so it's on only while sync is.
