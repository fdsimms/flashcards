"""A noun's article for its recording: the rules, and that they match src/core/gender.ts."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from franki_mcp.articles import ARTICLES, LANGUAGE_CODES, VERB_MARKERS, _LEADING, article_for, marker_for, with_article

GENDER_TS = Path(__file__).resolve().parents[3] / "src" / "core" / "gender.ts"


def test_the_article_its_gender_gives():
    assert article_for("german", "f", "Einstellung") == "die"
    assert article_for("Spanish", " M ", "blindaje") == "el"
    assert article_for("norwegian", "n", "hus") == "et"
    assert article_for("greek", "f", "γειτονιά") == "η"
    assert article_for("french", "m", "morceau") == "le"


def test_french_elides_before_a_vowel_and_writes_it_with_no_space():
    assert article_for("french", "f", "amertume") == "l'"
    assert article_for("french", "m", "étui") == "l'"
    assert with_article("l'", "amertume") == "l'amertume"
    assert with_article("le", "morceau") == "le morceau"


def test_an_entry_that_has_its_own_article_gets_no_second():
    for language, gender, entry in [
        ("spanish", "f", "el agua"), ("spanish", "m", "los modales"), ("french", "m", "l'homme"),
        ("french", "f", "les tripes"), ("german", "m", "der Anwalt / die Anwältin"), ("norwegian", "f", "en bok"),
        ("greek", "n", "τα δεδομένα"),
    ]:  # fmt: skip
        assert article_for(language, gender, entry) is None, entry


def test_nothing_for_no_gender_a_two_gender_noun_or_a_language_that_says_none():
    assert article_for("german", "", "Tisch") is None
    assert article_for("german", "m/f", "Tisch") is None
    assert article_for("spanish", "n", "x") is None
    assert article_for("polish", "m", "mężczyzna") is None  # ten is a reminder, never said
    assert article_for("russian", "f", "кошка") is None
    assert article_for("thai", "m", "x") is None


def _ts() -> str:
    if not GENDER_TS.exists():
        pytest.skip("src/core/gender.ts isn't beside the MCP (the image holds server/ only)")
    return GENDER_TS.read_text()


def test_the_table_matches_the_apps():
    ts = _ts()
    block = re.search(r"const GENDER_PREFIXES[^=]*=\s*\{(.*?)\n\};", ts, re.S)
    assert block
    app: dict[str, dict[str, str]] = {}
    for lang, body in re.findall(r"^\s*(\w+): \{ ([^}]*) \},?$", block.group(1), re.M):
        app[lang] = dict(re.findall(r"(\w+): '([^']+)'", body))
    spoken = re.search(r"SPOKEN_ARTICLE = new Set\(\[([^\]]*)\]\)", ts)
    assert spoken
    said = set(re.findall(r"'(\w+)'", spoken.group(1)))
    assert ARTICLES == {lang: words for lang, words in app.items() if lang in said}
    assert said == set(ARTICLES)


def test_the_leading_articles_match_the_apps():
    ts = _ts()
    articles = re.search(r"const ARTICLES = new Set\(\[([^\]]*)\]\)", ts)
    assert articles
    assert set(re.findall(r"'([^']+)'", articles.group(1))) == set(_LEADING)


def test_every_language_name_maps_to_a_code_with_a_table():
    assert set(LANGUAGE_CODES.values()) == set(ARTICLES)


def test_a_norwegian_verb_is_said_with_its_marker():
    assert marker_for("norwegian", "verb", "huske") == "å"
    assert marker_for("Norsk", " Verb ", "huske") == "å"
    # A noun, a phrase that already starts with it, and every other language get none.
    assert marker_for("norwegian", "noun", "huske") is None
    assert marker_for("norwegian", "verb", "å gå seg vill") is None
    assert marker_for("german", "verb", "werfen") is None
    assert with_article("å", "huske") == "å huske"


def test_the_verb_markers_match_the_apps():
    block = re.search(r"const VERB_MARKERS[^=]*=\s*\{([^}]*)\}", _ts())
    assert block
    assert dict(re.findall(r"(\w+): '([^']+)'", block.group(1))) == VERB_MARKERS
