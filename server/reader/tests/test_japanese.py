"""Japanese (13 November 2026): splitting a line into words with Sudachi, what counts as known
(deck, WaniKani, common words), and rendering. The deck entries are real ones from the owner's
deck."""

import asyncio
import random
from datetime import datetime
from typing import Any

import pytest
from scripted import ScriptedModel, draft

from franki_reader import store
from franki_reader.coverage import check, parse_line
from franki_reader.engine import Engine
from franki_reader.generator import Line, system_prompt
from franki_reader.japanese import JapaneseLexicon, common_lemmas, hiragana, lemma_key
from franki_reader.languages import LANGUAGES
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render
from franki_reader.store import StoredText
from franki_reader.tts import billed_chars
from franki_reader.wanikani import WaniKaniWord


@pytest.fixture(autouse=True)
def japanese_shown(monkeypatch: pytest.MonkeyPatch) -> None:
    """Japanese is hidden from the app for now (languages.HIDDEN_LANGUAGES); these test it as shown."""
    monkeypatch.setattr(store, "HIDDEN_LANGUAGES", frozenset())


DECK = [
    "劇団",
    "約束を破る",
    "経験する",
    "気を失う",
    "暗くなる",
    "静かな",
    "乗り換え",
    "見せびらかす",
]


def lexicon(known: list[str] = DECK, common: int = 0, extra: tuple[str, ...] = ()) -> Any:
    return JapaneseLexicon(known, common, extra)


def statuses(lx: Any, text: str) -> dict[str, str]:
    return {t: lx.status(t) for t in lx.segment(text) if any(c.isalnum() for c in t)}


# ==== Splitting a line ====


def test_a_line_is_split_into_words_that_join_back_into_it() -> None:
    lx = lexicon()
    text = "昨日、友達と映画を見に行きました。"
    words = lx.segment(text)
    assert "".join(words) == text
    assert words == ["昨日", "、", "友達", "と", "映画", "を", "見", "に", "行きました", "。"]


def test_a_verb_or_adjective_keeps_what_conjugates_it() -> None:
    lx = lexicon()
    assert lx.segment("食べさせられた") == ["食べさせられた"]
    assert lx.segment("ちょっと待って") == ["ちょっと", "待って"]
    assert lx.segment("高くないね") == ["高くない", "ね"]
    # A verb after て is a word of its own, and so is です after a noun.
    assert lx.segment("見せびらかしている") == ["見せびらかして", "いる"]
    assert lx.segment("学生です") == ["学生", "です"]


def test_a_prefix_joins_the_word_after_it_and_a_suffix_the_noun_before_it() -> None:
    lx = lexicon()
    assert lx.segment("お茶を飲む")[0] == "お茶"
    assert lx.segment("学生たちが来た")[0] == "学生たち"
    # Not after a name, so a name marked with tildes stays a piece of its own.
    assert lx.segment("田中さん")[:2] == ["田中", "さん"]


def test_bars_are_dropped_and_names_are_left_out_of_the_count() -> None:
    assert parse_line("~田中~|さん|は|*劇団*|に|いる。") == ("田中さんは劇団にいる。", ["劇団"])
    coverage = check(["~田中~|さん|は|*劇団*|に|いる。"], lexicon(common=2000))
    assert coverage.names == ("田中",)
    assert "田中" not in [t.text for t in coverage.tokens]


# ==== What counts as known ====


def test_deck_entries_match_in_any_form() -> None:
    lx = lexicon()
    assert statuses(lx, "見せびらかした") == {"見せびらかした": "known"}
    assert lx.entry_of("見せびらかした") == "見せびらかす"


def test_a_deck_phrase_is_one_word_even_conjugated() -> None:
    lx = lexicon()
    assert lx.segment("約束を破った彼は") == ["約束を破った", "彼", "は"]
    assert lx.status("約束を破った") == "known"
    assert lx.entry_of("約束を破った") == "約束を破る"
    assert lx.segment("暗くなってきた")[0] == "暗くなって"
    assert lx.entry_of("暗くなって") == "暗くなる"


def test_a_suru_verb_and_a_na_adjective_also_make_their_word_known() -> None:
    lx = lexicon()
    assert lx.segment("経験した") == ["経験した"]
    assert lx.entry_of("経験した") == "経験する"
    assert lx.status("経験") == "known"
    assert lx.entry_of("静かに") == "静かな"
    assert lx.status("静か") == "known"


def test_spelling_variants_match_the_same_entry() -> None:
    lx = lexicon(["引っ越し", "出来る"])
    assert lx.status("引越し") == "known"
    assert lx.status("できた") == "known"


def test_particles_auxiliaries_and_numbers_always_count_as_known() -> None:
    assert statuses(lexicon([]), "3時にです") == {
        "3": "known",
        "時": "unknown",
        "に": "known",
        "です": "known",
    }


def test_a_word_only_inside_a_deck_phrase_is_partial() -> None:
    lx = lexicon()
    assert lx.status("約束") == "partial"
    assert lx.status("約束を破った") == "known"


def test_a_compound_kept_whole_is_known_when_its_parts_are() -> None:
    lx = lexicon(["乗り換え", "口"])
    assert lx.segment("乗り換え口") in (["乗り換え口"], ["乗り換え", "口"])
    assert all(lx.status(t) == "known" for t in lx.segment("乗り換え口"))


def test_common_words_count_up_to_the_setting() -> None:
    assert lexicon([], 0).status("映画") == "unknown"
    assert lexicon([], 2000).status("映画") == "known"
    assert lexicon([], 2000).status("見ました") == "known"
    assert len(common_lemmas()) == 10_000


def test_wanikani_words_count_as_known_but_are_not_deck_words() -> None:
    lx = lexicon(["劇団"], 2000, ("映画", "大人"))
    assert lx.status("映画") == "known"
    assert lx.entry_of("映画") is None
    assert lx.from_wanikani("映画")
    # A deck word, a common word and a particle aren't WaniKani's.
    assert not lx.from_wanikani("劇団")
    assert not lx.from_wanikani("見ました")
    assert not lx.from_wanikani("は")


def test_lemma_keys_settle_spelling_variants() -> None:
    assert lemma_key("できる") == lemma_key("出来る")


# ==== Rendering ====


def test_a_japanese_text_renders_with_readings_lemmas_and_glosses() -> None:
    text = StoredText(
        1,
        1,
        "t",
        (Line("A", "彼|は|*約束|を|破った*。|劇団|に|行きました。", "..."),),
        {},
        ("約束を破る",),
        1.0,
        language="ja",
    )
    lx = lexicon(DECK, 2000, ("行く",))
    meanings = {"約束を破る": "to break a promise", "劇団": "theater company", "行く": "to go"}
    out = render(text, lx, meanings, {"劇団": "げきだん"})
    words = {w["text"]: w for w in out["lines"][0]["words"]}
    assert (
        "".join(w["text"] for w in out["lines"][0]["words"])
        == "彼は約束を破った。劇団に行きました。"
    )
    assert words["約束を破った"] == {
        "text": "約束を破った",
        "status": "known",
        "gloss": "to break a promise",
        "lemma": "約束を破る",
        "translit": "やくそくをやぶった",
        "stretch": True,
        "deck": True,
        "wanikani": False,
        "rank": None,
        "grammar": None,
        "form": None,
    }
    # The deck's reading for the entry itself, Sudachi's for a conjugated word, none for kana.
    assert words["劇団"]["translit"] == "げきだん"
    assert words["行きました"]["translit"] == "いきました"
    assert words["は"]["translit"] is None and words["は"]["lemma"] is None
    # A WaniKani word's meaning is found by its dictionary form; it isn't a deck word.
    assert words["行きました"]["gloss"] == "to go"
    assert words["行きました"]["lemma"] == "行く"
    assert words["行きました"]["deck"] is False
    assert words["行きました"]["wanikani"] is True


def test_hiragana() -> None:
    assert hiragana("ケイケン") == "けいけん"
    assert hiragana("ラーメン") == "らーめん"


# ==== Writing a text ====

NOW = datetime(2026, 11, 13, 9, 0)
DECK_ENTRIES = [Entry(i + 1, w, "...", "mature") for i, w in enumerate(DECK)]
# 20 counted words with one unknown (芝居): 95%, inside the default range.
JAPANESE_DRAFT = draft(
    "明日|は|*劇団*|の|公演|を|見|に|行く|よ。",
    "*劇団*|の|人|は|静かな|人|だ|ね。|芝居|が|好き|だ。",
    glosses={"芝居": "a play"},
)


def japanese_engine(wanikani: list[WaniKaniWord] | None = None) -> tuple[Engine, ScriptedModel]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, DECK_ENTRIES, NOW, "ja")
    store.save_settings(conn, store.Settings(language="ja"))
    if wanikani is not None:
        store.save_wanikani(conn, wanikani, NOW)
    model = ScriptedModel(JAPANESE_DRAFT)
    return Engine(conn, model.ask_for, None, lambda: NOW, random.Random(1)), model


def test_a_japanese_text_is_written_and_checked_with_the_japanese_checker() -> None:
    e, model = japanese_engine()
    topic = store.add_topic(e.conn, "The theater", True, e.clock())
    text = asyncio.run(e.make_text(topic.id))
    assert text is not None and text.language == "ja"
    assert model.languages_seen == ["ja"]
    assert 0.9 <= text.coverage < 1
    assert store.list_topics(e.conn, "th")[0].ready == 0


def test_wanikani_words_join_the_checker_the_word_list_and_the_meanings() -> None:
    words = [WaniKaniWord(9001, "公演", "performance", "こうえん", 7)]
    e, model = japanese_engine(words)
    entries, lx = e.snapshot("ja")
    assert all(entry.note_id > 0 for entry in entries)  # not a deck word
    assert lx.status("公演") == "known" and lx.entry_of("公演") is None
    assert e.meanings("ja")["公演"] == "performance"
    topic = store.add_topic(e.conn, "The theater", True, e.clock())
    asyncio.run(e.make_text(topic.id))
    seen = model.entries_seen[0]
    assert any(entry.text == "公演" and entry.tier == "mature" for entry in seen)
    assert "公演 | performance | M" in system_prompt(seen, "ja")
    # Only Japanese counts them.
    assert e.wanikani_entries("es") == []


def test_the_japanese_prompt_says_to_write_without_spaces_and_with_kanji() -> None:
    prompt = system_prompt(DECK_ENTRIES, "ja")
    assert "never a space" in prompt and "never romaji" in prompt
    assert LANGUAGES["ja"].example in prompt
    # The other languages' prompt is unchanged.
    assert "put | between words instead of spaces, keep punctuation on its word, and wrap" in (
        " ".join(system_prompt([], "es").split())
    )


def test_the_deck_reading_comes_from_kana_reading() -> None:
    assert LANGUAGES["ja"].translit_field == "KanaReading"
    assert LANGUAGES["th"].translit_field == "Transliteration"


def test_lexicon_from_routes_japanese_to_its_checker_with_its_default_common_count() -> None:
    lx = lexicon_from(DECK_ENTRIES, "ja")
    assert isinstance(lx, JapaneseLexicon)
    assert lx.common == lexicon([], 2000).common


def test_azure_bills_japanese_characters_twice() -> None:
    assert billed_chars("Hola.") == 5
    assert billed_chars("劇団に行く。") == 11  # 。 is billed once
