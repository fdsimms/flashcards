---
paths:
  - "server/mcp/**"
  - "server/speech/**"
---

# The MCP

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## The MCP (`server/mcp/`)

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
- **Read & Listen's figures come from its server's API, never its database**
  (`franki_mcp/reader.py`: `read_and_listen_costs` asks `/api/costs` with `READER_PASSPHRASE`).
- **Azure is called through one client shared with Read & Listen** (`server/speech`, the
  `franki_speech` package), so a fix to how Azure is called reaches both. Both images are built from
  `server/` to copy it (`server/.dockerignore` keeps `.env` out of the build). Azure's request
  shapes are unverified against a live key (its docstring says which parts were checked).
- **Omnilanguage's house style is one module** (`omnilanguage.py`): the rules `add_notes` and
  `update_notes` hold a note to (tidied where a fix needs no judgment, refused with what to change
  otherwise), the ones `lint_notes` reports and fixes, and the prose `note_guide` returns. A rule
  goes there once. One written only into a tool description is checked by nobody, which is how ten
  languages came to write a Meaning four ways. An update is checked only for the fields it writes,
  so an old note can be corrected a field at a time. `tests/test_omnilanguage.py` holds every
  example the guide shows to its own rules.
- **Skill cards come from the app's own definitions** (`skills.py`): the notes it adds are read from
  `skill_catalog.json`, which `src/tools/skillCatalog.ts` writes (`npm run catalog:skills`), and
  `tests/tools/skillCatalog.test.ts` fails when the file is stale, so the server has no second copy of
  a card's text. A deck's settings are one config value shared with the app (`frankiSkillCards`,
  `src/anki/skillSettings.ts`); the hourly job only adds where `on` and `auto` are both set.
- **A new Omnilanguage note is recorded when `add_notes` adds it**, as the app records one saved on the
  phone, with the voice `set_audio_voice` saved for its Language (`frankiAudioVoices`, a collection
  config value). The phone's own Settings > Voices choice is stored on the phone, so the MCP keeps a
  copy and the two can differ. A failed recording never fails the add: it's the result's `audio_error`.
- **`INSTRUCTIONS` stays short** (a client may cut long server instructions off mid-sentence, and
  did): what applies to every tool goes there, and a tool's own rules go in its description.
- Keep `anki` in `requirements.txt` at the version the sync server runs (`ANKI_VERSION`;
  `tests/test_anki_version.py` checks).
- **A merge to `main` that touches `server/` deploys itself**: the rule is in `CLAUDE.md`, since it
  holds for every server.
