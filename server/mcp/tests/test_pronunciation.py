"""Filling Omnilanguage's Pronunciation field from Read & Listen: what it asks, what it writes, and that it reaches Anki on another device."""

from __future__ import annotations

import json

import anyio
import httpx
import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import pronunciation
from franki_mcp.reader import ReaderClient, ReaderSettings
from franki_mcp.server import build_server
from mcp import Client

pytestmark = pytest.mark.anyio

FIELDS = "Entry,Meaning,Language,KanaReading,Pronunciation"


def notes(desktop, fields: str = FIELDS) -> list[int]:
    """Five notes on the server: Russian (has IPA), Russian (none in the table), a Russian phrase,
    Japanese (with a reading), and one in English (no table)."""
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", fields,
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="дом", Meaning="house", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="редкость", Meaning="rarity", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="дом и сад", Meaning="house and garden", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "日本語", note(Entry="大人", Meaning="adult", Language="japanese", KanaReading="おとな"),
        "+", "add-fields-note", "Omnilanguage", "English", note(Entry="house", Meaning="house", Language="english"),
        "+", "sync",
    )["notes"]


def reader_answering(by_entry: dict[str, dict[str, str]] | None):
    """Read & Listen's /api/pronunciations: `by_entry` for each entry asked (None: out of reach), and what it was asked."""
    asked: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        asked.append(body)
        if by_entry is None:
            return httpx.Response(502)
        return httpx.Response(200, json={"pronunciations": [by_entry.get(e["entry"]) for e in body["entries"]]})

    client = ReaderClient(ReaderSettings("http://reader", "pw"), httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return client, asked


ANSWERS = {
    "дом": {"ipa": "[dom]", "source": "wiktionary"},
    "редкость": {"ipa": "/ˈrʲetkəsʲtʲ/", "source": "ai"},
    "大人": {"ipa": "/otona/", "source": "rules"},
}


async def test_previews_then_fills_and_the_ipa_reaches_another_device(cm, desktop):
    dom, redkost, phrase, otona, house = notes(desktop)
    reader, asked = reader_answering(ANSWERS)
    async with Client(build_server(cm, reader=reader)) as c:
        preview = await call(c, "fill_pronunciation")
        assert [w["word"] for w in preview["would_fill"]] == ["дом", "редкость", "大人"]
        assert preview["written"] == 0
        assert preview["not_found"] == ["дом и сад"] and preview["not_found_count"] == 1
        # English has no table, so it's reported, not asked about or skipped silently.
        assert preview["other_languages"] == {"english": 1}
        # Nothing was written by the preview.
        assert desktop.run("sync", "+", "fields", f"nid:{dom}")["fields"][str(dom)]["Pronunciation"] == ""

        done = await call(c, "fill_pronunciation", dry_run=False)
    # The Japanese entry went with its reading, the others with none; English wasn't asked.
    assert {(e["language"], e["entry"], e["reading"]) for e in asked[-1]["entries"]} == {
        ("ru", "дом", ""), ("ru", "редкость", ""), ("ru", "дом и сад", ""), ("ja", "大人", "おとな"),
    }
    assert done["written"] == 3
    out = desktop.run("sync", "+", "fields", f"nid:{dom} OR nid:{redkost} OR nid:{phrase} OR nid:{otona} OR nid:{house}")["fields"]
    assert out[str(dom)]["Pronunciation"] == "[dom]"
    assert out[str(redkost)]["Pronunciation"] == "/ˈrʲetkəsʲtʲ/"
    assert out[str(otona)]["Pronunciation"] == "/otona/"
    assert out[str(phrase)]["Pronunciation"] == "" and out[str(house)]["Pronunciation"] == ""


async def test_tags_only_the_ipa_claude_wrote(cm, desktop):
    notes(desktop)
    reader, _ = reader_answering(ANSWERS)
    async with Client(build_server(cm, reader=reader)) as c:
        await call(c, "fill_pronunciation", dry_run=False)
        tagged = await call(c, "find_notes", query="tag:ipa-unverified")
    assert tagged["total"] == 1


async def test_the_limit_counts_notes_with_ipa_so_words_with_none_dont_use_it_up(cm, desktop):
    dom, redkost, _, _, _ = notes(desktop)
    reader, _ = reader_answering({"дом и сад": None, "дом": ANSWERS["дом"], "редкость": ANSWERS["редкость"]})
    async with Client(build_server(cm, reader=reader)) as c:
        first = await call(c, "fill_pronunciation", limit=1, dry_run=False, query="deck:Русский")
        assert first["written"] == 1 and first["remaining"] == 1 and first["not_found_count"] == 1
        second = await call(c, "fill_pronunciation", limit=1, dry_run=False, query="deck:Русский")
        assert second["written"] == 1 and second["remaining"] == 0
    out = desktop.run("sync", "+", "fields", f"nid:{dom} OR nid:{redkost}")["fields"]
    assert out[str(dom)]["Pronunciation"] and out[str(redkost)]["Pronunciation"]


async def test_never_overwrites_a_field_with_something_in_it(cm, desktop):
    dom = notes(desktop)[0]
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        n = col.get_note(dom)
        n["Pronunciation"] = "[mine]"
        col.update_note(n)
    finally:
        col.close()
    desktop.run("sync")
    reader, asked = reader_answering(ANSWERS)
    async with Client(build_server(cm, reader=reader)) as c:
        out = await call(c, "fill_pronunciation", dry_run=False)
    assert "дом" not in [w["word"] for w in out["filled"]]
    assert desktop.run("sync", "+", "fields", f"nid:{dom}")["fields"][str(dom)]["Pronunciation"] == "[mine]"
    assert all(e["entry"] != "дом" for e in asked[-1]["entries"])


async def test_says_how_to_add_the_field_when_the_note_type_has_none(cm, desktop):
    notes(desktop, "Entry,Meaning,Language,KanaReading")
    reader, _ = reader_answering(ANSWERS)
    async with Client(build_server(cm, reader=reader)) as c:
        message = await call_error(c, "fill_pronunciation")
    assert "no Pronunciation field yet" in message and "add_field" in message


async def test_without_read_and_listen_it_says_how_to_turn_it_on(cm, desktop):
    notes(desktop)
    reader, _ = reader_answering(None)
    async with Client(build_server(cm, reader=reader)) as c:
        message = await call_error(c, "fill_pronunciation")
    assert "Read & Listen" in message


async def test_the_daily_fill_runs_only_once_turned_on(cm, desktop):
    dom = notes(desktop)[0]
    reader, _ = reader_answering(ANSWERS)
    async with Client(build_server(cm, reader=reader)) as c:
        async with anyio.create_task_group() as tg:
            tg.start_soon(pronunciation.auto_fill_loop, cm, reader, 0, 0.2)
            await anyio.sleep(1)
            assert desktop.run("sync", "+", "fields", f"nid:{dom}")["fields"][str(dom)]["Pronunciation"] == ""
            assert (await call(c, "fill_pronunciation"))["auto_fill"] is False
            assert (await call(c, "set_pronunciation_auto_fill", on=True))["auto_fill"] is True
            await anyio.sleep(1.5)
            tg.cancel_scope.cancel()
    assert desktop.run("sync", "+", "fields", f"nid:{dom}")["fields"][str(dom)]["Pronunciation"] == "[dom]"


async def test_the_daily_fill_survives_a_missing_field_and_read_and_listen_being_out_of_reach(cm, desktop):
    notes(desktop, "Entry,Meaning,Language,KanaReading")
    reader, _ = reader_answering(None)
    async with Client(build_server(cm, reader=reader)) as c:
        await call(c, "set_pronunciation_auto_fill", on=True)
        async with anyio.create_task_group() as tg:
            tg.start_soon(pronunciation.auto_fill_loop, cm, reader, 0, 0.2)
            await anyio.sleep(1)
            assert not tg.cancel_scope.cancel_called  # the loop is still running: nothing raised out of it
            tg.cancel_scope.cancel()
