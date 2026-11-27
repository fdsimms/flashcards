"""
Read & Listen's figures, from its server beside this one (server/reader). The MCP asks that
server's API with the same passphrase the app uses, so it never opens Read & Listen's database
itself. Read & Listen is optional: without it the tool says how to turn it on.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


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
        if r.status_code == 404 and path.startswith("/api/audit/texts/"):
            raise ToolError("No such text. list_read_and_listen_texts has the ids.")
        if r.status_code == 404 and path.startswith("/api/journal/"):
            raise ToolError("No such journal entry (it may have been deleted). list_journal_entries has the ids.")
        if r.status_code == 404:
            raise ToolError("Read & Listen's server is older than this tool. It updates itself within about 15 minutes of a merge.")
        if r.status_code == 422:
            raise ToolError(f"Read & Listen refused the request: {r.text[:300]}")
        if r.status_code != 200:
            raise ToolError(f"Read & Listen answered {r.status_code}: {r.text[:200]}")
        return r.json()


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
        language: str | None = None, story_id: int | None = None, days: int | None = None, limit: int = 50
    ) -> dict[str, Any]:
        """Read & Listen's past texts (dialogues and story episodes) that were shown, newest first,
        for review, as `texts`. `language` is a code ("th", "de", "pl"...), `story_id` lists one story's
        episodes first to last, `days` keeps those written in the last that many days, `limit`
        is 1 to 200. Each has `id`, `title`, `topic`, `form`, `coverage` (the share of its words
        known when it was written), `reads` and `last_rating`. Read one with
        get_read_and_listen_text."""
        if not 1 <= limit <= 200:
            raise ToolError("limit must be between 1 and 200.")
        if days is not None and not 1 <= days <= 3650:
            raise ToolError("days must be between 1 and 3650.")
        params = {k: v for k, v in {"language": language, "story": story_id, "days": days, "limit": limit}.items() if v is not None}
        return {"texts": await get("/api/audit/texts", params)}

    @server.tool(annotations=READ)
    async def get_read_and_listen_text(text_id: int) -> dict[str, Any]:
        """One past Read & Listen text in full, for auditing its quality: each line in the target
        language with its English, speaker and register, who the model named for each quotation in a
        story episode (`quotes`, in order), and the words in it the deck doesn't
        cover as of now (`unknown`, `partial`: the deck may have changed since it was written);
        its practice words and grammar targets, the glosses the model wrote, the comprehension
        questions with the right answer's index, a story's premise, cast, plan, the voices its characters were given, episode recap and
        choices, the model that wrote it, and every reading (rating, words the reader flagged,
        time). Read-only: nothing here changes a text or the deck."""
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
