"""Filling Omnilanguage's Stress field from kaikki.org: which words, what it writes, and that it reaches Anki on another device."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from anki.collection import Collection  # noqa: F401 - first, for the anki package's imports
from conftest import call
from franki_mcp import forms, stress
from franki_mcp.server import build_server
from mcp import Client
from test_forms import Files

pytestmark = pytest.mark.anyio

KAIKKI = Path(__file__).parent / "kaikki"
VOZDUH = (KAIKKI / "воздух.jsonl").read_text(encoding="utf-8")


def page(*canonical: str) -> str:
    return "\n".join(json.dumps({"word": "x", "forms": [{"form": c, "tags": ["canonical"]}]}) for c in canonical)


def test_reads_the_canonical_form_of_the_words_page():
    assert stress.stressed_form(VOZDUH, "воздух") == "во\u0301здух"
    assert stress.stressed_form(VOZDUH, "Воздух") == "во\u0301здух"
    assert stress.stressed_form("", "воздух") is None


def test_a_word_stressed_two_ways_is_left_alone():
    assert stress.stressed_form(page("за\u0301мок", "замо\u0301к"), "замок") is None
    assert stress.stressed_form(page("за\u0301мок", "за\u0301мок"), "замок") == "за\u0301мок"
    # Another word's form, or one with no mark, says nothing.
    assert stress.stressed_form(page("во\u0301здуха", "замок"), "замок") is None


def test_only_a_single_word_with_a_choice_of_vowel_needs_a_mark():
    assert stress.needs_mark("говорить")
    assert not stress.needs_mark("дом")
    assert not stress.needs_mark("ёлка")
    assert not stress.needs_mark("дом и сад")
    assert not stress.needs_mark("")


def test_the_limit_counts_marks_found_and_stops_reading_pages_there():
    candidates = [stress.Candidate(1, "редкость"), stress.Candidate(2, "Воздух"), stress.Candidate(3, "воздух")]
    read: list[str] = []

    def page_of(word: str) -> str:
        read.append(word)
        return VOZDUH if word.casefold() == "воздух" else ""

    got = stress.plan(candidates, page_of, 1)
    # The note's own capital is kept.
    assert [(p.note_id, p.stress) for p in got.filled] == [(2, "Во\u0301здух")]
    assert got.not_found == ["редкость"] and got.remaining == 1
    assert read == ["редкость", "Воздух"]


async def test_previews_then_fills_and_the_mark_reaches_another_device(cm, desktop, tmp_path):
    note = lambda **f: json.dumps(f)  # noqa: E731
    vozduh, dom, redkost, haus = desktop.run(
        "add-notetype", "Omnilanguage", "Entry,Meaning,Language,Stress",
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="воздух", Meaning="air", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="дом", Meaning="house", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "Русский", note(Entry="редкость", Meaning="rarity", Language="russian"),
        "+", "add-fields-note", "Omnilanguage", "Deutsch", note(Entry="Haus", Meaning="house", Language="german"),
        "+", "sync",
    )["notes"]
    files = Files()
    async with Client(build_server(cm, unimorph=forms.UniMorph(tmp_path / "unimorph", files))) as c:
        preview = await call(c, "fill_stress")
        assert preview["would_fill"] == [{"note_id": vozduh, "word": "воздух", "stress": "во\u0301здух"}]
        assert preview["written"] == 0 and preview["not_found"] == ["редкость"]
        assert desktop.run("sync", "+", "fields", f"nid:{vozduh}")["fields"][str(vozduh)]["Stress"] == ""
        done = await call(c, "fill_stress", dry_run=False)
        again = await call(c, "fill_stress", dry_run=False)
    assert done["written"] == 1 and again["written"] == 0
    # Only Russian words that can take a mark were looked up: not the one-vowel word, not the German one.
    assert not [u for u in files.fetched if "Haus" in u or "%D0%B4%D0%BE%D0%BC." in u]
    out = desktop.run("sync", "+", "fields", f"nid:{vozduh} OR nid:{dom} OR nid:{redkost} OR nid:{haus}")["fields"]
    assert out[str(vozduh)]["Stress"] == "во\u0301здух"
    assert out[str(dom)]["Stress"] == "" and out[str(redkost)]["Stress"] == "" and out[str(haus)]["Stress"] == ""
