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
        if request.url.path == "/api/settings":
            return httpx.Response(200, json={"decks": {"es": "Español", "th": THAI, "pl": "Polski"}})
        body = json.loads(request.content)
        known = RANKS if body["language"] == "es" else {}
        phrases = [w for w in body["words"] if known and known.get(w) is None and " " in w]
        return httpx.Response(200, json={"ranks": {w: known.get(w) for w in body["words"]}, "phrases": phrases})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def client_for(cm, settings: ReaderSettings | None = SETTINGS) -> Client:
    server = MCPServer("test")
    tools.register(server, cm, None)
    tiers.register(server, cm, ReaderClient(settings, reader_http()))
    return Client(server)


async def test_previews_then_files_each_note_into_its_tier_and_leaves_other_subdecks_alone(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    async with client_for(cm) as c:
        preview = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET)
        assert [t["notes"] for t in preview["tiers"]] == [1, 1, 1]
        assert preview["left_alone"] == {"cards": 1, "in_other_subdecks": {"Español::Odmiana": 1}, "in_filtered_decks": 0, "without_the_field": 0}
        assert decks_of(desktop, [esperar, casa]) == ["Español", "Español"]  # a preview moves nothing

        done = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert done["moved"] == 3
    assert decks_of(desktop, [casa, esperar, inventadear, hola]) == ["Español::Tier 1", "Español::Tier 2", "Español::Tier 3", "Español::Odmiana"]
    assert [retention_of(desktop, f"Español::Tier {i}") for i in (1, 2, 3)] == [(f"Español · Tier {i}", r) for i, r in zip((1, 2, 3), (0.92, 0.88, 0.80))]


async def test_filing_again_moves_nothing_and_leaves_a_tiers_own_limit_alone(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        again = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert again["moved"] == 0 and all(t["cards_to_move"] == 0 for t in again["tiers"])
        # A limit set on a tier in Anki is its own: the parent's changing, or another run, doesn't reset it.
        await call(c, "set_fsrs_settings", deck="Español::Tier 3", new_per_day=2)
        await call(c, "set_fsrs_settings", deck="Español", new_per_day=7)
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        got = await call(c, "get_fsrs_settings", deck="Español::Tier 3")
        assert got["new_per_day"] == 2 and got["desired_retention"] == 0.8
        assert (await call(c, "get_fsrs_settings", deck="Español::Tier 2"))["new_per_day"] != 7


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


THAI = "👅 Languages::🐘 ภาษาไทย"


async def test_optimizing_a_tiered_deck_reads_its_tiers_and_hands_the_result_back_to_them(cm, desktop, monkeypatch):
    from anki._backend import RustBackend

    searches: list[str] = []
    original = RustBackend.compute_fsrs_params
    monkeypatch.setattr(RustBackend, "compute_fsrs_params", lambda self, **kw: (searches.append(kw["search"]), original(self, **kw))[1])
    server = MCPServer("test")
    tools.register(server, cm, None)

    def handler(request: httpx.Request) -> httpx.Response:
        words = json.loads(request.content)["words"]
        return httpx.Response(200, json={"ranks": {w: (50 if "น้ำ" in w else None) for w in words}})

    tiers.register(server, cm, ReaderClient(SETTINGS, httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    async with Client(server) as c:
        await call(c, "optimize_fsrs", deck=THAI)
        assert searches[-1].count("preset:") == 1
        await call(c, "tier_deck_by_frequency", deck=THAI, language="th", field="Front", bands=[100], retentions=[0.9, 0.8], preview=False)
        # The cards now sit under the tier presets, and the optimizer still reads all of them.
        await call(c, "optimize_fsrs", deck=THAI)
        assert searches[-1].count("preset:") == 3 and "· Tier 1" in searches[-1] and "· Tier 2" in searches[-1]
        assert "frequency tiers" in await call_error(c, "optimize_fsrs", deck=f"{THAI}::Tier 1")
        # Parameters set on the parent reach the tiers at once.
        p6 = [round(0.1 + i / 10, 4) for i in range(21)]
        await call(c, "set_fsrs_settings", deck=THAI, params=p6)
        got = await call(c, "get_fsrs_settings", deck=f"{THAI}::Tier 2")
        assert got["params"] == pytest.approx(p6) and got["desired_retention"] == 0.8


async def test_files_every_language_that_can_be_and_says_why_it_skipped_the_others(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    # A note of another type in the deck is left where it is, not a reason to refuse the deck.
    desktop.run("add-note", "Español", "front", "back", "+", "sync")
    async with client_for(cm) as c:
        preview = await call(c, "tier_all_languages_by_frequency", bands=BANDS, retentions=RET)
        assert preview["preview"] is True and [x["language"] for x in preview["languages"]] == ["es"]
        assert {x["language"] for x in preview["skipped"]} == {"th", "pl"}
        assert "no deck called" in next(x["reason"] for x in preview["skipped"] if x["language"] == "pl")
        assert decks_of(desktop, [esperar]) == ["Español"]  # a preview moves nothing

        done = await call(c, "tier_all_languages_by_frequency", bands=BANDS, retentions=RET, preview=False)
        assert done["languages"][0]["moved"] == 3 and done["languages"][0]["left_alone"]["without_the_field"] == 1
    assert decks_of(desktop, [casa, esperar, inventadear]) == ["Español::Tier 1", "Español::Tier 2", "Español::Tier 3"]
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        assert {col.decks.name(c.did) for c in map(col.get_card, col.find_cards("front:front"))} == {"Español"}
    finally:
        col.close()


def two_languages(desktop) -> None:
    note = lambda **f: json.dumps(f)  # noqa: E731
    desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language",
        "+", "add-fields-note", "Omnilanguage", "Español", note(Entry="la casa", Meaning="house", Language="spanish"),
        "+", "add-fields-note", "Omnilanguage", "Deutsch", note(Entry="das Haus", Meaning="house", Language="german"),
        "+", "sync",
    )


def ranking_client(cm) -> Client:
    """A Read & Listen that ranks every word of every language."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ranks": {w: 5 for w in json.loads(request.content)["words"]}})

    server = MCPServer("test")
    tools.register(server, cm, None)
    tiers.register(server, cm, ReaderClient(SETTINGS, httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    return Client(server)


async def test_decks_sharing_a_preset_get_tier_presets_and_filing_settings_of_their_own(cm, desktop):
    two_languages(desktop)
    async with ranking_client(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        await call(c, "tier_deck_by_frequency", deck="Deutsch", language="de", bands=BANDS, retentions=RET, preview=False)
    assert retention_of(desktop, "Español::Tier 1")[0] != retention_of(desktop, "Deutsch::Tier 1")[0]
    filed = await cm.read(tiers._tiered)
    assert {d: s["language"] for d, s in filed.items()} == {"Español": "es", "Deutsch": "de"}


async def test_the_daily_pass_follows_the_newest_bands_and_stops_when_turned_off(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert list((await cm.read(tiers._tiered)).values())[0]["bands"] == BANDS
        # Two tiers instead of three: the old Tier 3 preset is still there, but isn't what the pass reads.
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=[1000], retentions=[0.9, 0.8], preview=False)
        assert (await cm.read(tiers._tiered))["Español"]["bands"] == [1000]
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=[1000], retentions=[0.9, 0.8], daily=False, preview=False)
        assert await cm.read(tiers._tiered) == {}


async def test_a_deck_named_in_another_case_is_filed_under_its_own_spelling(cm, desktop):
    omni(desktop)
    async with client_for(cm) as c:
        preview = await call(c, "tier_deck_by_frequency", deck="español", language="es", bands=BANDS, retentions=RET)
        assert preview["deck"] == "Español" and [t["deck"] for t in preview["tiers"]][0] == "Español::Tier 1"
        await call(c, "tier_deck_by_frequency", deck="español", language="es", bands=BANDS, retentions=RET, preview=False)
        again = await call(c, "tier_deck_by_frequency", deck="español", language="es", bands=BANDS, retentions=RET)
        assert all(t["cards_to_move"] == 0 for t in again["tiers"])


async def test_an_unexpected_error_in_one_language_doesnt_lose_the_others(cm, desktop, monkeypatch):
    omni(desktop)
    real = tiers.file_deck

    async def flaky(cm_, client, deck, settings, apply):
        if settings.language == "th":
            raise RuntimeError("boom")
        return await real(cm_, client, deck, settings, apply)

    monkeypatch.setattr(tiers, "file_deck", flaky)
    async with client_for(cm) as c:
        out = await call(c, "tier_all_languages_by_frequency", bands=BANDS, retentions=RET)
    assert [x["language"] for x in out["languages"]] == ["es"]
    assert "RuntimeError" in next(x["reason"] for x in out["skipped"] if x["language"] == "th")


async def test_a_run_with_nothing_to_do_writes_nothing(cm, desktop, monkeypatch):
    omni(desktop)
    async with client_for(cm) as c:
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        writes: list[object] = []
        real = cm.write
        monkeypatch.setattr(cm, "write", lambda *a, **k: (writes.append(a), real(*a, **k))[1])
        again = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
        assert again["moved"] == 0 and writes == []


async def test_a_phrase_goes_in_the_first_tier(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    note = json.dumps({"Entry": "mantener a raya", "Meaning": "to keep at bay", "Language": "spanish"})
    phrase = desktop.run("add-fields-note", "Omnilanguage", "Español", note, "+", "sync")["notes"][0]
    async with client_for(cm) as c:
        preview = await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET)
        assert [t["notes"] for t in preview["tiers"]] == [2, 1, 1]
        assert {"word": "mantener a raya", "rank": None, "phrase": True} in preview["tiers"][0]["examples"]
        await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)
    assert decks_of(desktop, [phrase, casa, inventadear]) == ["Español::Tier 1", "Español::Tier 1", "Español::Tier 3"]


async def tier_spanish(c) -> None:
    await call(c, "tier_deck_by_frequency", deck="Español", language="es", bands=BANDS, retentions=RET, preview=False)


def preset_names(desktop) -> set[str]:
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        return {c["name"] for c in col.decks.all_config()}
    finally:
        col.close()


async def test_untiering_puts_the_cards_back_and_removes_the_tiers_presets_and_daily_filing(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    async with client_for(cm) as c:
        await tier_spanish(c)
        assert await cm.read(tiers._tiered)
        preview = await call(c, "untier_deck", deck="Español")
        assert preview["preview"] is True and [t["cards_to_move_back"] for t in preview["tiers"]] == [1, 1, 1]
        assert decks_of(desktop, [casa]) == ["Español::Tier 1"]  # a preview moves nothing

        done = await call(c, "untier_deck", deck="Español", preview=False)
        assert done["moved"] == 3 and len(done["removed_decks"]) == 3 and done["kept_decks"] == [] and done["presets_left"] == 3
        assert "has no tier subdecks" in await call_error(c, "untier_deck", deck="Español")
    # Back in the deck, the other subdeck untouched, nothing left to file daily, and the tier presets gone.
    assert decks_of(desktop, [casa, esperar, inventadear, hola]) == ["Español", "Español", "Español", "Español::Odmiana"]
    assert await cm.read(tiers._tiered) == {}
    # The presets are left, unused (deleting one makes every device do a full sync), and filing again reuses them.
    assert {f"Español · Tier {i}" for i in (1, 2, 3)} <= preset_names(desktop)


async def test_untiering_never_deletes_a_card_that_is_in_a_filtered_deck(cm, desktop):
    esperar, inventadear, casa, hola = omni(desktop)
    async with client_for(cm) as c:
        await tier_spanish(c)
        (borrowed,) = await cm.read(lambda col: list(col.find_cards(f"nid:{casa}")))
        await call(c, "filtered_deck", action="create", name="Borrowed", search=f"cid:{borrowed}", limit=10)
        preview = await call(c, "untier_deck", deck="Español")
        assert preview["tiers"][0]["in_filtered_decks"] == 1
        done = await call(c, "untier_deck", deck="Español", preview=False)
        assert done["moved"] == 2 and done["kept_decks"] == ["Español::Tier 1"] and len(done["removed_decks"]) == 2
        # The borrowed card is still there, in its filtered deck, and its tier deck stays for it.
        assert await cm.read(lambda col: len(col.find_cards('"deck:Borrowed"'))) == 1
        assert await cm.read(tiers._tiered) == {}  # daily filing is off whatever is kept
