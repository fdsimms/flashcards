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
  addresses and loopback (any port, RFC 8252), a password page, rotating refresh tokens. Tokens,
  codes and client secrets are stored only as hashes (a secret checked by `HashedSecretAuthenticator`,
  which replaces the SDK's), so a copy of `signins.sqlite` signs nobody in.
- **Tests run against a real `anki.syncserver`** with Anki itself as the other device
  (`tests/conftest.py`), and Azure faked (`FakeAzure`): `cd server/mcp && python -m pytest`, after
  `pip install --require-hashes -r requirements.txt`, `pip install -r requirements-dev.txt` and
  `pip install --no-deps ../speech`. CI runs them in their own job.
- **Read & Listen's figures come from its server's API, never its database**
  (`franki_mcp/reader.py`: `read_and_listen_costs` asks `/api/costs` with `READER_PASSPHRASE`).
- **Azure is called through one client shared with Read & Listen** (`server/speech`, the
  `franki_speech` package), so a fix to how Azure is called reaches both. Both images are built from
  `server/` to copy it (`server/.dockerignore` keeps `.env` out of the build). Azure's request
  shapes are unverified against a live key (its docstring says which parts were checked).
  Both test environments install it as a copy, not a link, so after changing `server/speech`
  reinstall it before running either suite (`uv sync --reinstall-package franki-speech` in
  `server/reader`, `pip install --force-reinstall --no-deps ../speech` in the MCP's venv), or the
  tests run the old code and pass or fail for the wrong reason.
- **Omnilanguage's house style is one module** (`omnilanguage.py`): the rules `add_notes` and
  `update_notes` hold a note to (tidied where a fix needs no judgment, refused with what to change
  otherwise), the ones `lint_notes` reports and fixes, and the prose `note_guide` returns. A rule
  goes there once. One written only into a tool description is checked by nobody, which is how ten
  languages came to write a Meaning four ways. An update is checked only for the fields it writes,
  so an old note can be corrected a field at a time. `tests/test_omnilanguage.py` holds every
  example the guide shows to its own rules.
- **Thai romanization is defined once, in `server/speech/franki_speech/thai_romanization.py`**: the
  scheme the guide prints, the letters check, and the tone checks (marks against the Pronunciation's
  tone letters). Read & Listen's note queue puts the same scheme in its prompt and refuses a draft that
  breaks it, so a word added in the app can't be saved toneless. A rule about Thai romanization goes
  there, not into either server.
- **Skill cards come from the app's own definitions** (`skills.py`): the notes it adds are read from
  `skill_catalog.json`, which `src/tools/skillCatalog.ts` writes (`npm run catalog:skills`), and
  `tests/tools/skillCatalog.test.ts` fails when the file is stale, so the server has no second copy of
  a card's text. A deck's settings are one config value shared with the app (`frankiSkillCards`,
  `src/anki/skillSettings.ts`); the hourly job only adds where `on` and `auto` are both set.
- **A new Omnilanguage note is recorded when `add_notes` adds it**, as the app records one saved on the
  phone, with the Azure voice saved for its language (`frankiAudioVoices`, a collection config value from
  a language code to `{voice, rate}`). The app writes a language's entry when its Azure voice is chosen
  in Settings > Voices (`src/anki/audioVoices.ts`, the same key), because that choice is stored on the
  phone where the MCP can't read it; `set_audio_voice` writes it too. Each side changes only the
  language it was given. A failed recording never fails the add: it's the result's `audio_error`.
- **Content audits are judgment checks, remembered per item** (`audits.py`, one TOML file per audit
  in `audit_definitions/`): what's kept is which version of each check passed which content (a hash
  of what the checks read), not when a run happened, so an item added or changed since, or a check
  whose version went up, is due again and a run can stop after any batch. An audit reads notes (an
  Anki search) or Read & Listen's grammar pages or texts, through the same audit routes as
  `reader.py` (a page's `digest` there says when it was written again). The records live in
  `audits.sqlite` beside the collection, not in it. A note's finding is flagged the way Franki flags a
  card (`flag::` reasons from `agentFlag.ts`, which `test_audits.py` keeps in step), so its fix goes
  through `flagged_cards` and `resolve_flag` like any other; a page's or text's waits in
  `audit_findings`. A rule that needs no judgment belongs in `omnilanguage.py`, not in an audit.
- **`INSTRUCTIONS` stays short** (a client may cut long server instructions off mid-sentence, and
  did): what applies to every tool goes there, and a tool's own rules go in its description.
- **Its packages are pinned with hashes**: `requirements.in` names the direct ones, and
  `requirements.txt` is made from it with `pip-compile` (its header gives the command), every package
  pinned and hashed, which the image installs with `--require-hashes`. Dependabot proposes updates. Keep
  `anki` in `requirements.in` at the version the sync server runs (`ANKI_VERSION`;
  `tests/test_anki_version.py` checks both files).
- **A merge to `main` that touches `server/` deploys itself**: the rule is in `CLAUDE.md`, since it
  holds for every server.
