"""order_new_by_frequency: new cards reordered by Read & Listen's ranks, against a real Anki server and a scripted Read & Listen."""

from __future__ import annotations

import json

import httpx
import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import frequency
from franki_mcp.reader import ReaderClient, ReaderSettings
from mcp import Client
from mcp.server.mcpserver import MCPServer

pytestmark = pytest.mark.anyio

RANKS = {"la casa": 120, "esperar": 900, "czekać": 40}


def test_the_word_is_ranked_without_markup_or_a_bracketed_note():
    assert frequency.entry_word("<b>vengarse</b> (de)&nbsp;") == "vengarse"
    assert frequency.entry_word("internarse [en]") == "internarse"


def test_phrases_come_first_then_ranked_words_most_common_first_and_the_rest_keep_their_order():
    order = [(1, "rare", [10]), (2, "esperar", [20]), (3, "unknown", [30]), (4, "casa", [40, 41]), (5, "dar a luz", [50])]
    ranks = {"rare": None, "esperar": 900, "casa": 120, "dar a luz": None}
    assert [n[0] for n in frequency.placed(order, ranks, {"dar a luz"})] == [5, 4, 2, 1, 3]
    assert [n[0] for n in frequency.placed(order, ranks, set())] == [4, 2, 1, 3, 5]


def omni(desktop) -> list[int]:
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language",
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="esperar", Meaning="to wait", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="inventadear", Meaning="made up", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="la casa", Meaning="house", Language="spanish"),
        "+", "sync",
    )["notes"]


def positions(desktop, nids: list[int]) -> list[int]:
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        return [min(col.get_card(c).due for c in col.find_cards(f"nid:{n}")) for n in nids]
    finally:
        col.close()


def client_for(cm, seen: list[httpx.Request], settings: ReaderSettings | None = ReaderSettings("http://reader:8080", "open sesame")):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = json.loads(request.content)
        known = RANKS if body["language"] == "es" else {}
        phrases = [w for w in body["words"] if known and known.get(w) is None and " " in w]
        return httpx.Response(200, json={"ranks": {w: known.get(w) for w in body["words"]}, "phrases": phrases})

    server = MCPServer("test")
    frequency.register(server, cm, ReaderClient(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    return Client(server)


async def test_previews_then_orders_the_decks_new_cards_most_common_first(cm, desktop):
    esperar, inventadear, casa = omni(desktop)
    before = positions(desktop, [esperar, inventadear, casa])
    assert before == sorted(before)  # added in that order
    seen: list[httpx.Request] = []
    async with client_for(cm, seen) as c:
        preview = await call(c, "order_new_by_frequency", deck="Español", language="es")
        assert preview["preview"] is True and preview["notes"] == 3 and preview["ranked"] == 2 and preview["unranked"] == 1
        assert [w["word"] for w in preview["first"]] == ["la casa", "esperar", "inventadear"]
        assert positions(desktop, [esperar, inventadear, casa]) == before  # a preview writes nothing

        done = await call(c, "order_new_by_frequency", deck="Español", language="es", preview=False)
        assert done["moved"] == 3
    after = positions(desktop, [casa, esperar, inventadear])
    assert after == sorted(after) and len(set(after)) == 3
    assert after[0] == before[0]  # it starts where the deck's positions began
    assert seen[0].headers["Authorization"] == "Bearer open sesame"
    assert json.loads(seen[0].content)["language"] == "es"


async def test_says_what_to_fix(cm, desktop):
    omni(desktop)
    async with client_for(cm, []) as c:
        assert "no deck called" in await call_error(c, "order_new_by_frequency", deck="Nope", language="es")
        assert 'no field "Word"' in await call_error(c, "order_new_by_frequency", deck="Español", language="es", field="Word")
        assert "nothing to order by" in await call_error(c, "order_new_by_frequency", deck="Español", language="th")
    async with client_for(cm, [], settings=None) as c:
        assert "READER_PASSPHRASE" in await call_error(c, "order_new_by_frequency", deck="Español", language="es")
