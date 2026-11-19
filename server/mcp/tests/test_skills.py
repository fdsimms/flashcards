"""Skill cards: the settings Franki and the MCP share, adding the cards by tool and by the hourly job, and pausing, against a real Anki server."""

from __future__ import annotations

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import skills

pytestmark = pytest.mark.anyio

THAI = skills.CATALOG["languages"]["th"]
ALL = sum(len(g["notes"]) for g in THAI["groups"])
LATER = sum(1 for g in THAI["groups"] for n in g["notes"] if n["suspended"])


def test_a_deck_name_means_the_language_the_app_reads_from_it():
    assert [skills.language_of_deck(n) for n in ("Thai", "🐟 Norsk", "Deutsch::Verbs", "Trivia", "Italiano")] == ["th", "nb", "de", None, None]


def test_settings_are_read_as_the_app_reads_them():
    s = skills._settings_of({"auto": True, "off": ["money", "nope", 3]})
    assert s == skills.Settings(on=True, auto=True, off=("money",))
    assert skills._settings_of("junk") == skills.Settings() == skills._settings_of(None)


async def count(cm, query: str) -> int:
    return await cm.read(lambda col: len(col.find_cards(query)))


@pytest.fixture
def thai(desktop):
    desktop.run("add-deck", "Thai", "+", "sync")


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
    assert done == {"deck": "Thai::Skills", "added": ALL, "skipped": 0}
    assert await count(cm, '"deck:Thai::Skills" tag:skill') == ALL
    assert await count(cm, "tag:skill is:suspended") == LATER
    again = await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    assert again["added"] == 0
    assert (await call(client, "skill_cards", deck="Thai"))["decks"][0]["missing"] == 0


async def test_pausing_suspends_every_card_and_resuming_leaves_a_later_step_waiting(client, cm, thai, desktop):
    await call(client, "add_skill_cards", deck="Thai", dry_run=False)
    paused = await call(client, "set_skill_cards", deck="Thai", on=False)
    assert paused["on"] is False and paused["cards_changed"] == ALL - LATER
    assert await count(cm, "tag:skill is:suspended") == ALL
    assert "paused" in await call_error(client, "add_skill_cards", deck="Thai")
    resumed = await call(client, "set_skill_cards", deck="Thai", on=True)
    assert resumed["cards_changed"] == ALL - LATER
    assert await count(cm, "tag:skill is:suspended") == LATER
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
    assert await skills.auto_add(cm) == ALL - money
    assert await skills.auto_add(cm) == 0
    # Switching the skill on is all it takes for its cards to come.
    await call(client, "set_skill_cards", deck="Thai", skills_off=[])
    assert await skills.auto_add(cm) == money
    # A paused deck gets nothing, and nothing is added to a deleted card's place after pausing.
    await call(client, "set_skill_cards", deck="Thai", on=False)
    await cm.write(lambda col: col.remove_notes(col.find_notes("tag:skill::consonants")))
    assert await skills.auto_add(cm) == 0
    await call(client, "set_skill_cards", deck="Thai", on=True)
    assert await skills.auto_add(cm) > 0
