"""Spaced languages (every one but Thai): parsing, the checker, stretch words and rendering. Spanish
is tested most, as it was first; the deck entries are real ones from each deck (mostly advanced
words; everyday ones come from the common-words list)."""

import asyncio
import random
from typing import Any

from fake_anki import FakeDeck, card, note

from franki_reader import store
from franki_reader.coverage import check, parse_line
from franki_reader.difficulty import Difficulty
from franki_reader.engine import Engine
from franki_reader.generator import Line, TextRequest, generate
from franki_reader.languages import LANGUAGES
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render
from franki_reader.spaced import SpacedLexicon, common_words
from franki_reader.store import StoredText

ENTRIES = [
    Entry(1, "el blindaje", "armor plating / shielding", "mature"),
    Entry(2, "mantener a raya", "to keep at bay / to keep in check", "young", due=True),
    Entry(3, "a quemarropa", "point-blank", "mature"),
    Entry(4, "cerciorarse", "to make sure", "mature"),
    Entry(5, "diezmar", "to decimate", "young"),
    Entry(6, "la ojiva", "warhead", "mature"),
    Entry(7, "el enjambre", "swarm", "unreviewed"),
]
LEXICON = lexicon_from(ENTRIES, "es")


def statuses(text: str) -> dict[str, str]:
    return {t: LEXICON.status(t) for t in LEXICON.segment(text) if any(c.isalnum() for c in t)}


# ==== Parsing a model line ====


def test_bars_become_spaces_and_punctuation_stays_on_its_word() -> None:
    assert parse_line("¿Qué|quieres|*tomar*?", spaced=True) == ("¿Qué quieres tomar?", ["tomar"])
    assert parse_line("¡Hola|,|amigo|!", spaced=True)[0] == "¡Hola, amigo!"
    assert parse_line("¿|Vienes|?", spaced=True)[0] == "¿Vienes?"


def test_a_stretch_phrase_keeps_its_spaces() -> None:
    _, stretch = parse_line("Lo|*mantuvimos|a|raya*.", spaced=True)
    assert stretch == ["mantuvimos a raya"]


def test_thai_lines_are_parsed_as_before() -> None:
    assert parse_line("ฉัน|ต้องการ|*น้ำ*") == ("ฉันต้องการน้ำ", ["น้ำ"])


# ==== What counts as known ====


def test_common_words_count_as_known_in_any_form() -> None:
    assert "de" in common_words("es") and len(common_words("es")) == 10_000
    assert set(statuses("Hablaríamos con los niños mañana.").values()) == {"known"}


def test_deck_words_count_in_any_form_and_without_their_article() -> None:
    assert statuses("Las ojivas diezmaron la ciudad.") == {
        "Las": "known",
        "ojivas": "known",
        "diezmaron": "known",
        "la": "known",
        "ciudad": "known",
    }
    assert LEXICON.entry_of("ojivas") == "la ojiva"
    assert LEXICON.entry_of("blindaje") == "el blindaje"


def test_a_reflexive_verb_matches_its_forms_and_joined_pronouns_come_off() -> None:
    assert LEXICON.entry_of("cercioramos") == "cerciorarse"
    assert LEXICON.entry_of("cerciorándonos") == "cerciorarse"
    assert LEXICON.status("dámelo") == "known"  # dar, under me and lo


def test_a_rare_word_outside_the_deck_is_unknown() -> None:
    assert LEXICON.status("ornitorrinco") == "unknown"


def test_an_unreviewed_deck_word_is_not_known() -> None:
    assert LEXICON.status("enjambre") == "unknown"


def test_a_deck_phrase_is_one_token_even_inflected() -> None:
    pieces = LEXICON.segment("Los mantuvimos a raya, a quemarropa.")
    assert "mantuvimos a raya" in pieces
    assert "a quemarropa" in pieces
    assert LEXICON.entry_of("mantuvimos a raya") == "mantener a raya"
    assert LEXICON.status("mantuvimos a raya") == "known"


def test_a_rare_word_only_inside_a_deck_phrase_is_partial() -> None:
    assert LEXICON.status("quemarropa") == "partial"


def test_coverage_counts_a_phrase_once_and_flags_rare_words() -> None:
    coverage = check(["Los|mantuvimos|a|raya|con|un|ornitorrinco."], LEXICON)
    assert [t.text for t in coverage.tokens] == [
        "Los",
        "mantuvimos a raya",
        "con",
        "un",
        "ornitorrinco",
    ]
    assert coverage.words("unknown") == ["ornitorrinco"]
    assert coverage.ratio == 0.8


# ==== Stretch words ====


class Model:
    def __init__(self, *drafts: dict[str, Any]) -> None:
        self.drafts = list(drafts)

    async def __call__(self, messages: Any) -> Any:
        from franki_reader.generator import Usage

        return self.drafts.pop(0), [], Usage(1, 1, 0, 0)


def draft(*lines: str) -> dict[str, Any]:
    return {
        "title": "La noche",
        "roles": {"A": "Soldado", "B": "Capitán"},
        "genders": {"A": "male", "B": "female"},
        "lines": [
            {"speaker": "AB"[i % 2], "text": t, "english": "..."} for i, t in enumerate(lines)
        ],
        "glosses": [],
    }


def test_an_inflected_stretch_phrase_counts_as_the_entry_it_is_a_form_of() -> None:
    good = draft(
        "¿Lograron|*mantener|a|raya*|al|enemigo?",
        "Sí,|lo|*mantuvimos|a|raya*|toda|la|noche.",
    )
    request = TextRequest("guard duty", (ENTRIES[1], ENTRIES[4]), choose=1, language="es")
    result = asyncio.run(generate(Model(good), LEXICON, request))
    assert result.passed and result.floor_met
    assert result.stretch == ("mantener a raya",)
    assert result.glosses["mantener a raya"] == "to keep at bay / to keep in check"


# ==== Rendering ====


def test_a_spanish_text_renders_with_spaces_deck_flags_and_glosses_from_the_entry() -> None:
    text = StoredText(
        1,
        1,
        "t",
        (Line("A", "Las|*ojivas*|diezmaron|la|ciudad.", "..."),),
        {},
        ("la ojiva",),
        1.0,
        language="es",
    )
    out = render(text, LEXICON, {e.text: e.meaning for e in ENTRIES})
    words = out["lines"][0]["words"]
    assert "".join(w["text"] for w in words) == "Las ojivas diezmaron la ciudad."
    ojivas = next(w for w in words if w["text"] == "ojivas")
    assert ojivas == {
        "text": "ojivas",
        "status": "known",
        "gloss": "warhead",
        "lemma": "la ojiva",
        "translit": None,
        "stretch": True,
        "deck": True,
        "grammar": None,
    }
    ciudad = next(w for w in words if w["text"] == "ciudad")
    assert ciudad["deck"] is False and ciudad["status"] == "known"
    assert out["language"] == "es"


# ==== Snapshot, storage and the engine ====


def test_the_spanish_snapshot_reads_the_spanish_deck() -> None:
    from datetime import datetime

    conn = store.connect(":memory:")
    anki = FakeDeck([note(1, "el blindaje", "armor plating")], [card(1, 2, 30)])
    assert asyncio.run(store.refresh_if_stale(conn, anki, datetime(2026, 10, 26, 9), "es"))
    assert [(e.text, e.tier) for e in store.load_snapshot(conn, "es")[0]] == [
        ("el blindaje", "mature")
    ]
    assert anki.reads == [LANGUAGES["es"]]
    assert LANGUAGES["es"].notes_query == '"deck:👅 Languages::🌮 Español"'


def test_each_language_keeps_its_own_snapshot_and_difficulty() -> None:
    from datetime import datetime

    now = datetime(2026, 10, 26, 9, 0)
    conn = store.connect(":memory:")
    store.save_snapshot(conn, [Entry(100, "ฉัน", "I", "mature")], now)
    store.save_snapshot(conn, ENTRIES, now, "es")
    assert [e.text for e in store.load_snapshot(conn)[0]] == ["ฉัน"]
    assert len(store.load_snapshot(conn, "es")[0]) == len(ENTRIES)

    store.save_difficulty(conn, Difficulty(floor=0.97, stretch=1), "es")
    assert store.load_difficulty(conn) == Difficulty()
    assert store.load_difficulty(conn, "es") == Difficulty(floor=0.97, stretch=1)


SPANISH_DRAFT = draft(
    "¿Lograron|*mantener|a|raya*|al|enemigo?",
    "Sí,|lo|*mantuvimos|a|raya*|toda|la|noche.",
)


class ScriptedSpanish:
    def __init__(self) -> None:
        self.languages: list[str] = []

    def ask_for(self, entries: list[Entry], language: str) -> Any:
        self.languages.append(language)
        return Model(SPANISH_DRAFT, SPANISH_DRAFT, SPANISH_DRAFT)


def spanish_engine() -> tuple[Engine, ScriptedSpanish]:
    from datetime import datetime

    now = datetime(2026, 10, 26, 9, 0)
    conn = store.connect(":memory:")
    store.save_snapshot(conn, [Entry(100, "ฉัน", "I", "mature")], now)
    store.save_snapshot(conn, ENTRIES, now, "es")
    store.save_settings(conn, store.Settings(language="es"))
    model = ScriptedSpanish()
    return Engine(conn, model.ask_for, None, lambda: now, random.Random(1)), model


def test_with_spanish_chosen_a_topic_gets_a_spanish_text_and_thai_is_left_alone() -> None:
    e, model = spanish_engine()
    topic = store.add_topic(e.conn, "Guard duty", True, e.clock())

    text = asyncio.run(e.make_text(topic.id))

    assert text is not None and text.language == "es"
    assert model.languages == ["es"]
    assert store.list_topics(e.conn, "es")[0].ready == 1
    assert store.list_topics(e.conn, "th")[0].ready == 0


def test_a_rating_moves_the_difficulty_of_the_texts_language_only() -> None:
    e, _ = spanish_engine()
    topic = store.add_topic(e.conn, "Guard duty", True, e.clock())
    text = asyncio.run(e.make_text(topic.id))
    assert text is not None
    e.record_reading(text.id, store.Reading("too_hard", True, (), (), None, False, 60))
    assert store.load_difficulty(e.conn, "es").floor == 0.93
    assert store.load_difficulty(e.conn, "th") == Difficulty()
    row = e.conn.execute("SELECT language FROM readings").fetchone()
    assert row[0] == "spanish"


def test_spanish_lines_are_spoken_in_a_mexican_voice(tmp_path: Any) -> None:
    from franki_reader.tts import AudioCache

    spoken: list[tuple[str, str]] = []

    async def voice(text: str, name: str) -> bytes:
        spoken.append((text, name))
        return b"ID3"

    e, _ = spanish_engine()
    e.synthesize, e.audio = voice, AudioCache(tmp_path)
    topic = store.add_topic(e.conn, "Guard duty", True, e.clock())
    asyncio.run(e.make_text(topic.id))
    assert spoken[0] == ("¿Lograron mantener a raya al enemigo?", "es-MX-JorgeNeural")
    assert spoken[1][1] == "es-MX-DaliaNeural"


def test_switching_language_through_the_api_keeps_topics_and_separates_everything_else() -> None:
    import time

    from fastapi.testclient import TestClient

    from franki_reader.app import create_app

    e, _ = spanish_engine()
    store.save_settings(e.conn, store.Settings(language="th"))
    auth = {"Authorization": "Bearer p"}
    with TestClient(create_app(e, "p")) as c:
        topic = c.post("/api/topics", json={"name": "Guard duty", "favorite": False}, headers=auth)
        topic_id = topic.json()["id"]

        assert (
            c.patch("/api/settings", json={"language": "es"}, headers=auth).json()["language"]
            == "es"
        )
        deadline = time.time() + 10
        response = c.post(f"/api/topics/{topic_id}/next", headers=auth)
        while response.status_code == 202 and time.time() < deadline:
            time.sleep(0.02)
            response = c.post(f"/api/topics/{topic_id}/next", headers=auth)
        text = response.json()
        assert text["language"] == "es"
        assert text["title"] == "La noche"

        body = {"rating": "about_right", "finished": True}
        assert (
            c.post(f"/api/texts/{text['id']}/reading", json=body, headers=auth).status_code == 204
        )
        assert c.get("/api/progress", headers=auth).json()["finished"] == 1
        assert len(c.get("/api/texts", headers=auth).json()) == 1

        c.patch("/api/settings", json={"language": "th"}, headers=auth)
        assert [t["name"] for t in c.get("/api/topics", headers=auth).json()] == ["Guard duty"]
        assert c.get("/api/progress", headers=auth).json()["finished"] == 0
        assert c.get("/api/texts", headers=auth).json() == []
        assert c.patch("/api/settings", json={"language": "ja"}, headers=auth).status_code == 422


# ==== The other languages (12 November 2026) ====


def lexicon_of(code: str, entries: list[str], common: int | None = None) -> Any:
    deck = [Entry(i, e, "meaning", "mature") for i, e in enumerate(entries, start=1)]
    return lexicon_from(deck, code, common)  # type: ignore[arg-type]


def word_statuses(lexicon: Any, text: str) -> dict[str, str]:
    return {t: lexicon.status(t) for t in lexicon.segment(text) if any(c.isalnum() for c in t)}


def test_every_language_but_thai_has_a_list_of_10000_common_words_and_voices() -> None:
    for code, language in LANGUAGES.items():
        assert language.voices["male"] and language.voices["female"]
        if code != "th":
            assert language.spaced and len(common_words(code)) == 10_000


def test_greek_final_sigma_and_russian_yo_match_the_common_words() -> None:
    assert "όλος" in common_words("el")
    assert not [w for w in common_words("el") if len(w) > 1 and w.endswith("σ")]
    assert word_statuses(lexicon_of("ru", ["костёр"], 3000), "Они сидели у костра, ещё.") == {
        "Они": "known",
        "сидели": "known",
        "у": "known",
        "костра": "known",
        "ещё": "known",
    }


def test_how_many_common_words_count_is_the_setting() -> None:
    assert lexicon_of("de", [], 3000).status("Gipfel") == "unknown"
    assert lexicon_of("de", [], 10000).status("Gipfel") == "known"
    assert lexicon_of("de", [], 0).status("und") == "unknown"
    # Without a setting, the language's default.
    assert lexicon_of("de", []).common == lexicon_of("de", [], 3000).common


def test_german_entries_match_without_article_or_sich_and_by_each_alternative() -> None:
    lexicon = lexicon_of(
        "de",
        ["sich verlieben", "der/die Mitwirkende", "der Verräter / die Verräterin", "zweifeln (an)"],
    )
    assert lexicon.entry_of("verliebte") == "sich verlieben"
    assert lexicon.entry_of("Mitwirkenden") == "der/die Mitwirkende"
    assert lexicon.entry_of("Verräterin") == "der Verräter / die Verräterin"
    assert lexicon.entry_of("Verräter") == "der Verräter / die Verräterin"
    assert lexicon.entry_of("zweifelte") == "zweifeln (an)"
    # "der" in der/die is an article, not the entry.
    assert lexicon.entry_of("der") is None


def test_french_elisions_are_words_of_their_own_and_participles_find_their_verb() -> None:
    lexicon = lexicon_of("fr", ["l'amertume", "se balader", "cracher le morceau", "d'où"], 3000)
    assert lexicon.segment("L'amertume, c'est") == ["L'", "amertume", ",", " ", "c'", "est"]
    assert set(word_statuses(lexicon, "L'amertume de l'homme, c'est fini.").values()) == {"known"}
    assert lexicon.entry_of("amertume") == "l'amertume"
    assert lexicon.entry_of("balade") == "se balader"
    assert "craché le morceau" in lexicon.segment("Il a craché le morceau.")
    assert lexicon.entry_of("d'où") == "d'où"
    # A guess counts only against the deck: craché alone isn't a common word.
    assert lexicon_of("fr", [], 3000).status("craché") == "unknown"


def test_a_hyphenated_word_is_known_when_each_part_is() -> None:
    assert lexicon_of("ru", [], 3000).status("что-то") == "known"
    assert lexicon_of("fr", [], 3000).status("peut-être") == "known"


def test_greek_alternatives_are_each_an_entry() -> None:
    lexicon = lexicon_of("el", ["ποιος/ποια/ποιο", "φοβάμαι"], 3000)
    assert lexicon.entry_of("Ποια") == "ποιος/ποια/ποιο"
    assert lexicon.entry_of("φοβάται") == "φοβάμαι"
    assert lexicon.status("της") == "known"


def test_polish_with_no_common_words_counts_only_its_deck_and_the_gender_marker() -> None:
    lexicon = lexicon_of("pl", ["ta kobieta", "to dziecko", "pić / wypić", "i", "nie", "mały"], 0)
    assert word_statuses(lexicon, "Ta kobieta i małe dziecko nie piją.") == {
        "Ta": "known",
        "kobieta": "known",
        "i": "known",
        "małe": "known",
        "dziecko": "known",
        "nie": "known",
        "piją": "known",
    }
    assert lexicon.status("dom") == "unknown"  # common, but none are counted here


def test_polish_counts_its_250_most_common_words_by_default() -> None:
    lexicon = lexicon_of("pl", ["ta kobieta"])
    assert word_statuses(lexicon, "Ja nie mam na to psa.") == {
        "Ja": "known",
        "nie": "known",
        "mam": "known",
        "na": "known",
        "to": "known",
        "psa": "unknown",
    }


def test_norwegian_entries_match_without_their_article_or_infinitive_marker() -> None:
    lexicon = lexicon_of("nb", ["å vente", "en butikk", "å skynde seg"], 1000)
    assert set(word_statuses(lexicon, "Vi venter i butikken.").values()) == {"known"}
    assert lexicon.entry_of("skynder") == "å skynde seg"


def test_the_request_says_how_many_common_words_count() -> None:
    from franki_reader.generator import request_message, system_prompt

    german = request_message(TextRequest("t", language="de", common=3000))
    assert "the 3,000 most common German words" in german
    assert "common or from the list" in german
    polish = request_message(TextRequest("t", language="pl", common=0))
    assert "only the list" in polish and "words from the list." in polish
    thai = request_message(TextRequest("t"))
    assert "Known words" not in thai

    prompt = system_prompt(ENTRIES, "nb")
    assert prompt.startswith("You write short Norwegian texts") and "Write Bokmål." in prompt
    assert "Jeg|må|*skynde|meg*!" in prompt
    assert system_prompt(ENTRIES, "es").startswith("You write short Spanish texts")
    assert "Mexican Spanish" in system_prompt(ENTRIES, "es")


def test_the_engine_writes_with_the_chosen_common_count() -> None:
    e, _ = spanish_engine()
    store.save_settings(e.conn, store.Settings(language="es", common={"es": 2000}))
    lexicon = e.snapshot("es")[1]
    assert (
        isinstance(lexicon, SpacedLexicon) and lexicon.common == lexicon_of("es", [], 2000).common
    )
    assert e._request("t", ENTRIES, Difficulty(), "es").common == 2000
    assert e._request("t", [], Difficulty(), "th").common == 0


def test_vengo_is_venir_not_vengar() -> None:
    # simplemma takes vengo to vengar (to avenge), so a deck with vengar made "Ya vengo" a deck word
    lexicon = lexicon_from([Entry(8, "vengar", "to avenge", "mature")], "es")
    assert lexicon.entry_of("vengo") is None
    assert lexicon.entry_of("vengaré") == "vengar"


def test_forms_simplemma_takes_to_the_wrong_verb() -> None:
    from franki_reader.spaced import lemma

    assert lemma("salgo", "es") == "salir"
    assert lemma("entraba", "es") == "entrar"
    assert lemma("recibís", "es") == "recibir"
    # the future and conditional of a verb come back as its reflexive
    assert lemma("volverías", "es") == "volver"
    assert lemma("utilizaréis", "es") == "utilizar"
    assert lemma("verse", "es") == "verse"


def test_spanish_subjunctives_match_a_deck_infinitive() -> None:
    deck = SpacedLexicon("es", ["abrir", "sacar", "alcanzar", "escoger"])  # no common words
    for form, entry in [
        ("abras", "abrir"),
        ("saque", "sacar"),
        ("saquemos", "sacar"),
        ("alcance", "alcanzar"),
        ("escojan", "escoger"),
    ]:
        assert deck.entry_of(form) == entry, form
    # a guess only matches a deck entry, so a word that merely looks like one isn't made known
    assert deck.status("elogie") == "unknown"
