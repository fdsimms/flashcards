"""Content audits: what's due, what record_audit keeps and flags, how flagged_cards and resolve_flag carry a
note's finding to its fix (the flag reaching Anki on another device), and Read & Listen's grammar pages and
texts audited through a scripted Read & Listen server."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
import httpx
from conftest import call, call_error
from franki_mcp import audits
from franki_mcp.audits import AuditStore, load_definitions
from franki_mcp.reader import ReaderClient, ReaderSettings
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
    assert set(found) >= {"card-content", "leech-review", "overlaps", "grammar-pages", "texts"}
    assert found["texts"].sample and found["texts"].batch_max == 5 and found["grammar-pages"].source == "grammar_pages"
    assert {c.id for c in found["card-content"].checks} >= {"meaning", "sense", "context"}
    # The reasons Franki's flag sheet offers, as src/core/agentFlag.ts spells them.
    app = re.findall(r"slug: '([a-z]+)'", (REPO / "src/core/agentFlag.ts").read_text())
    assert tuple(app) == FLAG_REASONS


@pytest.mark.parametrize(("change", "message"), [
    (('"typo"', '"spelling"'), "flag_reason"),
    (('scope = "note:Omnilanguage"', 'source = "texts"'), "only a note can be flagged"),
    (('scope = "note:Omnilanguage"', 'source = "essays"'), "source"),
    (('scope = "note:Omnilanguage"', ""), "needs a scope and fields"),
])  # fmt: skip
def test_a_malformed_definition_stops_the_server_from_starting(tmp_path, change, message):
    (tmp_path / "bad.toml").write_text(TWO_CHECKS.replace("{meaning}", "1").replace(*change))
    with pytest.raises(ValueError, match=message):
        load_definitions(tmp_path)


async def test_a_batch_is_recorded_flagged_fixed_and_counted(client, desktop):
    kot, pies, dom = (str(n) for n in polish_deck(desktop))
    audits_listed = (await call(client, "list_audits", deck="Polski"))["audits"]
    listed = next(a for a in audits_listed if a["audit"] == "card-content")
    assert listed["items"] == 3 and listed["checked"] == 0 and listed["due"]["unchecked"] == 3 and listed["last_run"] is None
    # Read & Listen isn't connected here: its audits say so rather than failing the list.
    assert "isn't connected" in next(a for a in audits_listed if a["audit"] == "texts")["unavailable"]

    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski", limit=2)
    assert batch["due"] == 3 and len(batch["items"]) == 2 and {c["id"] for c in batch["checks"]} >= {"meaning", "sense"}
    first = batch["items"][0]
    assert first["state"] == "unchecked" and first["deck"] == "Polski" and "Sense" not in first["fields"]  # empty fields left out
    hashes = {n["item_id"]: n["content_hash"] for n in batch["items"]}
    assert set(hashes) == {dom, pies}  # newest first, when nothing has lapsed

    # A wrong hash and an unknown check are refused, one note at a time.
    out = await call(client, "record_audit", audit="card-content", checked_by="claude", checked=[
        {"item_id": dom, "content_hash": "0" * 16},
        {"item_id": pies, "content_hash": hashes[pies], "findings": [{"check": "nonsense", "problem": "x"}]},
    ])
    assert out["recorded"] == 0 and "changed since" in out["results"][0]["reason"] and "no check nonsense" in out["results"][1]["reason"]
    assert "checked_by" in await call_error(client, "record_audit", audit="card-content", checked_by=" ", checked=[])
    assert "no audit called" in await call_error(client, "next_audit_batch", audit="nope")

    out = await call(client, "record_audit", audit="card-content", checked_by="claude", checked=[
        {"item_id": dom, "content_hash": hashes[dom]},
        {"item_id": pies, "content_hash": hashes[pies],
         "findings": [{"check": "meaning", "problem": "pies is a dog, not a cat.", "suggestion": "Meaning: dog"}]},
    ])
    assert out["recorded"] == 2 and out["results"][1]["flagged"]

    listed = next(a for a in (await call(client, "list_audits", deck="Polski"))["audits"] if a["audit"] == "card-content")
    assert listed["checked"] == 2 and listed["due"]["unchecked"] == 1 and listed["open_findings"] == 1
    assert listed["last_run"]["checked_by"] == "claude" and listed["last_run"]["items"] == 2 and listed["last_run"]["findings"] == 1
    assert listed["by_month"][0]["items"] == 2 and listed["by_month"][0]["findings_per_item"] == 0.5
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert [n["item_id"] for n in batch["items"]] == [kot]

    # The finding is flagged as Franki flags a card, and reaches the other device.
    flagged = await call(client, "flagged_cards")
    assert flagged["total"] == 1
    card = flagged["cards"][0]
    assert card["note_id"] == int(pies) and card["reason"] == "translation" and card["note_from_user"] is None
    assert card["audit_findings"][0]["problem"] == "pies is a dog, not a cat." and card["audit_findings"][0]["check"] == "meaning"
    dumped = desktop.run("sync", "+", "dump")["dump"]
    assert any(c[1] == int(pies) and c[16] & 7 == 7 for c in dumped["cards"])  # cards.flags
    # It's listed with the rest, but closes only with resolve_flag, which takes the flag off too.
    [finding] = (await call(client, "audit_findings"))["findings"]
    assert finding["item_id"] == pies
    assert "resolve_flag" in await call_error(client, "close_audit_findings", finding_ids=[finding["finding_id"]], how="fixed")

    # An edit makes a checked note due again.
    await call(client, "update_notes", updates=[{"note_id": int(dom), "fields": {"Meaning": "house; home"}}])
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert {n["item_id"]: n["state"] for n in batch["items"]} == {dom: "changed", kot: "unchecked"}

    # The fix, then resolve_flag: the finding closes and the fixed note counts as checked.
    await call(client, "update_notes", updates=[{"note_id": int(pies), "fields": {"Meaning": "dog"}}])
    resolved = await call(client, "resolve_flag", card_ids=[card["card_id"]])
    assert resolved["audit_findings_closed"] == [int(pies)] and resolved["notes_untagged"] == [int(pies)]
    batch = await call(client, "next_audit_batch", audit="card-content", deck="Polski")
    assert pies not in {n["item_id"] for n in batch["items"]}
    assert (await call(client, "audit_findings"))["findings"] == []


async def test_a_changed_check_is_due_alone_and_a_flag_cleared_elsewhere_closes_its_finding(cm, desktop, tmp_path):
    kot, pies, dom = (str(n) for n in polish_deck(desktop))
    db = tmp_path / "audits.sqlite"
    async with Client(build_server(cm, audits=AuditStore(db, definitions(tmp_path)))) as c:
        batch = await call(c, "next_audit_batch", audit="test")
        await call(c, "record_audit", audit="test", checked_by="claude", checked=[
            {"item_id": n["item_id"], "content_hash": n["content_hash"],
             "findings": [{"check": "entry", "problem": "Misspelled."}] if n["item_id"] == kot else []}
            for n in batch["items"]])  # fmt: skip
        assert (await call(c, "next_audit_batch", audit="test"))["due"] == 0
        # The flag taken off another way (Franki, Anki, manage_cards): the finding closes, the record stays.
        cid = (await call(c, "flagged_cards"))["cards"][0]["card_id"]
        await call(c, "manage_cards", action="set_flag", card_ids=[cid], flag=0)
        assert (await call(c, "list_audits"))["audits"][0]["open_findings"] == 0

    # The meaning check's version goes up: only it is due, on every note.
    async with Client(build_server(cm, audits=AuditStore(db, definitions(tmp_path, meaning_version=2)))) as c:
        batch = await call(c, "next_audit_batch", audit="test", limit=25)
        assert batch["due"] == 3 and all(n["state"] == "check_changed" and n["checks_due"] == ["meaning"] for n in batch["items"])
        # A field the audit doesn't read changes nothing.
        await call(c, "update_notes", updates=[{"note_id": int(dom), "fields": {"Notes": "Also a building."}}])
        assert all(n["state"] == "check_changed" for n in (await call(c, "next_audit_batch", audit="test", limit=25))["items"])


class FakeReader:
    """Read & Listen's audit routes, as the tests need them: two grammar pages (one still being written)
    and seven texts."""

    def __init__(self):
        self.topic = {"kind": "topic", "id": "4", "language": "th", "title": "Two verbs", "status": "ready", "digest": "d1"}
        self.writing = {"kind": "point", "id": "th.ever", "language": "th", "title": "เคย", "status": "writing", "digest": "d2"}
        self.texts = [{"id": i, "language": "th", "title": f"Text {i}"} for i in range(1, 8)]
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        path = request.url.path
        if path == "/api/audit/grammar":
            return httpx.Response(200, json=[self.topic, self.writing])
        if path == "/api/audit/grammar/topic/4":
            return httpx.Response(200, json={**self.topic, "lead": "Lead.", "examples": []})
        if path == "/api/audit/texts":
            return httpx.Response(200, json=self.texts)
        if path.startswith("/api/audit/texts/"):
            return httpx.Response(200, json={"id": int(path.rsplit("/", 1)[1]), "lines": []})
        return httpx.Response(404, json={"detail": "Not Found"})


async def test_grammar_pages_and_texts_are_audited_from_read_and_listen(cm, tmp_path):
    fake = FakeReader()
    reader = ReaderClient(ReaderSettings("http://reader:8080", "pass"), httpx.AsyncClient(transport=httpx.MockTransport(fake)))
    async with Client(build_server(cm, reader=reader, audits=AuditStore(tmp_path / "audits.sqlite"))) as c:
        listed = {a["audit"]: a for a in (await call(c, "list_audits", language="th"))["audits"]}
        assert listed["grammar-pages"]["items"] == 1  # the page still being written has nothing to check
        assert listed["texts"]["items"] == 7 and listed["texts"]["window_days"] == 30
        texts_asked = next(r for r in fake.seen if r.url.path == "/api/audit/texts")
        assert texts_asked.url.params["days"] == "30" and texts_asked.url.params["language"] == "th"

        batch = await call(c, "next_audit_batch", audit="grammar-pages")
        [page] = batch["items"]
        assert page["item_id"] == "topic:4" and page["content"]["lead"] == "Lead."
        out = await call(c, "record_audit", audit="grammar-pages", checked_by="claude", checked=[
            {"item_id": "topic:4", "content_hash": page["content_hash"],
             "findings": [{"check": "rule", "problem": "The second verb isn't always bare."}]}])  # fmt: skip
        assert out["recorded"] == 1 and "flagged" not in out["results"][0]
        [finding] = (await call(c, "audit_findings", audit="grammar-pages"))["findings"]
        assert finding["item_id"] == "topic:4" and finding["check"] == "rule"

        # A page written again is due again.
        fake.topic["digest"] = "d3"
        assert [i["state"] for i in (await call(c, "next_audit_batch", audit="grammar-pages"))["items"]] == ["changed"]
        assert "No finding 999" in await call_error(c, "close_audit_findings", finding_ids=[999], how="fixed")
        closed = await call(c, "close_audit_findings", finding_ids=[finding["finding_id"]], how="dismissed")
        assert closed == {"closed": 1, "already_closed": []}
        assert (await call(c, "audit_findings"))["findings"] == []

        # Texts are a sample: at most five at a time, at random, and a text once checked is never due again.
        batch = await call(c, "next_audit_batch", audit="texts", limit=25)
        assert batch["due"] == 7 and len(batch["items"]) == 5 and all(i["content"]["lines"] == [] for i in batch["items"])
        await call(c, "record_audit", audit="texts", checked_by="claude", checked=[
            {"item_id": i["item_id"], "content_hash": i["content_hash"]} for i in batch["items"]])
        assert (await call(c, "next_audit_batch", audit="texts"))["due"] == 2


def test_an_items_state_says_why_it_is_due():
    a = audits.Audit("t", "T", "", "notes", (audits.Check("c", 1, "other", ""),), "", ("Entry",))
    assert audits._state(a, None, "h") == ("unchecked", ["c"])
    assert audits._state(a, {"c": (1, "old")}, "h") == ("changed", ["c"])
    assert audits._state(a, {"c": (1, "h")}, "h") == (None, [])
