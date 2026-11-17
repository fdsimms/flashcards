"""tier_deck_by_frequency: notes filed into tier subdecks, each on a preset with its own retention, against a real Anki server."""

from __future__ import annotations

import json

import anyio
import httpx
import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import tiers, tools
from franki_mcp.reader import ReaderClient, ReaderSettings
from mcp import Client
from mcp.server.mcpserver import MCPServer

pytestmark = pytest.mark.anyio

RANKS = {"la casa": 120, "esperar": 900, "hola": 5}
SETTINGS = ReaderSettings("http://reader:8080", "open sesame")
BANDS = [200, 1000]
RET = [0.92, 0.88, 0.80]


def test_a_rank_lands_in_the_first_band_it_fits_and_no_place_in_the_last():
    s = tiers.Settings("es", bands=(1000, 3000))
    assert [s.tier_of(r) for r in (1, 1000, 1001, 3000, 3001, None)] == [0, 0, 1, 1, 2, 2]


def test_bands_and_retentions_are_checked():
    for bad in (tiers.Settings("es", bands=()), tiers.Settings("es", bands=(3000, 1000)), tiers.Settings("es", retentions=(0.9, 0.8)),
                tiers.Settings("es", retentions=(0.99, 0.9, 0.5))):
        with pytest.raises(Exception, match="band|retention|Each"):
            bad.check()


def omni(desktop) -> list[int]:
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language",
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="esperar", Meaning="to wait", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="inventadear", Meaning="made up", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="la casa", Meaning="house", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Español::Odmiana", note(Entry="hola", Meaning="hi", Language="spanish"),
        "+", "sync",
    )["notes"]


def decks_of(desktop, nids: list[int]) -> list[str]:
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        return [col.decks.name(col.get_card(col.find_cards(f"nid:{n}")[0]).did) for n in nids]
    finally:
        col.close()


def retention_of(desktop, deck: str) -> tuple[str, float]:
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        conf = col.decks.config_dict_for_deck_id(col.decks.id_for_name(deck))
        return conf["name"], conf["desiredRetention"]
    finally:
        col.close()


def reader_http(seen: list[httpx.Request] | None = None) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        (seen if seen is not None else []).append(request)
        body = json.loads(request.content)
        known = RANKS if body["language"] == "es" else {}
        return httpx.Response(200, json={"ranks": {w: known.get(w) for w in body["words"]}})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def client_for(cm, settings: ReaderSettings | None = SETTINGS) -> Client:
    server = MCPServer("test")
    tools.register(server, cm, None)
    tiers.register(server, cm, settings, http=reader_http())
    return Client(server)


async def test_previews_then_files_each_note_into_its_tier_and_leaves_other_subdecks_alone(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    async with client_for(cm) as c:
        preview = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET)
        assert [t["notes"] for t in preview["tiers"]] == [1, 1, 1]
        assert preview["left_alone"] >= 1  # Odmiana's card
        assert decks_of(desktop, [esperar, casa]) == ["Español", "Español"]  # a preview moves nothing

        done = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert done["moved"] == 3
    assert decks_of(desktop, [casa, esperar, inventadear, hola]) == ["Español::Tier 1", "Español::Tier 2", "Español::Tier 3", "Español::Odmiana"]
    base, _ = retention_of(desktop, "Español")
    assert [retention_of(desktop, f"Español::Tier {i}") for i in (1, 2, 3)] == [(f"{base} · Tier {i}", r) for i, r in zip((1, 2, 3), (0.92, 0.88, 0.80))]


async def test_filing_again_moves_nothing_and_keeps_the_presets_in_step_with_the_parent(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        again = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert again["moved"] == 0 and all(t["cards_to_move"] == 0 for t in again["tiers"])
        # The parent's limit changes; the next run carries it to the tiers, and leaves their retention.
        await call(c, "set_fsrs_settings", deck="Español", new_per_day=7)
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        got = await call(c, "get_fsrs_settings", deck="Español::Tier 2")
        assert got["new_per_day"] == 7 and got["desired_retention"] == 0.88


async def call_tune(cm, deck: str, retention: float) -> None:
    def run(col):
        conf = col.decks.config_dict_for_deck_id(col.decks.id_for_name(deck))
        conf["desiredRetention"] = retention
        col.decks.update_config(conf)

    await cm.write(run)


async def test_the_daily_pass_files_a_word_added_since(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
    note = lambda **f: json.dumps(f)  # noqa: E731
    new = desktop.run("add-fields-note", "Omnilanguage", "Español", note(Entry="hola", Meaning="hi", Language="spanish"), "+", "sync")["notes"][0]
    assert decks_of(desktop, [new]) == ["Español"]
    # A retention tuned in Anki since stays: the daily pass doesn't reset it.
    await call_tune(cm, "Español::Tier 1", 0.95)
    async with anyio.create_task_group() as tg:
        tg.start_soon(tiers.daily_loop, cm, ReaderClient(SETTINGS, reader_http()), 0, 3600)
        with anyio.fail_after(30):
            # In a thread: the other device's sync is a blocking subprocess, which would stall the loop.
            while await anyio.to_thread.run_sync(decks_of, desktop, [new]) != ["Español::Tier 1"]:
                await anyio.sleep(0.5)
        tg.cancel_scope.cancel()
    assert retention_of(desktop, "Español::Tier 1")[1] == 0.95


async def test_says_what_to_fix(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        assert "no deck called" in await call_error(c, "tier_deck_by_frequency", deck="Nope", language="es")
        assert "Pass retentions too" in await call_error(c, "tier_deck_by_frequency", deck="Español", language="es", bands=[100])
        assert "retentions needs" in await call_error(c, "tier_deck_by_frequency", deck="Español", language="es", retentions=[0.9])
        assert "nothing to file by" in await call_error(c, "tier_deck_by_frequency", deck="Español", language="th")
    async with client_for(cm, None) as c:
        assert "READER_PASSPHRASE" in await call_error(c, "tier_deck_by_frequency", deck="Español", language="es")
