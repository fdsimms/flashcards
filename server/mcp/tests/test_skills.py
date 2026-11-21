"""Skill cards: the settings Franki and the MCP share, adding the cards by tool and by the hourly job, and pausing, against a real Anki server."""

from __future__ import annotations

import json

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import skills

pytestmark = pytest.mark.anyio

THAI = skills.CATALOG["languages"]["th"]
ALL = sum(len(g["notes"]) for g in THAI["groups"])
LATER = sum(1 for g in THAI["groups"] for n in g["notes"] if n["suspended"])
WORDS = len({w["fields"]["Entry"] for g in THAI["groups"] for w in g["words"]})  # a hundred serves numbers and money
# Anki's `tag:skill` also matches `skill::words`, so a count of the skill cards leaves the words out.
CARDS = "tag:skill -tag:skill::words"


def test_a_deck_name_means_the_language_the_app_reads_from_it():
    # The examples and the app's answers come from the catalog (`deckExamples`), so the two readings can't drift.
    examples = skills.CATALOG["deckExamples"]
    assert examples
    assert [(n, skills.language_of_deck(n)) for n, _ in examples] == [(n, lang) for n, lang in examples]


def test_settings_are_read_as_the_app_reads_them():
    s = skills._settings_of({"auto": True, "off": ["money", "nope", 3]})
    assert s == skills.Settings(on=True, auto=True, off=("money",))
    assert skills._settings_of("junk") == skills.Settings() == skills._settings_of(None)


async def count(cm, query: str) -> int:
    return await cm.read(lambda col: len(col.find_cards(query)))


@pytest.fixture
def thai(desktop):
    desktop.run("add-deck", "Thai", "+", "add-notetype", "Omnilanguage", "Entry,Meaning,Language,PartOfSpeech,GenerateReverse", "+", "sync")


async def test_lists_the_decks_with_skills_and_what_each_lacks(client, thai):
    out = await call(client, "skill_cards")
    # The fixture has a Thai deck of its own under "Languages"; its parent names no language, so it's a top deck too.
    assert [d["deck"] for d in out["decks"]] == ["Thai", "👅 Languages::🐘 ภาษาไทย"]
    d = out["decks"][0]
    assert (d["on"], d["auto"], d["missing"]) == (True, False, ALL)
    assert {s["id"] for s in d["skills"]} == {g["id"] for g in THAI["groups"]}
    assert "no language" in await call_error(client, "skill_cards", deck="Default")


async def test_adding_previews_then_writes_with_later_steps_suspended(client, cm, thai):
    preview = await call(client, "add_skill_cards", deck="Thai")
    assert preview["written"] == 0 and await count(cm, "tag:skill") == 0
    done = await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    assert done == {"deck": "Thai::Skills", "added": ALL, "words": WORDS, "words_skipped": 0, "skipped": 0}
    assert await count(cm, f'"deck:Thai::Skills" {CARDS}') == ALL
    assert await count(cm, CARDS + " is:suspended") == LATER
    again = await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    assert again["added"] == 0 and again["words"] == 0
    state = (await call(client, "skill_cards", deck="Thai"))["decks"][0]
    assert (state["missing"], state["words_missing"]) == (0, 0)


async def test_pausing_suspends_every_card_and_resuming_leaves_a_later_step_waiting(client, cm, thai, desktop):
    await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    paused = await call(client, "set_skill_cards", deck="Thai", on=False)
    assert paused["on"] is False and paused["cards_changed"] == ALL - LATER
    assert await count(cm, CARDS + " is:suspended") == ALL
    # The words are the deck's own, not skill cards: pausing leaves them to be studied.
    assert await count(cm, "tag:skill::words is:suspended") == 0
    assert "paused" in await call_error(client, "add_skill_cards", deck="Thai")
    resumed = await call(client, "set_skill_cards", deck="Thai", on=True)
    assert resumed["cards_changed"] == ALL - LATER
    assert await count(cm, CARDS + " is:suspended") == LATER
    # The setting reaches Anki on the other device, under the key Franki reads.
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        assert col.get_config(skills.SKILL_CARDS_KEY, None) == {}  # the defaults leave no entry
    finally:
        col.close()


async def test_settings_are_saved_in_the_collection_for_franki(client, desktop, thai):
    await call(client, "set_skill_cards", deck="Thai", auto=True, skills_off=["money"])
    desktop.run("sync")
    col = Collection(str(desktop.path))
    try:
        saved = col.get_config(skills.SKILL_CARDS_KEY, None)
        assert saved == {str(col.decks.id_for_name("Thai")): {"on": True, "auto": True, "off": ["money"]}}
    finally:
        col.close()
    assert "no skill 'nope'" in await call_error(client, "set_skill_cards", deck="Thai", skills_off=["nope"])


async def test_the_hourly_job_adds_only_for_decks_that_are_on_and_automatic(client, cm, thai):
    assert await skills.auto_add(cm) == 0  # automatic is off by default
    await call(client, "set_skill_cards", deck="Thai", auto=True, skills_off=["money"])
    money = len(next(g for g in THAI["groups"] if g["id"] == "money")["notes"])
    # The words of the skills that are on: money's currency waits for money.
    others = {w["fields"]["Entry"] for g in THAI["groups"] if g["id"] != "money" for w in g["words"]}
    assert await skills.auto_add(cm) == ALL - money + len(others)
    assert await skills.auto_add(cm) == 0
    # Switching the skill on is all it takes for its cards to come.
    await call(client, "set_skill_cards", deck="Thai", skills_off=[])
    assert await skills.auto_add(cm) == money + (WORDS - len(others))
    # A paused deck gets nothing, and nothing is added to a deleted card's place after pausing.
    await call(client, "set_skill_cards", deck="Thai", on=False)
    await cm.write(lambda col: col.remove_notes(col.find_notes("tag:skill::consonants")))
    assert await skills.auto_add(cm) == 0
    await call(client, "set_skill_cards", deck="Thai", on=True)
    assert await skills.auto_add(cm) > 0


async def test_the_words_a_skill_needs_are_added_as_notes_in_the_skills_subdeck(client, cm, thai):
    await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    month = await cm.read(lambda col: col.get_note(col.find_notes('"note:Omnilanguage" Entry:มกราคม')[0]))
    assert (month["Meaning"], month["Language"], month["PartOfSpeech"], month["GenerateReverse"]) == ("January", "thai", "noun", "y")
    assert month.tags == ["skill::words"]
    assert await count(cm, '"deck:Thai::Skills" tag:skill::words') == WORDS
    # The first dates step waits for the words to be studied, as the later ones wait for the step before.
    waiting = await cm.read(lambda col: [col.get_note(n).tags for n in col.find_notes(CARDS + " is:suspended")])
    assert any("skill::drill::dates-day" in tags for tags in waiting)


async def test_a_word_the_deck_already_has_is_not_added_again(client, cm, desktop):
    fields = json.dumps({"Entry": "มกราคม", "Meaning": "January", "Language": "thai"})
    desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language,PartOfSpeech,GenerateReverse", "+",
        "add-fields-note", "Omnilanguage", "Thai::Tier 1", fields, "+", "sync",
    )
    # In another subdeck of the language's deck, studied or not, it counts as the deck having it.
    assert (await call(client, "skill_cards", deck="Thai"))["decks"][0]["words_missing"] == WORDS - 1
    done = await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    assert done["words"] == WORDS - 1
    assert await count(cm, "Entry:มกราคม") == 1


async def test_without_the_note_type_for_words_the_cards_are_added_and_the_words_reported(client, cm, desktop):
    desktop.run("add-deck", "Thai", "+", "sync")  # no Omnilanguage note type here
    done = await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    assert (done["added"], done["words"], done["words_skipped"]) == (ALL, 0, WORDS)
    assert await count(cm, "note:Omnilanguage") == 0
    # The hourly job has nothing it could write, so it doesn't wake the collection every hour.
    await call(client, "set_skill_cards", deck="Thai", auto=True)
    assert await skills.auto_add(cm) == 0
    assert await cm.read(skills._work) == []


async def test_a_word_another_language_spells_the_same_is_still_added(client, cm, desktop):
    # "mars" in French and Norwegian: Anki allows the duplicate, and the Norwegian deck still lacks its word.
    fields = json.dumps({"Entry": "มกราคม", "Meaning": "January", "Language": "other"})
    desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language,PartOfSpeech,GenerateReverse", "+",
        "add-fields-note", "Omnilanguage", "Elsewhere", fields, "+", "add-deck", "Thai", "+", "sync",
    )
    assert (await call(client, "skill_cards", deck="Thai"))["decks"][0]["words_missing"] == WORDS
    assert (await call(client, "add_skill_cards", deck="Thai", dry_run=False))["words"] == WORDS
    assert await count(cm, "Entry:มกราคม") == 2
