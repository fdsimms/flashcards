"""The house style through the tools: what add_notes and update_notes tidy and refuse, what lint_notes
reports and fixes, and that the cards a note no longer makes can be cleared, all reaching Anki on another device."""

from __future__ import annotations

import json

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error

pytestmark = pytest.mark.anyio

FIELDS = ("Entry,Meaning,Context,ContextTranslation,Register,Language,PartOfSpeech,Gender,Plural,Genitive,"
          "GenerateReverse,AspectPartner,ContextLabels,KeyForms,VerbClass,Auxiliary")  # fmt: skip
GOOD = {"Entry": "Tisch", "Meaning": "table", "Context": "Der <b>Tisch</b> ist neu.", "ContextTranslation": "The table is new.",
        "Register": "neutral", "Language": "german", "PartOfSpeech": "noun", "Gender": "m", "Plural": "Tische", "Genitive": "des Tisches"}  # fmt: skip


def messy_deck(desktop) -> list[int]:
    """Four notes on the server as the older batches wrote them: an article and a numbered Meaning, an
    aspect pair, a verb the tags name, and a second note for a word the deck already has."""
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", FIELDS,
        "+", "add-fields-note", "Omnilanguage", "Español", note(
            Entry="la ficha", Meaning="1. token<br>2. index card", Context="Dame <strong>la ficha</strong>.",
            ContextTranslation="Give me the token.", Register="neutral", Language="spanish", PartOfSpeech="noun", Gender="f",
            GenerateReverse="yes"),
        "+", "add-fields-note", "Omnilanguage", "Русский", note(
            Entry="добавлять / добавить", Meaning="to add", Context="Он <b>добавлял</b> соль.<br><br>Она <b>добавила</b> соль.",
            ContextTranslation="He was adding salt.<br><br>She added salt.", Register="neutral", Language="russian",
            PartOfSpeech="verb", KeyForms="добавляю, добавляешь"),
        "+", "add-fields-note", "Omnilanguage", "Deutsch", note(
            Entry="werfen", Meaning="to throw, to toss", Context="Er <b>wirft</b> den Ball.", ContextTranslation="He throws the ball.",
            Register="neutral", Language="german"), "verb travel",
        "+", "add-fields-note", "Omnilanguage", "Español", note(
            Entry="ficha", Meaning="file", Context="Abre la <b>ficha</b>.", ContextTranslation="Open the file.",
            Register="neutral", Language="spanish", PartOfSpeech="noun", Gender="f"),
        "+", "sync",
    )["notes"]  # fmt: skip


async def test_a_new_note_is_tidied_refused_or_told_what_it_still_lacks(client, desktop):
    messy_deck(desktop)
    guide = await call(client, "note_guide", language="german")
    assert "strong" in guide["values"]["VerbClass"] and "Entry:" in guide["every_note"]
    out = await call(client, "add_notes", notes=[
        {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {**GOOD, "Entry": "der Tisch", "Meaning": "a table / a desk", "GenerateReverse": "yes"},
         "tags": ["noun", "furniture"]},
        {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {**GOOD, "Entry": "Stuhl", "Meaning": "chair", "Register": "posh",
                                                                 "Context": "Der Stuhl ist alt."}},
        {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {**GOOD, "Entry": "gehen", "Meaning": "to go", "PartOfSpeech": "verb", "Gender": "",
                                                                 "Plural": "", "Genitive": "", "Context": "Wir <b>gehen</b> nach Hause.",
                                                                 "ContextTranslation": "We are going home."}},
    ])  # fmt: skip
    first, second, third = out["results"]
    assert out["added"] == 2
    assert len(first["tidied"]) == 5 and "still_to_fill" not in first
    assert "Register is one of" in second["error"] and "Put the word in <b></b>" in second["error"] and "allow_nonstandard" in second["error"]
    assert [line.split(":")[0] for line in third["still_to_fill"]] == ["KeyForms", "VerbClass", "Auxiliary"]
    note = (await call(client, "get_notes", note_ids=[first["note_id"]]))["notes"][0]
    assert note["fields"]["Entry"] == "Tisch" and note["fields"]["Meaning"] == "table; desk"
    assert note["fields"]["GenerateReverse"] == "y" and note["tags"] == ["furniture"]
    # A deliberate exception goes in as written.
    odd = await call(client, "add_notes", allow_nonstandard=True, notes=[
        {"deck": "Deutsch", "note_type": "Omnilanguage", "fields": {**GOOD, "Entry": "Stuhl", "Register": "posh"}}])
    assert odd["added"] == 1
    # Another note type is none of its business.
    basic = await call(client, "add_notes", notes=[{"deck": "Default", "note_type": "Basic", "fields": {"Front": "1. a / b", "Back": "—"}}])
    assert basic["added"] == 1 and "tidied" not in basic["results"][0]


async def test_an_update_is_held_to_the_style_only_where_it_writes(client, desktop):
    ficha, pair, werfen, _ = messy_deck(desktop)
    out = await call(client, "update_notes", updates=[
        {"note_id": werfen, "fields": {"ContextTranslation": "He is throwing the ball."}},
        {"note_id": ficha, "fields": {"Meaning": "token / index card"}},
        {"note_id": pair, "fields": {"Register": "posh"}},
    ])
    ok, tidied, refused = out["results"]
    assert ok == {"note_id": werfen, "updated": True}
    assert tidied["updated"] and len(tidied["tidied"]) == 1
    assert "Register is one of" in refused["error"]
    notes = {n["note_id"]: n["fields"] for n in (await call(client, "get_notes", note_ids=[ficha, werfen]))["notes"]}
    # The fields it didn't write keep their old shape: that is lint_notes' job.
    assert notes[ficha]["Meaning"] == "token; index card" and notes[ficha]["Entry"] == "la ficha"
    assert notes[werfen]["Meaning"] == "to throw, to toss"


async def test_lint_reports_previews_and_applies_only_the_rules_named(client, desktop):
    ficha, pair, werfen, other = messy_deck(desktop)
    report = await call(client, "lint_notes")
    by_rule = {r["rule"]: r for r in report["rules"]}
    assert report["checked"] == 4 and "fix" not in report
    assert by_rule["entry-article"]["note_ids"] == [ficha] and by_rule["entry-article"]["fixable"]
    assert by_rule["entry-aspect-pair"]["note_ids"] == [pair]
    assert by_rule["pos-missing"]["note_ids"] == [werfen] and by_rule["pos-missing"]["level"] == "required"
    assert by_rule["grammar-gap"]["level"] == "gap" and not by_rule["grammar-gap"]["fixable"]
    assert by_rule["duplicate-entry"]["groups"] == [{"language": "spanish", "entry": "ficha", "note_ids": [ficha, other]}]
    assert "No rule called nope" in await call_error(client, "lint_notes", rules=["nope"])
    assert "Name the rules to apply" in await call_error(client, "lint_notes", fix="apply")

    preview = await call(client, "lint_notes", fix="preview")
    # The article can't come off: another note is already "ficha". Its other fixes wait with it.
    assert preview["fix"]["would_change"] == 2 and [s["note_id"] for s in preview["fix"]["skipped"]] == [ficha]
    assert preview["fix"]["samples"]["entry-aspect-pair"][0]["changes"]["Entry"] == {"from": "добавлять / добавить", "to": "добавлять"}
    assert (await call(client, "get_notes", note_ids=[pair]))["notes"][0]["fields"]["Entry"] == "добавлять / добавить"

    done = await call(client, "lint_notes", fix="apply", rules=["entry-aspect-pair", "pos-missing", "pos-in-tags", "meaning-commas",
                                                               "meaning-numbered", "switch-value", "context-markup"])  # fmt: skip
    assert done["fix"]["applied"] == 3 and done["fix"]["skipped"] == []
    desktop.run("sync")
    fields = {int(k): v for k, v in desktop.run("fields", "note:Omnilanguage")["fields"].items()}
    assert (fields[pair]["Entry"], fields[pair]["AspectPartner"], fields[pair]["ContextLabels"]) == ("добавлять", "добавить", "imperfective<br>perfective")
    assert fields[pair]["Context"] == "Он <b>добавлял</b> соль.<br>Она <b>добавила</b> соль."
    assert fields[werfen]["PartOfSpeech"] == "verb" and fields[werfen]["Meaning"] == "to throw; to toss"
    # Only the rules named: the article stays, and the rest of that note is fixed around it.
    assert fields[ficha]["Entry"] == "la ficha" and fields[ficha]["Meaning"] == "token; index card"
    assert fields[ficha]["GenerateReverse"] == "y" and fields[ficha]["Context"] == "Dame <b>la ficha</b>."
    tags = (await call(client, "get_notes", note_ids=[werfen]))["notes"][0]["tags"]
    assert tags == ["travel"]
    again = await call(client, "lint_notes", query="deck:Deutsch")
    assert again["checked"] == 1 and {r["rule"] for r in again["rules"]} == {"grammar-gap"}


async def test_cards_a_note_no_longer_makes_are_counted_then_deleted(client, desktop):
    added = await call(client, "add_notes", notes=[
        {"deck": "Default", "note_type": "Cloze", "fields": {"Text": "{{c1::Lima}} is in {{c2::Peru}}."}},
        {"deck": "Default", "note_type": "Cloze", "fields": {"Text": "{{c1::Quito}} is in {{c2::Ecuador}}."}}])
    one, two = (r["note_id"] for r in added["results"])
    before = await call(client, "empty_cards")
    await call(client, "update_notes", updates=[{"note_id": one, "fields": {"Text": "{{c1::Lima}} is in Peru."}},
                                                {"note_id": two, "fields": {"Text": "{{c1::Quito}} is in Ecuador."}}])  # fmt: skip
    found = await call(client, "empty_cards")
    assert found["empty"] == before["empty"] + 2 and found["never_reviewed"] == before["never_reviewed"] + 2 and "deleted" not in found
    assert {"note_type": "Cloze", "card_type": "Cloze", "cards": found["empty"]} in found["by_kind"]
    assert len((await call(client, "get_notes", note_ids=[one]))["notes"][0]["cards"]) == 2
    gone = await call(client, "empty_cards", apply=True)
    assert gone["deleted"] == found["never_reviewed"]
    assert len((await call(client, "get_notes", note_ids=[one]))["notes"][0]["cards"]) == 1
    assert (await call(client, "empty_cards"))["empty"] == found["reviewed"]
    desktop.run("sync")
    cards = [c for c in desktop.run("dump")["dump"]["cards"] if c[1] in (one, two)]
    assert len(cards) == 2
