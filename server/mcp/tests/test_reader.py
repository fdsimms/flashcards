"""read_and_listen_costs against a scripted Read & Listen server: no Anki needed."""

from __future__ import annotations

import httpx
import pytest
from mcp import Client
from mcp.server.mcpserver import MCPServer

from conftest import call, call_error
from franki_mcp import reader
from franki_mcp.reader import ReaderSettings

pytestmark = pytest.mark.anyio

COSTS = {"days": 7, "since": "2026-11-05T09:00:00", "languages": [], "total": {"texts": 0}}


def server(handler, settings: ReaderSettings | None = ReaderSettings("http://reader:8080", "open sesame")) -> MCPServer:
    s = MCPServer("test")
    reader.register(s, settings, http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
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
