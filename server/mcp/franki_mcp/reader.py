"""
Read & Listen's figures, and what Claude wrote there for review (texts, audio lessons, grammar
pages, practice items, the journal), from its server beside this one (server/reader). The MCP asks
that server's API with the same passphrase the app uses, so it never opens Read & Listen's
database itself. Read & Listen is optional: without it the tool says how to turn it on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


# What a 404 from a route that reads one thing by id means, by the route's path.
MISSING = {
    "/api/audit/texts/": "No such text. list_read_and_listen_texts has the ids.",
    "/api/journal/": "No such journal entry (it may have been deleted). list_journal_entries has the ids.",
    "/api/audit/lessons/": "No such lesson. list_audio_lessons has the ids.",
    "/api/audit/grammar/": "No such grammar page (a point has one only once its lesson was opened). "
    "list_grammar_pages has the kinds and ids.",
}


def _route_missing(r: httpx.Response) -> bool:
    """A 404 for a path the server has no route for (FastAPI's own "Not Found"), as from a server
    older than this tool, rather than one of its routes saying the thing asked for isn't there."""
    try:
        return r.json().get("detail") == "Not Found"
    except ValueError:
        return False


@dataclass(frozen=True)
class ReaderSettings:
    url: str  # e.g. http://reader:8080, inside the compose network
    passphrase: str


class ReaderClient:
    """Calls Read & Listen's API with the passphrase, saying plainly the errors a caller can fix."""

    def __init__(self, settings: ReaderSettings | None, http: httpx.AsyncClient | None = None):
        self.settings = settings
        self.http = http or httpx.AsyncClient(timeout=30)

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return await self.send("GET", path, params=params)

    async def post(self, path: str, body: dict[str, Any]) -> Any:
        return await self.send("POST", path, json=body)

    async def send(self, method: str, path: str, **kwargs: Any) -> Any:
        settings = self.settings
        if settings is None:
            raise ToolError(
                "Read & Listen isn't connected to the MCP. It needs READER_PASSPHRASE in server/.env "
                "(the passphrase the app uses) and reader in COMPOSE_PROFILES, then a restart."
            )
        try:
            r = await self.http.request(
                method,
                f"{settings.url.rstrip('/')}{path}",
                headers={"Authorization": f"Bearer {settings.passphrase}"},
                **kwargs,
            )
        except httpx.HTTPError as e:
            raise ToolError(
                f"Couldn't reach Read & Listen at {settings.url} ({e.__class__.__name__}). It runs only "
                "when COMPOSE_PROFILES in server/.env has reader; check `docker compose ps reader`."
            ) from e
        if r.status_code == 401:
            raise ToolError("Read & Listen refused the passphrase. READER_PASSPHRASE in server/.env must be the one it runs with.")
        if r.status_code == 404 and not _route_missing(r):
            for prefix, missing in MISSING.items():
                if path.startswith(prefix):
                    raise ToolError(missing)
        if r.status_code == 404:
            raise ToolError("Read & Listen's server is older than this tool. It updates itself within about 15 minutes of a merge.")
        if r.status_code == 422:
            raise ToolError(f"Read & Listen refused the request: {r.text[:300]}")
        if r.status_code != 200:
            raise ToolError(f"Read & Listen answered {r.status_code}: {r.text[:200]}")
        return r.json()


def _given(params: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in params.items() if v is not None}


def _check_window(days: int | None, limit: int) -> None:
    if not 1 <= limit <= 200:
        raise ToolError("limit must be between 1 and 200.")
    if days is not None and not 1 <= days <= 3650:
        raise ToolError("days must be between 1 and 3650.")


def register(server: MCPServer, client: ReaderClient) -> None:
    """Adds Read & Listen's tools."""
    get = client.get

    @server.tool(annotations=READ)
    async def read_and_listen_costs(days: int = 30) -> dict[str, Any]:
        """What Read & Listen's texts cost over the last `days` days (1 to 3650), per language and
        in total: texts written, how many were read, are still waiting, were dropped (they
        missed the known-words floor and were never shown, but were paid for) or skipped (taken
        off the shelf unread), attempts per text, and dollars. `cost_usd`, `per_text_usd` and
        `per_read_text_usd` are Claude's alone (per text read is everything spent divided by the
        texts actually read). `audio_chars`, `azure_usd`, `total_usd`, `total_per_text_usd` and
        `total_per_read_text_usd` add Azure's audio, which is an estimate: the characters Azure
        spoke for each text at a fixed list price per character, not Azure's bill. Audio made
        before characters were counted is estimated from the lines still stored, so those texts
        can read low. Also `explanations`, `drills`, `meanings`, `ipa` (IPA Claude wrote for words Wiktionary has none for),
        `vocab_checks`, `note_queue`, `mnemonics`, `questions` (the check after reading) and `forms` (the grammatical form of a
        text's inflected words): what those Claude calls cost, apart
        from the texts, and `other_calls`, every other Claude call (looking a word up, rare words,
        asking about or fixing a card...), as one total and by feature. Every figure includes calls
        that failed after Claude answered, which were still paid for. `recordings` is the cards the
        app recorded with an Azure voice, as characters and the same estimate, in total only. Voice
        previews and recordings the MCP makes into notes are not in any of it."""
        if not 1 <= days <= 3650:
            raise ToolError("days must be between 1 and 3650.")
        return await get("/api/costs", {"days": days})


    @server.tool(annotations=READ)
    async def list_read_and_listen_texts(
        language: str | None = None,
        story_id: int | None = None,
        days: int | None = None,
        limit: int = 50,
        status: Literal["shown", "skipped", "dropped", "all"] = "shown",
    ) -> dict[str, Any]:
        """Read & Listen's past texts (dialogues and story episodes), newest first, for review, as
        `texts`. `status` picks which: "shown" (the default: put on the shelf, read or still
        waiting), "skipped" (taken off the shelf unread, Not this), "dropped" (drafts that missed
        the known-words floor and were never shown, but were paid for; one with no lines got no
        usable answer at all) or "all". `language` is a code ("th", "de", "pl"...), `story_id`
        lists one story's episodes first to last, `days` keeps those written in the last that
        many days, `limit` is 1 to 200. Each has `id`, `title`, `topic`, `form`, `status`,
        `coverage` (the share of its words known when it was written) against `floor` (the share
        it had to reach), `reads` and `last_rating`. Read one with get_read_and_listen_text."""
        _check_window(days, limit)
        params = {"language": language, "story": story_id, "days": days, "limit": limit, "status": status}
        return {"texts": await get("/api/audit/texts", _given(params))}

    @server.tool(annotations=READ)
    async def get_read_and_listen_text(text_id: int) -> dict[str, Any]:
        """One past Read & Listen text in full, for auditing its quality: each line in the target
        language with its English, speaker and register, who the model named for each quotation in a
        story episode (`quotes`, in order), and the words in it the deck doesn't
        cover as of now (`unknown`, `partial`: the deck may have changed since it was written);
        its practice words and grammar targets, the glosses the model wrote, the comprehension
        questions with the right answer's index, a story's premise, cast, plan, the voices its characters were given, episode recap and
        choices, the model that wrote it, and every reading (rating, words the reader flagged,
        time). `asked` is everything Claude answered when the owner asked about a line, by line
        (`line`, the index in `lines`) and `kind`: "explain" (Explain, with `version` and
        `points`), "natural" (Does this sound natural?, `answer`), "phrase" (a selected phrase's
        explanation, `phrase`, `answer`), "phrase_chat" (the questions asked about a phrase and
        the answers, `turns`, kept only for a couple of hours) and "form" (why a word has its form,
        `word`, `answer`). Works for skipped texts and dropped drafts too. Read-only: nothing here
        changes a text or the deck."""
        return await get(f"/api/audit/texts/{text_id}")

    @server.tool(annotations=READ)
    async def list_journal_entries(language: str, days: int = 60) -> dict[str, Any]:
        """The owner's writing journal in one language ("pl", "th"...): free writing in the
        language that Claude checked sentence by sentence (the app's Practice tab, Journal).
        `entries`, newest first, each with `id`, `text` as last written, `prompt` (the idea it was
        written about, often empty), `created_at`, `sentences` and `fixed` (how many needed a fix).
        `kinds`: the kinds of mistake the entries' first checks found in the last `days` days (0
        for all time), most frequent first, each with `name`, `count`, the grammar point's id when
        it is one (`point`), and its latest example (`was`, `now`, and the sentence as `written`
        and `corrected`). Use it for "what do I keep getting wrong"; read an entry in full with
        get_journal_entry. Read-only."""
        if not 0 <= days <= 3650:
            raise ToolError("days must be between 0 (all time) and 3650.")
        home = await get("/api/journal", {"language": language, "days": days})
        return {"entries": home["entries"], "kinds": home["kinds"]}

    @server.tool(annotations=READ)
    async def get_journal_entry(entry_id: int) -> dict[str, Any]:
        """One journal entry in full, as last checked: each sentence as written and corrected,
        its English, its verdict, and each mistake's words (`was`, `now`), kind (`kind`, `name`;
        a case ending also has `case` and `governor`, the word deciding the case), reason
        (`note`) and hint; `filled`, the words the owner wrote in English in [brackets] and
        Claude put in; `tries`, how many times it was checked. A suggestion to add a word to the
        deck still goes through add_notes, and only with the user's agreement. Read-only."""
        return await get(f"/api/journal/{entry_id}")

    @server.tool(annotations=READ)
    async def list_audio_lessons(language: str | None = None, days: int | None = None, limit: int = 50) -> dict[str, Any]:
        """Read & Listen's audio lessons (Practice, Lessons: a dialogue and a few phrases Claude
        wrote, taught by a narrator and recorded), newest first, for review, as `lessons`, of every
        state: "making", "ready" or "failed" (with the reason in `error`). `language` is a code,
        `days` keeps those made in the last that many days, `limit` is 1 to 200. Each has `id`,
        `title`, `scene` (what was asked for), `duration_ms`, `heard_at` (last played to the end,
        or null) and `marks`, how many phrases the owner marked Again or Slow while listening, the
        nearest thing a lesson has to a rating. Read one with get_audio_lesson."""
        _check_window(days, limit)
        params = {"language": language, "days": days, "limit": limit}
        return {"lessons": await get("/api/audit/lessons", _given(params))}

    @server.tool(annotations=READ)
    async def get_audio_lesson(lesson_id: int) -> dict[str, Any]:
        """One audio lesson in full, for auditing what Claude wrote: `phrases` taught and the
        `dialogue` (each with its English), `script` (everything said, narrator and native voice,
        and each of the learner's turns, with times in milliseconds; null for a lesson made before
        scripts were kept), and `marks`, the phrases the owner marked while listening with the
        `reason` ("again": didn't know it, "slow": too fast) and whether a review lesson has used
        it. The audio itself isn't here. Read-only."""
        return await get(f"/api/audit/lessons/{lesson_id}")

    @server.tool(annotations=READ)
    async def list_grammar_pages(language: str | None = None) -> dict[str, Any]:
        """Every grammar page Claude wrote in Read & Listen, newest first, as `pages`: the owner's
        own topics (`kind` "topic", Grammar, Your topics: a page on a point they named) and the
        built-in points' lessons (`kind` "point", written the first time a point's lesson is
        opened). Each has `kind`, `id` (a number for a topic, the point's id for a point),
        `language`, `title`, `status` ("writing", "ready" or "failed"), `note` (what the app says
        about a write that failed) and `examples` (how many lines). Read one with
        get_grammar_page."""
        return {"pages": await get("/api/audit/grammar", _given({"language": language}))}

    @server.tool(annotations=READ)
    async def get_grammar_page(kind: Literal["topic", "point"], page_id: str) -> dict[str, Any]:
        """One grammar page in full, with `kind` and `id` as list_grammar_pages gives them. A
        topic has Claude's `lead`, `explanation` (Markdown) and `examples`; a point has its
        `examples` with the catalog's own description beside them (`point_note`,
        `point_example`: written by hand, not by Claude). Each example is {line, english, words},
        `words` being the point's words in the line. Read-only: unlike opening the page in the
        app, this never starts a write."""
        return await get(f"/api/audit/grammar/{kind}/{page_id}")

    @server.tool(annotations=READ)
    async def list_practice_items(
        kind: Literal["drill", "sentence", "vocab", "meaning", "sentence_meaning"],
        language: str | None = None,
        point: str | None = None,
        word: str | None = None,
        days: int | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """A sample of the practice items Claude wrote for Read & Listen, newest first, to check
        their quality. These are caches, often thousands of rows: narrow with `language`, `point`
        or `word` and read a sample rather than all of them. `kind`:
        - "drill": grammar drills' fill-the-gap questions, each `line` with ___ for the gap, the
          `answer`, `wrong` choices, `english` and `hint`; filter by `point` (a grammar point's id,
          from list_grammar_pages or a text's `grammar`).
        - "sentence": sentences to say, one deck word each (`word`, its `note_id`).
        - "vocab": the vocabulary check's words, with `meaning`, `wrong` choices and frequency `rank`.
        - "meaning": glosses for words with none in the deck (an empty one is a word Claude gave
          nothing usable for).
        - "sentence_meaning": each word's meaning in a card's example sentence (not dated, so
          `days` doesn't apply).
        `served_at` (drill, sentence) is when the owner was last shown it, null for never.
        `batches` is how the calls in the same window went: `calls`, items `asked` for, items
        `kept` (passed the checks in code) and `cost_usd`; null for "sentence_meaning".
        `days` keeps items written in the last that many days, `limit` is 1 to 200. Read-only."""
        _check_window(days, limit)
        params = {"kind": kind, "language": language, "point": point, "word": word, "days": days, "limit": limit}
        return await get("/api/audit/practice", _given(params))
