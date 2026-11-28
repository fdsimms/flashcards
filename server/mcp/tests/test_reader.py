"""Read & Listen's tools against a scripted Read & Listen server: no Anki needed."""

from __future__ import annotations

import httpx
import pytest
from mcp import Client
from mcp.server.mcpserver import MCPServer

from conftest import call, call_error
from franki_mcp import reader
from franki_mcp.reader import ReaderClient, ReaderSettings

pytestmark = pytest.mark.anyio

COSTS = {"days": 7, "since": "2026-11-05T09:00:00", "languages": [], "total": {"texts": 0}}


def server(handler, settings: ReaderSettings | None = ReaderSettings("http://reader:8080", "open sesame")) -> MCPServer:
    s = MCPServer("test")
    reader.register(s, ReaderClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    return s


async def test_asks_read_and_listen_with_its_passphrase():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=COSTS)

    async with Client(server(handler)) as c:
        assert await call(c, "read_and_listen_costs", days=7) == COSTS
    [request] = seen
    assert str(request.url) == "http://reader:8080/api/costs?days=7"
    assert request.headers["Authorization"] == "Bearer open sesame"


async def test_says_what_to_fix_when_it_cant_ask():
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no such host", request=request)

    async with Client(server(down)) as c:
        assert "COMPOSE_PROFILES" in await call_error(c, "read_and_listen_costs")
    async with Client(server(lambda r: httpx.Response(401))) as c:
        assert "refused the passphrase" in await call_error(c, "read_and_listen_costs")
    async with Client(server(lambda r: httpx.Response(404))) as c:
        assert "older than this tool" in await call_error(c, "read_and_listen_costs")
    async with Client(server(lambda r: httpx.Response(200, json=COSTS), settings=None)) as c:
        assert "READER_PASSPHRASE" in await call_error(c, "read_and_listen_costs")
    async with Client(server(lambda r: httpx.Response(200, json=COSTS))) as c:
        assert "between 1 and 3650" in await call_error(c, "read_and_listen_costs", days=0)


async def test_lists_and_reads_past_texts_through_the_audit_endpoints():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/audit/texts/7":
            return httpx.Response(200, json={"id": 7, "lines": []})
        if request.url.path == "/api/audit/texts/8":
            return httpx.Response(404)
        return httpx.Response(200, json=[{"id": 7}])

    async with Client(server(handler)) as c:
        assert await call(c, "list_read_and_listen_texts", language="de", days=7) == {"texts": [{"id": 7}]}
        assert await call(c, "get_read_and_listen_text", text_id=7) == {"id": 7, "lines": []}
        assert "No such text" in await call_error(c, "get_read_and_listen_text", text_id=8)
        assert "between 1 and 200" in await call_error(c, "list_read_and_listen_texts", limit=0)
    assert str(seen[0].url) == "http://reader:8080/api/audit/texts?language=de&days=7&limit=50&status=shown"
    assert seen[0].headers["Authorization"] == "Bearer open sesame"


async def test_reads_the_journal_and_one_entry():
    seen: list[httpx.Request] = []
    home = {"entries": [{"id": 3}], "kinds": [{"group": "pl.past", "count": 2}], "idea": {"prompt": "x", "words": []}, "checks": True}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/journal/3":
            return httpx.Response(200, json={"id": 3, "check": {"sentences": []}})
        if request.url.path == "/api/journal/4":
            return httpx.Response(404)
        return httpx.Response(200, json=home)

    async with Client(server(handler)) as c:
        got = await call(c, "list_journal_entries", language="pl", days=0)
        assert got == {"entries": [{"id": 3}], "kinds": [{"group": "pl.past", "count": 2}]}
        assert await call(c, "get_journal_entry", entry_id=3) == {"id": 3, "check": {"sentences": []}}
        assert "list_journal_entries" in await call_error(c, "get_journal_entry", entry_id=4)
        assert "between 0" in await call_error(c, "list_journal_entries", language="pl", days=-1)
    assert str(seen[0].url) == "http://reader:8080/api/journal?language=pl&days=0"
    assert seen[0].headers["Authorization"] == "Bearer open sesame"


async def test_lists_dropped_drafts_when_asked():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    async with Client(server(handler)) as c:
        assert await call(c, "list_read_and_listen_texts", status="dropped") == {"texts": []}
        assert "status" in await call_error(c, "list_read_and_listen_texts", status="lost")
    assert str(seen[0].url) == "http://reader:8080/api/audit/texts?limit=50&status=dropped"


async def test_reads_lessons_grammar_pages_and_practice_items_through_the_audit_endpoints():
    seen: list[httpx.Request] = []
    routes = {
        "/api/audit/lessons": [{"id": 4}],
        "/api/audit/lessons/4": {"id": 4, "script": []},
        "/api/audit/grammar": [{"kind": "point", "id": "th.ever"}],
        "/api/audit/grammar/point/th.ever": {"kind": "point", "examples": []},
        "/api/audit/practice": {"items": [], "batches": None},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path in routes:
            return httpx.Response(200, json=routes[request.url.path])
        return httpx.Response(404, json={"detail": "No such thing."})

    async with Client(server(handler)) as c:
        assert await call(c, "list_audio_lessons", language="th") == {"lessons": [{"id": 4}]}
        assert await call(c, "get_audio_lesson", lesson_id=4) == {"id": 4, "script": []}
        assert "list_audio_lessons" in await call_error(c, "get_audio_lesson", lesson_id=5)
        assert await call(c, "list_grammar_pages") == {"pages": [{"kind": "point", "id": "th.ever"}]}
        page = await call(c, "get_grammar_page", kind="point", page_id="th.ever")
        assert page == {"kind": "point", "examples": []}
        assert "list_grammar_pages" in await call_error(c, "get_grammar_page", kind="topic", page_id="9")
        got = await call(c, "list_practice_items", kind="sentence_meaning", word="ข้าว")
        assert got == {"items": [], "batches": None}
        assert "between 1 and 200" in await call_error(c, "list_practice_items", kind="drill", limit=500)
        assert "between 1 and 3650" in await call_error(c, "list_audio_lessons", days=0)
    urls = [str(r.url) for r in seen]
    assert urls[0] == "http://reader:8080/api/audit/lessons?language=th&limit=50"
    assert urls[-1] == "http://reader:8080/api/audit/practice?kind=sentence_meaning&word=%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7&limit=50"
    assert all(r.headers["Authorization"] == "Bearer open sesame" for r in seen)


async def test_a_route_the_server_lacks_says_the_server_is_older_not_that_the_item_is_gone():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "Not Found"})

    async with Client(server(handler)) as c:
        assert "older than this tool" in await call_error(c, "get_audio_lesson", lesson_id=4)
        assert "older than this tool" in await call_error(c, "get_read_and_listen_text", text_id=4)
