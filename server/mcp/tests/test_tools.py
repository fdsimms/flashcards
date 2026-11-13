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


async def test_a_note_anki_refuses_doesnt_fail_the_rest_of_an_update(client, monkeypatch):
    from anki.collection import Collection

    found = (await call(client, "find_notes", query='"deck:🧠 Trivia" Capital'))["notes"]
    refused, kept = found[0]["note_id"], found[1]["note_id"]
    update_note = Collection.update_note

    def refusing(self, note, *args, **kwargs):
        if note.id == refused:
            raise RuntimeError("the note is broken")
        return update_note(self, note, *args, **kwargs)

    monkeypatch.setattr(Collection, "update_note", refusing)
    out = await call(client, "update_notes", updates=[
        {"note_id": refused, "add_tags": ["checked"]},
        {"note_id": kept, "add_tags": ["checked"]},
    ])
    assert out["results"] == [
        {"note_id": refused, "error": "Anki refused it: the note is broken"},
        {"note_id": kept, "updated": True},
    ]
    notes = (await call(client, "get_notes", note_ids=[refused, kept]))["notes"]
    assert ["checked" in n["tags"] for n in notes] == [False, True]


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


async def test_fetches_media_at_its_first_sync(client, cm, desktop, tmp_path):
    desktop.run("media-sync")
    await call(client, "list_decks")
    cm.wait_for_media()
    assert any((tmp_path / "mcp" / "collection.media").iterdir())


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


async def test_a_full_sync_with_unsent_changes_is_refused_until_told_to_take_the_server(client, cm, desktop):
    await call(client, "list_decks")

    def change_here_while_another_device_uploads(col):
        note = col.new_note(col.models.by_name("Basic"))
        note["Front"] = "Only on the MCP"
        col.add_note(note, col.decks.id_for_name(TRIVIA))
        desktop.run("add-field", "Basic", "Extra", "+", "upload")

    # The sync after the change finds the server's collection replaced: nothing is overwritten.
    await cm.write(change_here_while_another_device_uploads)
    for _ in range(2):  # and it stays refused, rather than taking the server's on a second try
        assert "sync_now with take_server=true" in await call_error(client, "sync_now")
    await call(client, "sync_now", take_server=True)
    types = {t["note_type"]: t for t in (await call(client, "list_note_types"))["note_types"]}
    assert types["Basic"]["fields"] == ["Front", "Back", "Extra"]
    assert (await call(client, "find_notes", query='"Front:Only on the MCP"'))["total"] == 0
    await call(client, "sync_now")  # and syncs normally from then on


async def test_flagged_cards_are_found_with_their_reason_and_resolved(client, desktop):
    note = (await call(client, "get_notes", note_ids=[1794408858018]))["notes"][0]
    cid = note["cards"][0]["card_id"]
    assert (await call(client, "flagged_cards"))["total"] == 0
    # What Franki's "Flag for an agent" writes: the purple flag and a reason tag.
    await call(client, "manage_cards", action="set_flag", card_ids=[cid], flag=7)
    await call(client, "manage_tags", action="add", note_ids=[note["note_id"]], tags=["flag::audio", "keep"])
    out = await call(client, "flagged_cards")
    assert out["total"] == 1
    flagged = out["cards"][0]
    assert flagged["card_id"] == cid and flagged["reason"] == "audio" and flagged["fields"] == note["fields"]
    assert (await call(client, "flagged_cards", deck=THAI))["total"] == 0  # the flagged card is in another deck
    assert "no deck called" in await call_error(client, "flagged_cards", deck="Nowhere")

    # A card that isn't flagged is refused, and nothing is changed.
    other_note = next(n for n in (await call(client, "find_notes", query="-flag:7", limit=5))["notes"] if n["note_id"] != note["note_id"])
    other = (await call(client, "get_notes", note_ids=[other_note["note_id"]]))["notes"][0]["cards"][0]["card_id"]
    assert "isn't flagged" in await call_error(client, "resolve_flag", card_ids=[other])
    assert (await call(client, "flagged_cards"))["total"] == 1

    assert (await call(client, "resolve_flag", card_ids=[cid]))["resolved"] == 1
    assert (await call(client, "flagged_cards"))["total"] == 0
    tags = (await call(client, "get_notes", note_ids=[note["note_id"]]))["notes"][0]["tags"]
    assert "keep" in tags and not any(t.startswith("flag::") for t in tags)


async def test_the_server_instructions_explain_studying(client):
    assert "Never rate a card" in client.instructions
    assert "resolve_flag" in client.instructions


async def test_changes_templates_and_styling_without_a_full_sync(client, desktop):
    nt = await call(client, "get_note_type", note_type="Basic")
    assert nt["card_types"][0]["front"] == "{{Front}}" and nt["css"]
    await call(client, "update_note_type", note_type="Basic",
               card_types={"Card 1": {"front": "<div class=q>{{Front}}</div>"}}, css=nt["css"] + "\n.q { font-size: 30px; }")
    assert "has no card type 'Card 9'" in await call_error(client, "update_note_type", note_type="Basic", card_types={"Card 9": {"front": "x"}})
    assert "Anki refused" in await call_error(client, "update_note_type", note_type="Basic", card_types={"Card 1": {"front": "{{Nope}}"}})
    out = desktop.run("sync")
    assert "full" not in str(out).lower()
    templates = [t for t in desktop.run("dump")["dump"]["templates"]]
    assert len(templates) > 0
    found = (await call(client, "get_note_type", note_type="Basic"))["card_types"][0]["front"]
    assert found == "<div class=q>{{Front}}</div>"


async def test_filtered_decks(client):
    made = await call(client, "filtered_deck", action="create", name="Cram", search=f'"deck:{TRIVIA}"', order="random", reschedule=False)
    assert made["cards"] > 0
    assert any(d["deck"] == "Cram" for d in (await call(client, "list_decks"))["decks"])
    await call(client, "filtered_deck", action="empty", name="Cram")
    assert (await call(client, "filtered_deck", action="rebuild", name="Cram"))["cards"] > 0
    await call(client, "filtered_deck", action="delete", name="Cram")
    assert not any(d["deck"] == "Cram" for d in (await call(client, "list_decks"))["decks"])
    assert "normal deck" in await call_error(client, "filtered_deck", action="empty", name=TRIVIA)
    assert "no filtered deck" in await call_error(client, "filtered_deck", action="rebuild", name="Nope")


async def test_memory_state_after_an_answer(client):
    first = (await call(client, "study_next", deck=TRIVIA))["card"]
    before = (await call(client, "card_memory_state", card_ids=[first["card_id"]]))["cards"][0]
    await call(client, "rate_card", card_id=first["card_id"], rating=3)
    after = (await call(client, "card_memory_state", card_ids=[first["card_id"]]))["cards"][0]
    assert before.get("memory_state", "x") is None or before.get("stability_days")
    assert after["stability_days"] > 0 and 1 <= after["difficulty"] <= 10 and 0 <= after["difficulty_percent"] <= 100
    assert after["desired_retention"]


async def test_deletes_media_only_when_unused_unless_asked(client, cm, desktop):
    desktop.run("media-sync")  # the fixture's images reach the server, and from it the MCP
    await call(client, "sync_now")
    cm.wait_for_media()
    flag = (await call(client, "get_notes", note_ids=[1794408858030]))["notes"][0]["fields"]["Front"].split('src="')[1].split('"')[0]
    await call(client, "store_media", filename="spare.txt", data_base64=base64.b64encode(b"x").decode())
    cm.wait_for_media()
    desktop.run("media-sync")
    assert (desktop.path.parent / "collection.media" / "spare.txt").exists()
    out = await call(client, "delete_media", filenames=["spare.txt", flag, "missing.png"])
    assert out["deleted"] == 1
    errors = {r["filename"]: r.get("error", "") for r in out["results"]}
    assert "Notes still use it" in errors[flag] and "no media file" in errors["missing.png"]
    cm.wait_for_media()
    desktop.run("media-sync")
    assert not (desktop.path.parent / "collection.media" / "spare.txt").exists()


async def test_cards_come_as_text_unless_html_is_asked_for(client):
    card = (await call(client, "study_next", deck=TRIVIA))["card"]["card_id"]
    plain = await call(client, "present_card", card_id=card, show_answer=True)
    assert plain["question_text"] and plain["answer_text"]
    assert "question_html" not in plain and "answer_html" not in plain
    full = await call(client, "present_card", card_id=card, show_answer=True, include_html=True)
    assert full["answer_html"] and "<style" not in full["question_html"] and "<style" not in full["answer_html"]
    assert "question_html" not in await call(client, "study_next", deck=TRIVIA)
