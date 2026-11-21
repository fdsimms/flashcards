"""check_words: which words the collection already has, matched by the forms each note lists."""

from __future__ import annotations

import json

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call, call_error
from franki_mcp import known_words
from franki_mcp.known_words import Index, keys, normalized, status

pytestmark = pytest.mark.anyio


def test_a_word_is_compared_without_case_punctuation_articles_or_stress():
    assert normalized("  ¿<b>Dónde</b>?  ", "spanish") == "dónde"
    assert normalized("«Приве\u0301т!»", "russian") == "привет"
    assert keys("die Katze,", "german") == {"die katze", "katze"}
    assert keys("l’homme", "french") == {"l’homme", "homme"}
    # A lone article is a word of its own, and another language's article isn't taken off.
    assert keys("die", "german") == {"die"}
    assert keys("en fait", "spanish") == {"en fait"}


def test_thai_tone_marks_and_vowel_signs_at_a_words_end_stay():
    assert normalized("ไม่", "thai") == "ไม่"
    assert normalized("กลับ.", "thai") == "กลับ"


def index(*notes: dict[str, str], language: str = "german") -> Index:
    i = Index()
    for nid, fields in enumerate(notes, start=1):
        i.add(nid, fields, language)
    return i


def test_a_form_the_note_lists_finds_it_and_the_entry_comes_first():
    i = index(
        {"Entry": "abwerfen", "KeyForms": "pattern: Strong, separable.<br>past: warf ab<br>perfect: hat abgeworfen"},
        {"Entry": "der Tisch", "Plural": "Tische", "Genitive": "des Tisches"},
        {"Entry": "warf ab"},
    )
    assert i.look_up("warf ab", "german") == [(3, "entry"), (1, "form")]
    assert i.look_up("Tisches", "german") == [(2, "form")]
    assert i.look_up("Tische", "german") == [(2, "form")]
    assert i.look_up("Tisch", "german") == [(2, "entry")]
    # KeyForms' description lines aren't forms.
    assert i.look_up("strong, separable", "german") == []


def test_the_forms_table_and_its_alternatives_are_matched_without_a_bracket():
    i = index({"Entry": "esperar", "Forms": "present · yo: espero<br>preterite · tú: esperaste / esperastes (rare)"},
              language="spanish")
    assert i.look_up("esperaste", "spanish") == [(1, "form")]
    assert i.look_up("esperastes", "spanish") == [(1, "form")]
    assert i.look_up("espero", "spanish") == [(1, "form")]


def test_a_dash_meaning_no_such_form_is_not_a_form():
    i = index({"Entry": "Obst", "Plural": "-"})
    assert i.look_up("-", "german") == []


def test_an_aspect_partner_is_reported_as_the_partner_not_the_word():
    i = index({"Entry": "czekać", "AspectPartner": "poczekać"}, language="polish")
    assert i.look_up("poczekać", "polish") == [(1, "aspect partner")]


def test_a_japanese_word_is_found_by_its_reading():
    i = index({"Entry": "割り込む", "KanaReading": "わりこむ"}, language="japanese")
    assert i.look_up("わりこむ", "japanese") == [(1, "form")]
    assert i.look_up("割り込む。", "japanese") == [(1, "entry")]


def test_a_phrase_with_no_note_reports_the_words_in_it_that_have_one():
    i = index({"Entry": "die Luft"}, {"Entry": "gehen", "KeyForms": "past: ging"}, {"Entry": "in die Luft gehen"})
    assert i.look_up("in die Luft ging", "german") == [(1, "part of phrase"), (2, "part of phrase")]


def test_a_single_word_with_no_note_reports_a_few_phrases_that_use_it():
    i = index(*({"Entry": f"Luft {n}"} for n in range(5)))
    assert i.look_up("Luft", "german") == [(n, "in phrase") for n in range(1, known_words.MAX_PHRASES + 1)]


def card(stage: str, interval: int = 0) -> dict:
    return {"stage": stage, "interval_days": interval}


def test_status_is_the_furthest_along_of_the_cards_not_suspended():
    assert status([card("new"), card("review", 30)]) == "mature"
    assert status([card("review", 5), card("learning")]) == "young"
    assert status([card("relearning"), card("new")]) == "learning"
    assert status([card("new"), card("suspended")]) == "new"
    assert status([card("suspended"), card("suspended")]) == "suspended"
    assert status([card("new"), card("buried")]) == "buried"
    assert status([]) == "no cards"


def omni(desktop) -> list[int]:
    note = lambda **f: json.dumps(f)  # noqa: E731
    return desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language,KeyForms,Plural",
        "+", "add-fields-note", "Omnilanguage", "Deutsch",
        note(Entry="abwerfen", Meaning="to throw off", Language="german", KeyForms="past: warf ab"), "source::some-game",
        "+", "add-fields-note", "Omnilanguage", "Deutsch", note(Entry="Tisch", Meaning="table", Language="german", Plural="Tische"),
        # Another language's word spelled the same isn't the German one.
        "+", "add-fields-note", "Omnilanguage", "Norsk", note(Entry="Tisch", Meaning="made up", Language="norwegian"),
        "+", "sync",
    )["notes"]


async def test_says_which_words_are_in_the_collection_and_how_well_each_is_known(client, desktop):
    abwerfen, tisch, _ = omni(desktop)
    out = await call(client, "check_words", language="Deutsch", words=["warf ab", "Tische", "Schadenfreude"])
    assert out["language"] == "german" and out["notes_searched"] == 2
    assert out["in_collection"] == 2 and out["not_in_collection"] == 1
    first, second, third = out["words"]
    assert [(m["note_id"], m["matched"]) for m in first["matches"]] == [(abwerfen, "form")]
    match = first["matches"][0]
    assert match["entry"] == "abwerfen" and match["meaning"] == "to throw off" and match["deck"] == "Deutsch"
    assert match["tags"] == ["source::some-game"] and match["status"] == "new"
    assert match["cards"][0]["stage"] == "new" and match["cards"][0]["lapses"] == 0
    assert [m["note_id"] for m in second["matches"]] == [tisch]
    assert third == {"word": "Schadenfreude", "matches": []}


async def test_a_deck_limits_the_search(client, desktop):
    omni(desktop)
    desktop.run("add-fields-note", "Omnilanguage", "Deutsch::Spiel", json.dumps({"Entry": "Schwert", "Language": "german"}), "+", "sync")
    out = await call(client, "check_words", language="german", words=["Schwert", "Tisch"], deck="Deutsch::Spiel")
    assert out["notes_searched"] == 1 and out["in_collection"] == 1
    assert [len(w["matches"]) for w in out["words"]] == [1, 0]


async def test_refuses_what_it_cant_answer(client, desktop):
    assert "isn't a language" in await call_error(client, "check_words", language="klingon", words=["Qapla'"])
    assert "no Omnilanguage note type" in await call_error(client, "check_words", language="german", words=["Tisch"])
    omni(desktop)
    assert "at least one word" in await call_error(client, "check_words", language="german", words=[])
    assert "Up to 200" in await call_error(client, "check_words", language="german", words=["x"] * 201)
    assert "no deck called" in await call_error(client, "check_words", language="german", words=["Tisch"], deck="Nope")
