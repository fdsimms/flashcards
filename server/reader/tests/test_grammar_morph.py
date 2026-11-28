"""Case and aspect: each point found in sentences that use it, and nothing claimed where a word
could be another case or aspect, since a false find under Don't know it sends a good draft back
(docs/grammar.md, "Case and aspect")."""

import pytest

from franki_reader import grammar_morph
from franki_reader.grammar import POINTS, points_for, words
from franki_reader.languages import Code
from franki_reader.lexicon import lexicon_from

CASE_AND_ASPECT = frozenset(
    pid
    for pid in POINTS
    if pid.split(".")[1]
    in {
        "genitive",
        "dative",
        "accusative",
        "instrumental",
        "prepositional",
        "locative",
        "perfective",
        "imperfective",
    }
)


def found(text: str, language: Code) -> dict[str, list[str]]:
    ws = words(text, lexicon_from([], language))
    out = {}
    for p in points_for(language):
        if p.id in CASE_AND_ASPECT and (spans := p.find(ws)):
            out[p.id] = [" ".join(ws[a:b]) for a, b in spans]
    return out


needs_polish = pytest.mark.skipif(
    grammar_morph._pl_analyzer() is None, reason="Morfeusz isn't installed on this machine"
)


def test_every_language_with_cases_has_its_points() -> None:
    assert {
        "ru.genitive",
        "ru.dative",
        "ru.accusative",
        "ru.instrumental",
        "ru.prepositional",
        "ru.perfective",
        "ru.imperfective",
        "pl.genitive",
        "pl.dative",
        "pl.accusative",
        "pl.instrumental",
        "pl.locative",
        "pl.perfective",
        "pl.imperfective",
        "de.accusative",
        "de.dative",
        "de.genitive",
        "el.genitive",
        "el.accusative",
    } == CASE_AND_ASPECT
    # Grammar in nearly every line: Know it until the owner chooses, or the cap on points not set
    # would send nearly every draft back.
    assert all(POINTS[pid].known for pid in CASE_AND_ASPECT)


RUSSIAN = [
    ("Я читаю книгу и газету.", "ru.accusative", ["книгу", "газету"]),
    ("У меня нет времени, а у него пять рублей.", "ru.genitive", ["меня", "него", "рублей"]),
    ("Мы гуляли с собакой и говорили с мамой.", "ru.instrumental", ["собакой", "мамой"]),
    (
        "Книга лежит на столе, мы говорим о моём брате.",
        "ru.prepositional",
        ["столе", "моём", "брате"],
    ),
    ("Я помогаю брату.", "ru.dative", ["брату"]),
    ("Я прочитал книгу и завтра позвоню.", "ru.perfective", ["прочитал", "позвоню"]),
    ("Я читал весь вечер, а потом начал писать.", "ru.imperfective", ["читал", "писать"]),
]


@pytest.mark.parametrize(("text", "point", "matches"), RUSSIAN)
def test_russian(text: str, point: str, matches: list[str]) -> None:
    assert found(text, "ru").get(point) == matches


def test_russian_words_that_could_be_another_case_or_aspect_are_left_alone() -> None:
    # книги: genitive singular or nominative/accusative plural; сестре: dative or prepositional;
    # меня: genitive or accusative; кофе and метро don't change.
    assert found("Книги и сестре, меня и кофе, метро.", "ru") == {}
    # The present is imperfective in every verb, быть isn't a choice, использовать is both
    # aspects, and стали is "became" and "of steel".
    assert found("Я читаю, он был дома, она использовала, они стали.", "ru") == {}
    # Nominatives aren't a point.
    assert found("Мама и папа дома.", "ru") == {}


def test_a_preposition_settles_a_russian_case_its_word_leaves_open() -> None:
    assert found("Я думаю о сестре и иду к сестре.", "ru") == {
        "ru.prepositional": ["сестре"],
        "ru.dative": ["сестре"],
    }
    # Through an adjective, but not through a noun, which may end a sentence whose stop is gone.
    assert found("Мы в моём доме.", "ru")["ru.prepositional"] == ["моём", "доме"]
    assert found("Мы идём в парк сестре.", "ru") == {"ru.accusative": ["парк"]}
    # в лесу could still be an accusative of леса.
    assert found("Я в лесу.", "ru") == {}


POLISH = [
    ("Czytam książkę.", "pl.accusative", ["książkę"]),
    ("Nie mam czasu.", "pl.genitive", ["czasu"]),
    ("Spaceruję z psem i kotem.", "pl.instrumental", ["psem", "kotem"]),
    ("Mówimy o bracie i o szkole.", "pl.locative", ["szkole"]),
    ("Daję mu książkę.", "pl.accusative", ["książkę"]),
    ("Przeczytałem list i zadzwonię jutro.", "pl.perfective", ["przeczytałem", "zadzwonię"]),
    ("Czytałem cały wieczór i będę pisać.", "pl.imperfective", ["czytałem", "pisać"]),
]


@needs_polish
@pytest.mark.parametrize(("text", "point", "matches"), POLISH)
def test_polish(text: str, point: str, matches: list[str]) -> None:
    assert found(text, "pl").get(point) == matches


@needs_polish
def test_polish_words_that_could_be_another_case_or_aspect_are_left_alone() -> None:
    # domu and parku: genitive, locative or vocative; mam: "I have" and mama's genitive plural;
    # nie: "not" and a pronoun's accusative; mu: "to him" and an interjection; mamie: dative or
    # locative.
    assert found("Domu parku nie mam, mu, mamie.", "pl") == {}
    # The present is imperfective in every verb, and być isn't a choice.
    assert found("Czytam i piszę. Był tu i będzie.", "pl") == {}


@needs_polish
def test_a_preposition_settles_a_polish_case_its_word_leaves_open() -> None:
    assert found("Mówię o mamie w domu.", "pl") == {"pl.locative": ["mamie", "domu"]}
    # Not across a noun: w parku. Domu... is a new sentence.
    assert found("Jestem w parku domu.", "pl") == {"pl.locative": ["parku"]}


def test_polish_finds_nothing_without_morfeusz(monkeypatch: pytest.MonkeyPatch) -> None:
    # Morfeusz has no ARM Linux build: there, Polish case and aspect are never found, rather than
    # the server failing to start.
    grammar_morph._pl_analyzer.cache_clear()
    grammar_morph.pl_cases.cache_clear()
    grammar_morph.pl_aspect.cache_clear()
    monkeypatch.setitem(__import__("sys").modules, "morfeusz2", None)
    try:
        assert found("Czytam książkę i przeczytałem list.", "pl") == {}
    finally:
        monkeypatch.undo()
        grammar_morph._pl_analyzer.cache_clear()
        grammar_morph.pl_cases.cache_clear()
        grammar_morph.pl_aspect.cache_clear()


GERMAN = [
    (
        "Ich sehe den Mann und kaufe den alten Tisch.",
        "de.accusative",
        ["den mann", "den alten tisch"],
    ),
    ("Ich habe einen Hund, und er kennt ihn.", "de.accusative", ["einen hund", "ihn"]),
    (
        "Ich gebe dem Kind ein Buch und gehe mit meinem Freund.",
        "de.dative",
        ["dem kind", "meinem freund"],
    ),
    ("Sie hilft mir im Garten.", "de.dative", ["mir", "im garten"]),
    (
        "Das Auto des Vaters ist neu. Eines Tages kam er.",
        "de.genitive",
        ["des vaters", "eines tages"],
    ),
]


@pytest.mark.parametrize(("text", "point", "matches"), GERMAN)
def test_german(text: str, point: str, matches: list[str]) -> None:
    assert found(text, "de").get(point) == matches


def test_german_words_that_could_be_another_case_are_left_alone() -> None:
    # den Kindern is a dative plural; den Garten could be one (die Gärten aside, den Wagen is); a
    # relative den with no noun after it; dieses Haus is nominative or accusative; am besten.
    found_here = found(
        "Ich spiele mit den Kindern. Er geht in den Garten. Der Film, den ich sah. Dieses Haus "
        "ist am besten.",
        "de",
    )
    assert found_here == {}


GREEK = [
    ("Βλέπω τον φίλο μου στην Αθήνα.", "el.accusative", ["τον φίλο", "στην αθήνα"]),
    ("Βλέπω τους φίλους μου.", "el.accusative", ["τους φίλους"]),
    ("Το σπίτι του φίλου μου. Του είπα.", "el.genitive", ["του φίλου", "του"]),
    ("Η μητέρα της Άννας.", "el.genitive", ["της άννας"]),
]


@pytest.mark.parametrize(("text", "point", "matches"), GREEK)
def test_greek(text: str, point: str, matches: list[str]) -> None:
    assert found(text, "el").get(point) == matches


def test_greek_words_that_could_be_another_case_are_left_alone() -> None:
    # το and τα are nominative or accusative; τους before a verb is the accusative or the
    # genitive pronoun (τους είπα, "I told them"), and after a noun the genitive (σπίτι τους).
    assert found("Το παιδί και τα σπίτια. Τους είπα. Το σπίτι τους είναι εδώ.", "el") == {}
