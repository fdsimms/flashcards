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
- Keep `anki` in `requirements.txt` at the version the sync server runs (`ANKI_VERSION`;
  `tests/test_anki_version.py` checks).
- **A merge to `main` that touches `server/` deploys itself**: the rule is in `CLAUDE.md`, since it
  holds for every server.
