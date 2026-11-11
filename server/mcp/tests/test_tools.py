"""The tools against a real Anki sync server: what they change reaches Anki on another device."""

from __future__ import annotations

import base64

import pytest

from conftest import call, call_error

pytestmark = pytest.mark.anyio

THAI = "👅 Languages::🐘 ภาษาไทย"
TRIVIA = "🧠 Trivia"


async def test_lists_decks_and_note_types(client):
    decks = {d["deck"]: d for d in (await call(client, "list_decks"))["decks"]}
    assert THAI in decks and TRIVIA in decks
    types = {t["note_type"]: t for t in (await call(client, "list_note_types"))["note_types"]}
    assert types["Basic"]["fields"] == ["Front", "Back"]
    assert types["Cloze"]["is_cloze"]


async def test_finds_and_reads_notes(client):
    found = await call(client, "find_notes", query='"deck:🧠 Trivia" Capital')
    assert found["total"] == 4  # Peru's card sits in a filtered deck but its home is Trivia
    peru = next(n for n in found["notes"] if n["preview"] == "Capital of Peru?")
    full = (await call(client, "get_notes", note_ids=[peru["note_id"]]))["notes"][0]
    assert full["fields"]["Back"] == "Lima"
    assert full["cards"][0]["deck"] == TRIVIA and full["cards"][0]["filtered_deck"] == "Filtered Deck 1"
    assert "couldn't read the search" in await call_error(client, "find_notes", query='"deck:')


async def test_added_notes_reach_another_device(client, desktop):
    out = await call(client, "add_notes", notes=[
        {"deck": TRIVIA, "note_type": "Basic", "fields": {"Front": "Capital of Ecuador?", "Back": "Quito"}, "tags": ["geo"]},
        {"deck": TRIVIA, "note_type": "Basic", "fields": {"Front": "Capital of Chile?", "Back": "Santiago"}},
        {"deck": "Nowhere", "note_type": "Basic", "fields": {"Front": "x"}},
        {"deck": TRIVIA, "note_type": "Basic", "fields": {"Front": "y", "Answer": "z"}},
    ])
    assert out["added"] == 1
    errors = [r.get("error", "") for r in out["results"]]
    assert "same first field" in errors[1]
    assert 'no deck called "Nowhere"' in errors[2]
    assert "has no field 'Answer'" in errors[3]
    desktop.run("sync")
    fronts = [n[6].split("\x1f")[0] for n in desktop.run("dump")["dump"]["notes"]]
    assert "Capital of Ecuador?" in fronts


async def test_updates_tags_and_deletes(client, desktop):
    nid = (await call(client, "find_notes", query='"Front:Capital of Bolivia?"'))["notes"][0]["note_id"]
    await call(client, "update_notes", updates=[{"note_id": nid, "fields": {"Back": "Sucre"}, "add_tags": ["south-america"]}])
    note = (await call(client, "get_notes", note_ids=[nid]))["notes"][0]
    assert note["fields"]["Back"] == "Sucre" and "south-america" in note["tags"]
    assert (await call(client, "manage_tags", action="rename", old_name="south-america", new_name="americas"))["notes_changed"] == 1
    assert "americas" in (await call(client, "manage_tags", action="list"))["tags"]
    assert "Nothing was deleted" in await call_error(client, "delete_notes", note_ids=[nid, 123])
    assert (await call(client, "delete_notes", note_ids=[nid]))["deleted"] == 1
    desktop.run("sync")
    assert all(n[0] != nid for n in desktop.run("dump")["dump"]["notes"])


async def test_card_actions(client):
    note = (await call(client, "get_notes", note_ids=[1794408858018]))["notes"][0]
    cid = note["cards"][0]["card_id"]
    await call(client, "manage_cards", action="suspend", card_ids=[cid])
    await call(client, "manage_cards", action="set_flag", card_ids=[cid], flag=1)
    card = (await call(client, "get_notes", note_ids=[1794408858018]))["notes"][0]["cards"][0]
    assert card["stage"] == "suspended" and card["flag"] == 1
    await call(client, "manage_cards", action="unsuspend", card_ids=[cid])
    await call(client, "manage_cards", action="change_deck", card_ids=[cid], deck="Default")
    await call(client, "manage_cards", action="set_due_date", card_ids=[cid], days="3")
    card = (await call(client, "get_notes", note_ids=[1794408858018]))["notes"][0]["cards"][0]
    assert card["deck"] == "Default" and card["stage"] == "review"
    await call(client, "manage_cards", action="forget", card_ids=[cid])
    card = (await call(client, "get_notes", note_ids=[1794408858018]))["notes"][0]["cards"][0]
    assert card["stage"] == "new"
    assert "set_flag needs flag" in await call_error(client, "manage_cards", action="set_flag", card_ids=[cid], flag=9)


async def test_studies_in_anki_order_and_the_answer_reaches_another_device(client, desktop):
    first = await call(client, "study_next", deck=TRIVIA)
    card = first["card"]
    assert card and first["question_text"] and set(first["next_if"]) == {"again", "hard", "good", "easy"}
    shown = await call(client, "present_card", card_id=card["card_id"], show_answer=True)
    assert shown["answer_text"]
    rated = await call(client, "rate_card", card_id=card["card_id"], rating=3)
    assert rated["card"]["reviews"] == card["reviews"] + 1
    # Rating it again fails: it's no longer at the top of the queue (or it is, as a learning step,
    # but then it's a new answer the user has to have seen).
    after = await call(client, "study_next", deck=TRIVIA)
    if after["card"] and after["card"]["card_id"] != card["card_id"]:
        assert "isn't the next card" in await call_error(client, "rate_card", card_id=card["card_id"], rating=3)
    desktop.run("sync")
    assert any(r[1] == card["card_id"] for r in desktop.run("dump")["dump"]["revlog"])


async def test_stats_and_fsrs(client):
    stats = await call(client, "get_stats", deck=THAI)
    assert stats["cards"]["mature"] + stats["cards"]["young"] == 2
    assert sum(stats["cards"].values()) == 4
    fsrs = await call(client, "get_fsrs_settings", deck=THAI)
    assert fsrs["fsrs_enabled"] and THAI in fsrs["decks_sharing_it"]
    out = await call(client, "set_fsrs_settings", deck=THAI, desired_retention=0.85, new_per_day=7)
    assert THAI in out["decks_affected"]
    fsrs = await call(client, "get_fsrs_settings", deck=THAI)
    assert fsrs["desired_retention"] == pytest.approx(0.85) and fsrs["new_per_day"] == 7
    assert "between 0.7 and 0.99" in await call_error(client, "set_fsrs_settings", deck=THAI, desired_retention=1.5)
    opt = await call(client, "optimize_fsrs", deck=THAI)
    assert opt["applied"] is False


async def test_media_reaches_the_server(client, cm, desktop):
    name = (await call(client, "store_media", filename="hello.txt", data_base64=base64.b64encode(b"hi").decode()))["filename"]
    assert name == "hello.txt"
    cm.wait_for_media()
    desktop.run("media-sync")
    assert (desktop.path.parent / "collection.media" / "hello.txt").read_bytes() == b"hi"


async def test_sees_changes_made_in_anki_and_follows_a_full_sync(client, desktop):
    await call(client, "list_decks")
    desktop.run("add-note", TRIVIA, "Capital of Peru?", "Lima", "dup" , "+", "sync")
    found = await call(client, "find_notes", query="tag:dup")
    assert found["total"] == 1
    # Another device replaces the server's collection (Anki's "Upload" on a full sync); this copy
    # had nothing unsent, so it takes the server's.
    desktop.run("add-field", "Basic", "Extra", "+", "upload")
    types = {t["note_type"]: t for t in (await call(client, "list_note_types"))["note_types"]}
    assert types["Basic"]["fields"] == ["Front", "Back", "Extra"]


async def test_the_server_instructions_explain_studying(client):
    assert "Never rate a card" in client.instructions
