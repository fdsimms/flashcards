"""Content audits: what's due, what record_audit keeps and flags, and how flagged_cards and resolve_flag
carry a finding to its fix, with the flag reaching Anki on another device."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import audits
from franki_mcp.audits import AuditStore, load_definitions
from franki_mcp.server import build_server
from franki_mcp.tools import FLAG_REASONS
from mcp import Client

pytestmark = pytest.mark.anyio

REPO = Path(__file__).resolve().parents[3]
FIELDS = "Entry,Meaning,Sense,Context,ContextTranslation,Register,Language,PartOfSpeech,Gender,Notes"
WORDS = [
    {"Entry": "kot", "Meaning": "cat", "Context": "Mój <b>kot</b> śpi.", "ContextTranslation": "My cat is sleeping.",
     "Register": "neutral", "Language": "polish", "PartOfSpeech": "noun", "Gender": "m"},
    {"Entry": "pies", "Meaning": "cat", "Context": "Mój <b>pies</b> szczeka.", "ContextTranslation": "My dog is barking.",
     "Register": "neutral", "Language": "polish", "PartOfSpeech": "noun", "Gender": "m"},
    {"Entry": "dom", "Meaning": "house", "Context": "Nasz <b>dom</b> jest duży.", "ContextTranslation": "Our house is big.",
     "Register": "neutral", "Language": "polish", "PartOfSpeech": "noun", "Gender": "m"},
]  # fmt: skip

TWO_CHECKS = """
title = "Test"
about = "A test audit."
scope = "note:Omnilanguage"
fields = ["Entry", "Meaning"]
[[checks]]
id = "meaning"
version = {meaning}
flag_reason = "translation"
ask = "Meaning is right."
[[checks]]
id = "entry"
version = 1
flag_reason = "typo"
ask = "Entry is spelled right."
"""


def polish_deck(desktop) -> list[int]:
    commands = ["add-notetype", "Omnilanguage", FIELDS]
    for w in WORDS:
        commands += ["+", "add-fields-note", "Omnilanguage", "Polski", json.dumps(w)]
    return desktop.run(*commands, "+", "sync")["notes"]


def definitions(tmp_path: Path, meaning_version: int = 1) -> dict:
    folder = tmp_path / f"defs{meaning_version}"
    folder.mkdir(exist_ok=True)
    (folder / "test.toml").write_text(TWO_CHECKS.replace("{meaning}", str(meaning_version)))
    return load_definitions(folder)


def test_the_audits_in_the_repo_load_and_flag_with_a_reason_franki_knows():
    found = load_definitions()
    assert "card-content" in found and {c.id for c in found["card-content"].checks} >= {"meaning", "sense", "context"}
    # The reasons Franki's flag sheet offers, as src/core/agentFlag.ts spells them.
    app = re.findall(r"slug: '([a-z]+)'", (REPO / "src/core/agentFlag.ts").read_text())
    assert tuple(app) == FLAG_REASONS


def test_a_malformed_definition_stops_the_server_from_starting(tmp_path):
    (tmp_path / "bad.toml").write_text(TWO_CHECKS.replace("{meaning}", "1").replace('"typo"', '"spelling"'))
    with pytest.raises(ValueError, match="flag_reason"):
        load_definitions(tmp_path)


async def test_a_batch_is_recorded_flagged_fixed_and_counted(client, desktop):
    kot, pies, dom = polish_deck(desktop)
    listed = next(a for a in (await call(client, "list_audits", deck="Polski"))["audits"] if a["audit"] == "card-content")
    assert listed["notes"] == 3 and listed["checked"] == 0 and listed["due"]["unchecked"] == 3 and listed["last_run"] is None

    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski", limit=2)
    assert batch["due"] == 3 and len(batch["notes"]) == 2 and {c["id"] for c in batch["checks"]} >= {"meaning", "sense"}
    first = batch["notes"][0]
    assert first["state"] == "unchecked" and first["deck"] == "Polski" and "Sense" not in first["fields"]  # empty fields left out
    hashes = {n["note_id"]: n["content_hash"] for n in batch["notes"]}
    assert set(hashes) == {dom, pies}  # newest first, when nothing has lapsed

    # A wrong hash and an unknown check are refused, one note at a time.
    out = await call(client, "record_audit", audit="card-content", checked_by="claude", checked=[
        {"note_id": dom, "content_hash": "0" * 16},
        {"note_id": pies, "content_hash": hashes[pies], "findings": [{"check": "nonsense", "problem": "x"}]},
    ])
    assert out["recorded"] == 0 and "changed since" in out["results"][0]["reason"] and "no check nonsense" in out["results"][1]["reason"]
    assert "checked_by" in await call_error(client, "record_audit", audit="card-content", checked_by=" ", checked=[])
    assert "no audit called" in await call_error(client, "next_audit_batch", audit="nope")

    out = await call(client, "record_audit", audit="card-content", checked_by="claude", checked=[
        {"note_id": dom, "content_hash": hashes[dom]},
        {"note_id": pies, "content_hash": hashes[pies],
         "findings": [{"check": "meaning", "problem": "pies is a dog, not a cat.", "suggestion": "Meaning: dog"}]},
    ])
    assert out["recorded"] == 2 and out["results"][1]["flagged"]

    listed = next(a for a in (await call(client, "list_audits", deck="Polski"))["audits"] if a["audit"] == "card-content")
    assert listed["checked"] == 2 and listed["due"]["unchecked"] == 1 and listed["open_findings"] == 1
    assert listed["last_run"]["checked_by"] == "claude" and listed["last_run"]["notes"] == 2 and listed["last_run"]["findings"] == 1
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert [n["note_id"] for n in batch["notes"]] == [kot]

    # The finding is flagged as Franki flags a card, and reaches the other device.
    flagged = await call(client, "flagged_cards")
    assert flagged["total"] == 1
    card = flagged["cards"][0]
    assert card["note_id"] == pies and card["reason"] == "translation" and card["note_from_user"] is None
    assert card["audit_findings"][0]["problem"] == "pies is a dog, not a cat." and card["audit_findings"][0]["check"] == "meaning"
    dumped = desktop.run("sync", "+", "dump")["dump"]
    assert any(c[1] == pies and c[16] & 7 == 7 for c in dumped["cards"])  # cards.flags

    # An edit makes a checked note due again.
    await call(client, "update_notes", updates=[{"note_id": dom, "fields": {"Meaning": "house; home"}}])
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert {n["note_id"]: n["state"] for n in batch["notes"]} == {dom: "edited", kot: "unchecked"}

    # The fix, then resolve_flag: the finding closes and the fixed note counts as checked.
    await call(client, "update_notes", updates=[{"note_id": pies, "fields": {"Meaning": "dog"}}])
    resolved = await call(client, "resolve_flag", card_ids=[card["card_id"]])
    assert resolved["audit_findings_closed"] == [pies] and resolved["notes_untagged"] == [pies]
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert pies not in {n["note_id"] for n in batch["notes"]}
    assert next(a for a in (await call(client, "list_audits"))["audits"] if a["audit"] == "card-content")["open_findings"] == 0


async def test_a_changed_check_is_due_alone_and_a_flag_cleared_elsewhere_closes_its_finding(cm, desktop, tmp_path):
    kot, pies, dom = polish_deck(desktop)
    db = tmp_path / "audits.sqlite"
    async with Client(build_server(cm, audits=AuditStore(db, definitions(tmp_path)))) as c:
        batch = await call(c, "next_audit_batch", audit="test")
        await call(c, "record_audit", audit="test", checked_by="claude", checked=[
            {"note_id": n["note_id"], "content_hash": n["content_hash"],
             "findings": [{"check": "entry", "problem": "Misspelled."}] if n["note_id"] == kot else []}
            for n in batch["notes"]])  # fmt: skip
        assert (await call(c, "next_audit_batch", audit="test"))["due"] == 0
        # The flag taken off another way (Franki, Anki, manage_cards): the finding closes, the record stays.
        cid = (await call(c, "flagged_cards"))["cards"][0]["card_id"]
        await call(c, "manage_cards", action="set_flag", card_ids=[cid], flag=0)
        assert (await call(c, "list_audits"))["audits"][0]["open_findings"] == 0

    # The meaning check's version goes up: only it is due, on every note.
    async with Client(build_server(cm, audits=AuditStore(db, definitions(tmp_path, meaning_version=2)))) as c:
        batch = await call(c, "next_audit_batch", audit="test", limit=25)
        assert batch["due"] == 3 and all(n["state"] == "check_changed" and n["checks_due"] == ["meaning"] for n in batch["notes"])
        # A field the audit doesn't read changes nothing.
        await call(c, "update_notes", updates=[{"note_id": dom, "fields": {"Notes": "Also a building."}}])
        assert all(n["state"] == "check_changed" for n in (await call(c, "next_audit_batch", audit="test", limit=25))["notes"])


def test_a_notes_state_says_why_it_is_due():
    a = audits.Audit("t", "T", "", "", ("Entry",), (audits.Check("c", 1, "other", ""),))
    assert audits._state(a, None, "h") == ("unchecked", ["c"])
    assert audits._state(a, {"c": (1, "old")}, "h") == ("edited", ["c"])
    assert audits._state(a, {"c": (1, "h")}, "h") == (None, [])
