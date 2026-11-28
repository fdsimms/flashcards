"""The note queue: the checks on what Claude fills in, the passes that fill and retry, and its endpoints."""

import asyncio
import json
import random
import sqlite3
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from franki_speech.icons import icon_drawing
from test_app import AUTH, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.note_queue import (
    BATCH,
    MAX_ALTERNATIVES,
    MAX_ATTEMPTS,
    RETRY_AFTER,
    FillFailed,
    Spelled,
    check,
    checked,
    claude_notes,
    fill_pending,
    request_message,
    retrying,
    spelled,
)

NOW = datetime(2026, 11, 13, 9, 0)
DECK = "Languages::Français"
COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2.00


def filled(entry: str, **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "entry": entry,
        "meaning": "to snigger",
        "context": f"Il <b>{entry}</b> dans son coin.",
        "translation": "He sniggers in his corner.",
        "romanization": "",
        "transliteration": "",
        "register": "neutral",
        "part_of_speech": "verb",
        "notes": "",
        "classifier": "",
        "gender": "",
        "plural": "",
        "genitive": "",
    }
    return {**base, **over}


class Writer:
    """Answers each call with `answer(language, asked)`, or raises what it's given."""

    def __init__(
        self, answer: Any = None, fail: str | None = None, billed: Usage | None = None
    ) -> None:
        self.answer = answer or (lambda language, asked: [filled(e) for e, _ in asked])
        self.fail = fail
        self.billed = billed  # what a failed call was billed for, when Claude answered
        self.calls: list[tuple[str, list[tuple[str, str]]]] = []
        self.learners: list[str] = []  # whose Thai each call was asked for

    async def __call__(
        self, language: Any, asked: list[tuple[str, str]], learner: str = "male"
    ) -> Any:
        self.calls.append((language, asked))
        self.learners.append(learner)
        if self.fail:
            raise FillFailed(self.fail, self.billed)
        return self.answer(language, asked), COST


def conn_with(*entries: tuple[str, str], language: Any = "fr") -> sqlite3.Connection:
    conn = store.connect(":memory:")
    store.add_queued(conn, language, DECK, list(entries), NOW)
    return conn


# ---- the checks ----


def test_a_good_answer_gives_the_fields_by_their_anki_names() -> None:
    assert check(filled("ricane"), {"ricane": ""}, "fr") == (
        "ricane",
        {
            "Meaning": "to snigger",
            "Context": "Il <b>ricane</b> dans son coin.",
            "ContextTranslation": "He sniggers in his corner.",
            "Register": "neutral",
            "Language": "french",
            "GenerateReverse": "y",
            "PartOfSpeech": "verb",
        },
    )


def test_production_and_listening_cards_follow_whether_the_word_is_said_or_heard() -> None:
    def switches(**over: str) -> tuple[bool, bool]:
        got = check(filled("ricane", **over), {"ricane": ""}, "fr")
        assert got is not None
        return "GenerateReverse" in got[1], "GenerateAudioCard" in got[1]

    assert switches(say="yes", hear="yes") == (True, True)
    assert switches(say="no", hear="yes") == (False, True)
    assert switches(say="no", hear="no") == (False, False)
    # With no answer, as before: a reverse card and no audio card.
    assert switches() == (True, False)


def test_a_picture_is_kept_only_when_it_is_one_emoji() -> None:
    def icon(value: object) -> str | None:
        got = check(filled("ricane", icon=value), {"ricane": ""}, "fr")
        assert got is not None
        return got[1].get("Icon")

    assert icon("☂️") == "☂️"
    assert icon(" 🐘 ") == "🐘"
    assert icon("👨‍⚕️") == "👨‍⚕️"
    for not_one in ("", "umbrella", "☂️ umbrella", "🐘🐘🐘🐘🐘🐘🐘🐘🐘", "\ufe0f", None):
        assert icon(not_one) is None


def test_a_tabler_icon_is_kept_by_name_when_there_is_no_emoji() -> None:
    def icon(**over: object) -> str | None:
        got = check(filled("ricane", **over), {"ricane": ""}, "fr")
        assert got is not None
        return got[1].get("Icon")

    umbrella = icon_drawing("umbrella")
    assert umbrella
    # The name is stored as the icon's path data, which is what the app draws.
    assert icon(icon="", icon_name="umbrella") == umbrella
    assert icon(icon="", icon_name=" Tabler:Umbrella ") == umbrella
    # The emoji wins when both come back.
    assert icon(icon="☂️", icon_name="umbrella") == "☂️"
    # A name the set doesn't have, path data and markup are left out, never repaired to a near icon.
    for bad in (
        "running-track",
        "M3 12a9 9 0 0 1 18 0z|M12 12v7a2 2 0 0 1-4 0",
        '<svg><path d="M0 0"/></svg>',
        "umbrella-off",
        "",
        None,
    ):
        assert icon(icon="", icon_name=bad) is None


def test_the_owners_meaning_is_kept() -> None:
    got = check(filled("ricane"), {"ricane": "sniggers"}, "fr")
    assert got is not None and got[1]["Meaning"] == "sniggers"


def test_a_register_is_kept_lowercase_and_a_plain_word_is_neutral() -> None:
    got = check(filled("ricane", register="Informal"), {"ricane": ""}, "fr")
    assert got is not None and got[1]["Register"] == "informal"
    got = check(filled("ricane", register=""), {"ricane": ""}, "fr")
    assert got is not None and got[1]["Register"] == "neutral"


def test_notes_and_part_of_speech_are_kept_and_a_bad_one_is_left_out() -> None:
    got = check(filled("ricane", notes="rire is the plain word"), {"ricane": ""}, "fr")
    assert got is not None and got[1]["Notes"] == "rire is the plain word"
    got = check(filled("ricane", notes="a | b", part_of_speech="thing"), {"ricane": ""}, "fr")
    assert got is not None and "Notes" not in got[1] and "PartOfSpeech" not in got[1]


def got_fields(language: Any, entry: str, asked: str = "", **over: Any) -> dict[str, str]:
    got = check(filled(entry, **over), {entry: asked}, language)
    assert got is not None
    return got[1]


def test_a_thai_noun_gets_its_classifier_and_only_a_noun() -> None:
    thai: dict[str, Any] = {
        "context": "<b>ผ้า</b>นี้นุ่ม",
        "romanization": "phâa nîi núm",
        "transliteration": "phâa",
        "classifier": "ผืน",
    }
    noun = got_fields("th", "ผ้า", part_of_speech="noun", **thai)
    assert noun["Classifier"] == "ผืน" and noun["Language"] == "thai"
    assert "Classifier" not in got_fields("th", "ผ้า", part_of_speech="verb", **thai)


def test_a_german_noun_gets_gender_plural_and_genitive() -> None:
    fields = got_fields(
        "de", "die Einstellung", part_of_speech="noun", gender="F", plural="Einstellungen",
        genitive="der Einstellung",
    )  # fmt: skip
    assert (fields["Gender"], fields["Plural"], fields["Genitive"]) == (
        "f",
        "Einstellungen",
        "der Einstellung",
    )
    assert "Gender" not in got_fields("de", "die Einstellung", part_of_speech="noun", gender="x")


def test_a_german_verb_gets_class_auxiliary_and_key_forms() -> None:
    fields = got_fields(
        "de", "abwerfen", part_of_speech="verb", verb_class="Strong", auxiliary="haben",
        pattern="Strong verb. The prefix ab splits off.", form_past="warf ab",
        form_perfect="hat abgeworfen", gender="m", plural="x",
    )  # fmt: skip
    assert fields["VerbClass"] == "strong" and fields["Auxiliary"] == "haben"
    # Each form is a line under the name of what it is, the pattern first.
    assert fields["KeyForms"] == (
        "pattern: Strong verb. The prefix ab splits off.<br>past: warf ab<br>perfect: hat abgeworfen"
    )
    assert "Gender" not in fields and "Plural" not in fields
    # A form that doesn't pass is left out; the rest of the lines are kept.
    partly = got_fields(
        "de",
        "abwerfen",
        part_of_speech="verb",
        form_past="warf | ab",
        form_perfect="hat abgeworfen",
    )
    assert partly["KeyForms"] == "perfect: hat abgeworfen"
    assert "KeyForms" not in got_fields("de", "abwerfen", part_of_speech="verb")
    assert "Auxiliary" not in got_fields("de", "abwerfen", part_of_speech="verb", auxiliary="have")


def test_polish_gender_may_also_be_pl_or_mpl_for_a_plural_only_noun() -> None:
    for value in ("m", "pl", "mpl"):
        assert got_fields("pl", "spodnie", part_of_speech="noun", gender=value)["Gender"] == value
    assert "Gender" not in got_fields("pl", "spodnie", part_of_speech="noun", gender="plural")
    # The other Latin-script languages keep m, f and n only.
    assert "Gender" not in got_fields("fr", "le boulot", part_of_speech="noun", gender="pl")


def test_french_gender_is_m_or_f_and_russian_gender_is_m_f_or_n() -> None:
    assert got_fields("fr", "le boulot", part_of_speech="noun", gender="m")["Gender"] == "m"
    assert "Gender" not in got_fields("fr", "le boulot", part_of_speech="noun", gender="n")
    ru: dict[str, Any] = {"romanization": "oblik", "transliteration": "oblik"}
    assert got_fields("ru", "облик", part_of_speech="noun", gender="m", **ru)["Gender"] == "m"
    assert "Gender" not in got_fields("ru", "облик", part_of_speech="noun", gender="ж", **ru)


def test_a_russian_verb_gets_its_aspect_partner_and_first_person() -> None:
    ru: dict[str, Any] = {"romanization": "dobivatsya", "transliteration": "dobivatsya"}
    fields = got_fields(
        "ru",
        "добиваться",
        part_of_speech="verb",
        aspect_partner="добиться",
        form_i="добиваюсь",
        form_genitive="x",
        **ru,
    )
    assert fields["AspectPartner"] == "добиться" and fields["KeyForms"] == "I: добиваюсь"


def test_polish_key_forms_are_for_nouns_and_verbs_alike() -> None:
    forms: dict[str, Any] = {
        "form_genitive": "mężczyzny", "form_plural": "mężczyźni", "form_i": "mam", "form_you": "masz",
    }  # fmt: skip
    noun = got_fields(
        "pl", "ten mężczyzna", part_of_speech="noun", gender="m",
        pattern="Masculine personal, declined like a feminine noun in -a.", **forms,
    )  # fmt: skip
    assert noun["Gender"] == "m" and noun["KeyForms"] == (
        "pattern: Masculine personal, declined like a feminine noun in -a.<br>genitive: mężczyzny<br>plural: mężczyźni"
    )
    assert (
        got_fields("pl", "mieć", part_of_speech="verb", **forms)["KeyForms"]
        == "I: mam<br>you: masz"
    )
    assert "KeyForms" not in got_fields(
        "pl", "ale", part_of_speech="conjunction", pattern="x", **forms
    )


def test_a_greek_verb_gets_its_class_and_aorist_and_a_greek_noun_only_its_gender() -> None:
    el: dict[str, Any] = {"romanization": "x", "transliteration": "x"}
    verb = got_fields(
        "el", "αντιπαθώ", part_of_speech="verb", verb_class="active", form_past="αντιπάθησα", **el
    )
    assert verb["VerbClass"] == "active" and verb["KeyForms"] == "past: αντιπάθησα"
    noun = got_fields("el", "ο γραμματέας", part_of_speech="noun", gender="m", form_past="x", **el)
    assert noun["Gender"] == "m" and not {"KeyForms", "VerbClass"} & noun.keys()


def test_a_japanese_word_gets_its_kanji_in_hanzi() -> None:
    fields = got_fields(
        "ja", "服装", transliteration="ふくそう", hanzi="服(フク)clothing; 装(ソウ)adorn/dress"
    )
    assert fields["Hanzi"] == "服(フク)clothing; 装(ソウ)adorn/dress"


def test_languages_with_no_extras_get_only_the_common_fields() -> None:
    for language in ("en",):
        fields = got_fields(
            language, "x", part_of_speech="noun", gender="m", form_past="x", classifier="x"
        )
        assert set(fields) == {
            "Meaning", "Context", "ContextTranslation", "Register", "Language", "GenerateReverse",
            "PartOfSpeech",
        }  # fmt: skip
        assert fields["Language"] == {"es": "spanish", "nb": "norwegian", "en": "english"}[language]


def test_toki_pona_words_are_written_like_english_ones_with_the_decks_language_name() -> None:
    # No romanization, no extra fields, and the Language field the owner's toki pona notes carry.
    fields = got_fields("tok", "jan", part_of_speech="noun", gender="m", classifier="x")
    assert fields["Language"] == "toki pona"
    assert set(fields) == {
        "Meaning", "Context", "ContextTranslation", "Register", "Language", "GenerateReverse",
        "PartOfSpeech",
    }  # fmt: skip
    message = request_message("tok", [("jan", "person")])
    assert "written in Toki Pona" in message and "1. jan (the learner's meaning: person)" in message


def test_a_spanish_or_norwegian_noun_gets_its_gender() -> None:
    assert got_fields("es", "agua", part_of_speech="noun", gender="f")["Gender"] == "f"
    assert got_fields("nb", "bil", part_of_speech="noun", gender="m")["Gender"] == "m"
    assert got_fields("nb", "hus", part_of_speech="noun", gender="n")["Gender"] == "n"


def test_every_extra_is_a_field_of_the_note_type_and_asked_for_in_its_language() -> None:
    from franki_reader.note_queue import EXTRAS

    fields = {
        "Gender", "Plural", "Genitive", "Classifier", "KeyForms", "VerbClass", "Auxiliary",
        "AspectPartner", "Hanzi",
    }  # fmt: skip
    for language, extras in EXTRAS.items():
        message = request_message(language, [("x", "")])
        for extra in extras:
            assert extra.field in fields and f"- {extra.key}: {extra.ask}" in message


def test_a_word_that_wasnt_asked_for_is_dropped() -> None:
    assert check(filled("autre"), {"ricane": ""}, "fr") is None
    assert check("ricane", {"ricane": ""}, "fr") is None


def test_the_sentence_needs_the_word_in_bold() -> None:
    assert check(filled("ricane", context="Il <b>ricane dans."), {"ricane": ""}, "fr") is None
    # No tags at all and the word isn't in the sentence: nothing to bold, so it fails.
    assert check(filled("ricane", context="Il rit dans son coin."), {"ricane": ""}, "fr") is None


def test_a_sentence_with_no_tags_gets_the_word_bolded_in_code() -> None:
    got = check(filled("ricane", context="Il ricane dans son coin."), {"ricane": ""}, "fr")
    assert got is not None and got[1]["Context"] == "Il <b>ricane</b> dans son coin."
    # Thai has no spaces, so the word is found inside the running text.
    thai = filled(
        "เป้า",
        context="เขายิงเป้าได้แม่น",
        romanization="khǎo ying bpâo dâi mâaen",
        transliteration="bpâo",
    )
    got = check(thai, {"เป้า": ""}, "th")
    assert got is not None and got[1]["Context"] == "เขายิง<b>เป้า</b>ได้แม่น"


def test_bolding_in_code_matches_whole_words_in_a_spaced_language() -> None:
    # "ricane" only appears inside "ricaner": that's a different word, so it isn't guessed at.
    asked = {"ricane": ""}
    assert check(filled("ricane", context="Il ricanerait dans son coin."), asked, "fr") is None
    # Claude's own tags are never moved.
    got = check(filled("ricane", context="Il ricane et <b>ricane</b>."), asked, "fr")
    assert got is not None and got[1]["Context"] == "Il ricane et <b>ricane</b>."


def test_other_markup_and_stray_characters_are_refused() -> None:
    asked = {"ricane": ""}
    assert check(filled("ricane", context="Il <i><b>ricane</b></i>."), asked, "fr") is None
    assert check(filled("ricane", translation="He <b>sniggers</b>."), asked, "fr") is None
    assert check(filled("ricane", translation="He sniggers | laughs."), asked, "fr") is None
    assert check(filled("ricane", translation="He sniggers — quietly."), asked, "fr") is None


def test_a_missing_field_fails_the_word() -> None:
    assert check(filled("ricane", translation=""), {"ricane": ""}, "fr") is None
    assert check(filled("ricane", meaning=""), {"ricane": ""}, "fr") is None
    # Unless the owner gave the meaning.
    assert check(filled("ricane", meaning=""), {"ricane": "sniggers"}, "fr") is not None


def test_romanized_languages_need_both_romanizations() -> None:
    asked = {"ขอบคุณ": ""}
    thai = filled("ขอบคุณ", romanization="khàawp-khun mâak", transliteration="khàawp-khun")
    got = check(thai, asked, "th")
    assert got is not None
    assert got[1]["ContextRomanized"] == "khàawp-khun mâak"
    assert got[1]["Transliteration"] == "khàawp-khun"
    assert check(filled("ขอบคุณ"), asked, "th") is None
    # Latin-letter languages never carry them, even if Claude wrote some.
    latin = check(filled("ricane", romanization="x", transliteration="y"), {"ricane": ""}, "fr")
    assert latin is not None and "ContextRomanized" not in latin[1]


def test_a_thai_draft_without_tones_or_outside_the_scheme_is_refused() -> None:
    asked = {"ภูเขา": ""}
    ok = {
        "romanization": "chiang-mài mii phuu-khǎo sǔung láe aa-gàat yen sà-baai",
        "transliteration": "phuu-khǎo",
    }
    assert checked(filled("ภูเขา", **ok), asked, "th")[0] is not None
    # What the queue used to save: no tone marks on the sentence.
    bare = {
        "romanization": "chiang mai mi phukhao sung lae akat yen sabai",
        "transliteration": "phukhao",
    }
    assert checked(filled("ภูเขา", **bare), asked, "th") == (
        None,
        "the romanization had no tone marks",
    )
    # Letters the scheme doesn't have (IPA vowels, an unaspirated p, t or k).
    ipa = {**ok, "romanization": "khǎo dtà-goon rîak phûean khâam thà-nɔ̌ɔn"}
    assert checked(filled("ภูเขา", **ipa), asked, "th") == (
        None,
        "the romanization wasn't in the deck's scheme",
    )
    plain = {**ok, "transliteration": "pak-ka"}
    assert checked(filled("ภูเขา", **plain), asked, "th") == (
        None,
        "the romanization wasn't in the deck's scheme",
    )


def test_the_thai_request_gives_the_scheme_with_its_tones() -> None:
    message = request_message("th", [("ภูเขา", "")])
    assert "Tones: mid no mark, low à, falling â, high á, rising ǎ" in message
    assert "In romanization the Entry is spelled exactly as in transliteration" in message
    assert "Tones:" not in request_message("ru", [("дом", "")])


def test_a_japanese_word_gets_its_reading_in_kana_reading() -> None:
    asked = {"劇団": ""}
    got = check(filled("劇団", transliteration="げきだん", romanization="x"), asked, "ja")
    assert got is not None
    assert got[1]["KanaReading"] == "げきだん"
    assert "Transliteration" not in got[1] and "ContextRomanized" not in got[1]
    # Katakana is a reading too; kanji, Latin letters or none at all aren't.
    assert check(filled("劇団", transliteration="コーヒー"), asked, "ja") is not None
    assert check(filled("劇団", transliteration="げき団"), asked, "ja") is None
    assert check(filled("劇団", transliteration="gekidan"), asked, "ja") is None
    assert check(filled("劇団"), asked, "ja") is None
    assert "reading in hiragana" in request_message("ja", [("劇団", "")])


def test_the_request_lists_entries_with_the_owners_meanings() -> None:
    message = request_message("fr", [("ricane", ""), ("bouder", "to sulk")])
    assert "1. ricane\n" in message
    assert "2. bouder (the learner's meaning: to sulk)" in message


# ---- the passes ----


def run(conn: sqlite3.Connection, writer: Writer, now: datetime = NOW) -> int:
    return asyncio.run(fill_pending(conn, writer, lambda: now))


def test_waiting_words_become_ready_with_their_fields_and_share_the_cost() -> None:
    conn = conn_with(("ricane", ""), ("bouder", "to sulk"))
    writer = Writer()
    assert run(conn, writer) == 2
    assert len(writer.calls) == 1  # one call for the batch, not one a word
    a, b = store.queued_notes(conn)
    assert (a.state, a.fields["Meaning"]) == ("ready", "to snigger")
    assert (b.state, b.fields["Meaning"]) == ("ready", "to sulk")
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 2.0)}


def test_words_go_a_language_and_a_batch_at_a_time() -> None:
    conn = store.connect(":memory:")
    store.add_queued(conn, "fr", DECK, [(f"mot{i}", "") for i in range(BATCH + 1)], NOW)
    store.add_queued(conn, "pl", "Languages::Polski", [("odpuścić", "")], NOW)
    writer = Writer()
    assert run(conn, writer) == BATCH + 2
    assert [(lang, len(asked)) for lang, asked in writer.calls] == [
        ("fr", BATCH),
        ("fr", 1),
        ("pl", 1),
    ]


def test_a_mans_and_a_womans_thai_go_in_separate_calls() -> None:
    conn = store.connect(":memory:")
    store.add_queued(conn, "th", "Languages::ไทย", [("ไป", "")], NOW, "female")
    store.add_queued(conn, "th", "Languages::ไทย", [("กิน", "")], NOW)
    store.add_queued(conn, "th", "Languages::ไทย", [("นอน", "")], NOW, "female")
    writer = Writer()
    run(conn, writer)
    assert [
        (asked, who) for (_, asked), who in zip(writer.calls, writer.learners, strict=True)
    ] == [
        ([("ไป", ""), ("นอน", "")], "female"),
        ([("กิน", "")], "male"),
    ]
    assert [n.learner for n in store.queued_notes(conn)] == ["female", "male", "female"]


def test_the_card_prompt_says_whose_thai_the_sentence_is_and_only_for_thai() -> None:
    reply = json.dumps({"notes": []})
    systems = {}
    for learner in ("male", "female"):
        fake = FakeClient(response("end_turn", reply))
        finish(claude_notes(fake)("th", [("ไป", "")], learner))  # type: ignore[arg-type]
        systems[learner] = fake.calls[0]["system"]
    assert "The learner is a man" in systems["male"] and "ผม" in systems["male"]
    assert "The learner is a woman" in systems["female"] and "ดิฉัน" in systems["female"]
    fake = FakeClient(response("end_turn", reply))
    finish(claude_notes(fake)("fr", [("ricane", "")], "female"))  # type: ignore[arg-type]
    assert "The learner is a" not in fake.calls[0]["system"]


def test_the_same_word_queued_twice_is_asked_for_once() -> None:
    conn = conn_with(("ricane", ""), ("ricane", "sniggers"))
    writer = Writer()
    assert run(conn, writer) == 2
    assert len(writer.calls[0][1]) == 1
    first, second = store.queued_notes(conn)
    assert (first.fields["Meaning"], second.fields["Meaning"]) == ("to snigger", "sniggers")


def test_a_word_that_fails_the_checks_is_failed_with_a_reason_and_the_rest_are_kept() -> None:
    conn = conn_with(("ricane", ""), ("bouder", ""))
    writer = Writer(lambda lang, asked: [filled("ricane"), filled("bouder", context="Il boude.")])
    assert run(conn, writer) == 1
    ricane, bouder = store.queued_notes(conn)
    assert ricane.state == "ready"
    assert bouder.state == "failed" and "didn't pass the checks" in bouder.error
    assert "bold" in bouder.error


def test_a_failed_call_fails_its_words_without_ending_the_pass() -> None:
    conn = conn_with(("ricane", ""))
    writer = Writer(fail="Claude didn't answer (APIError).")
    assert run(conn, writer) == 0
    (note,) = store.queued_notes(conn)
    assert (note.state, note.attempts, note.error) == (
        "failed",
        1,
        "Claude didn't answer (APIError).",
    )
    assert len(writer.calls) == 1  # not asked again within the same pass


def test_a_failed_word_waits_then_is_tried_again_up_to_the_limit() -> None:
    conn = conn_with(("ricane", ""))
    failing = Writer(fail="no")
    run(conn, failing)
    assert retrying(store.queued_notes(conn)[0])  # tries left: the app shows it as trying again
    run(conn, failing, NOW + RETRY_AFTER - timedelta(seconds=1))
    assert len(failing.calls) == 1  # still waiting
    later = NOW
    for _ in range(MAX_ATTEMPTS - 1):
        later += RETRY_AFTER
        run(conn, failing, later)
    assert len(failing.calls) == MAX_ATTEMPTS
    assert not retrying(store.queued_notes(conn)[0])  # out of tries: the owner has to ask
    run(conn, Writer(), later + RETRY_AFTER)  # out of tries: stays failed
    assert store.queued_notes(conn)[0].state == "failed"


def test_a_retry_after_failing_fills_the_word() -> None:
    conn = conn_with(("ricane", ""))
    run(conn, Writer(fail="no"))
    assert run(conn, Writer(), NOW + RETRY_AFTER) == 1
    assert store.queued_notes(conn)[0].state == "ready"


def test_a_failed_call_claude_answered_shares_its_cost_among_its_words() -> None:
    conn = conn_with(("ricane", ""), ("bouder", ""))
    run(conn, Writer(fail="Claude didn't write these (refusal).", billed=COST))
    assert [n.state for n in store.queued_notes(conn)] == ["failed", "failed"]
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 2.0)}
    # The retry's cost adds to it, and the words are filled.
    assert run(conn, Writer(), NOW + RETRY_AFTER) == 2
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 4.0)}


def test_a_word_taken_off_the_queue_keeps_what_filling_it_cost() -> None:
    conn = conn_with(("ricane", ""), ("bouder", ""))
    run(conn, Writer())
    saved, _ = store.queued_notes(conn)
    assert store.delete_queued(conn, saved.id)
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 2.0)}


def test_a_word_removed_while_it_was_filled_keeps_the_cost_of_its_turn() -> None:
    conn = conn_with(("ricane", ""), ("bouder", ""))

    class RemovesOne(Writer):
        async def __call__(
            self, language: Any, asked: list[tuple[str, str]], learner: str = "male"
        ) -> Any:
            store.delete_queued(conn, store.queued_notes(conn)[0].id)  # removed mid-call
            return await super().__call__(language, asked, learner)

    run(conn, RemovesOne())
    assert len(store.queued_notes(conn)) == 1
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (2, 2.0)}


def test_a_call_claude_never_answered_costs_nothing() -> None:
    conn = conn_with(("ricane", ""))
    run(conn, Writer(fail="Claude didn't answer (APIError)."))
    assert store.queue_spending(conn, NOW - timedelta(days=1)) == {"fr": (1, 0.0)}


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"notes"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_notes_keeps_the_usage_of_an_answer_it_cant_use(
    stop_reason: str, text: str | None
) -> None:
    write = claude_notes(FakeClient(response(stop_reason, text)))  # type: ignore[arg-type]
    with pytest.raises(FillFailed) as failed:
        finish(write("fr", [("ricane", "")], "male"))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_a_ready_word_is_not_asked_for_again() -> None:
    conn = conn_with(("ricane", ""))
    run(conn, Writer())
    writer = Writer()
    assert run(conn, writer, NOW + timedelta(days=1)) == 0
    assert writer.calls == []


# ---- the endpoints ----


def queue_client(writer: Writer | None) -> TestClient:
    conn = store.connect(":memory:")
    now = [NOW]
    engine = Engine(conn, None, None, lambda: now[0], random.Random(1))
    c = started(create_app(engine, "open sesame", write_notes=writer))
    c.conn = conn  # type: ignore[attr-defined]
    c.now = now  # type: ignore[attr-defined]
    return c


def add(c: TestClient, *entries: dict[str, str], language: str = "fr") -> Any:
    return c.post(
        "/api/note-queue",
        headers=AUTH,
        json={"language": language, "deck": DECK, "entries": list(entries)},
    )


def items(c: TestClient) -> list[dict[str, Any]]:
    return c.get("/api/note-queue", headers=AUTH).json()["items"]  # type: ignore[no-any-return]


def test_queueing_a_word_returns_it_waiting_and_the_next_ask_has_it_ready() -> None:
    c = queue_client(Writer())
    r = add(c, {"entry": "ricane"}, {"entry": "bouder", "meaning": "to sulk"})
    assert r.status_code == 202
    assert [(i["entry"], i["state"]) for i in r.json()["items"]] == [
        ("ricane", "waiting"),
        ("bouder", "waiting"),
    ]
    got = items(c)
    assert [i["state"] for i in got] == ["ready", "ready"]
    assert got[0]["deck"] == DECK
    assert got[0]["fields"]["Context"] == "Il <b>ricane</b> dans son coin."
    assert got[1]["fields"]["Meaning"] == "to sulk"


def test_a_word_heard_in_a_text_keeps_its_line_as_source_and_says_where_its_clip_is() -> None:
    c = queue_client(Writer())
    source = "Il <b>ricane</b> encore.<br>He sniggers again.<br>Le Podcast: Épisode 3"
    where = {"source": source, "text_id": 7, "line": 2, "tag": "source::le-podcast"}
    heard = {"entry": "ricane", "heard": where}
    video = {"entry": "bouder", "heard": {"source": "Il boude.<br>Une vidéo", "text_id": 9}}
    assert add(c, heard, video, {"entry": "hibou"}).status_code == 202  # type: ignore[arg-type]
    got = items(c)
    assert got[0]["heard"] == where
    assert got[0]["fields"]["Source"] == source
    # No line, no clip: the source is kept on its own.
    assert got[1]["heard"] == {
        "source": "Il boude.<br>Une vidéo",
        "text_id": None,
        "line": None,
        "tag": "",
    }
    assert got[2]["heard"] is None and "Source" not in got[2]["fields"]


def test_entries_are_trimmed_and_repeats_in_one_request_are_dropped() -> None:
    c = queue_client(Writer())
    r = add(c, {"entry": "  ricane  "}, {"entry": "ricane"}, {"entry": "   "})
    assert [i["entry"] for i in r.json()["items"]] == ["ricane"]


def test_the_polite_ending_decides_whose_thai_a_queued_word_is_written_as() -> None:
    c = queue_client(Writer())
    for body in (
        {"particle": "kha", "entries": [{"entry": "ไป"}]},
        {"particle": "khrap", "entries": [{"entry": "กิน"}]},
        {"entries": [{"entry": "นอน"}]},
    ):
        base = {"language": "th", "deck": DECK}
        assert c.post("/api/note-queue", headers=AUTH, json={**base, **body}).status_code == 202
    assert [n.learner for n in store.queued_notes(c.conn)] == ["female", "male", "male"]  # type: ignore[attr-defined]
    # Only Thai has one: another language's word is queued for "male" whatever it is sent.
    body = {"language": "fr", "deck": DECK, "particle": "kha", "entries": [{"entry": "ricane"}]}
    assert c.post("/api/note-queue", headers=AUTH, json=body).status_code == 202
    assert store.queued_notes(c.conn)[-1].learner == "male"  # type: ignore[attr-defined]


def test_nothing_to_queue_is_refused() -> None:
    c = queue_client(Writer())
    assert add(c, {"entry": "   "}).status_code == 422
    assert add(c).status_code == 422


def test_without_claude_the_queue_refuses_with_the_reason() -> None:
    c = queue_client(None)
    r = add(c, {"entry": "ricane"})
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]
    assert c.get("/api/note-queue", headers=AUTH).json() == {"available": False, "items": []}


def test_a_word_that_failed_can_be_retried_and_a_missing_one_is_a_404() -> None:
    c = queue_client(Writer(fail="Claude didn't answer."))
    add(c, {"entry": "ricane"})
    (failed,) = items(c)
    assert (failed["state"], failed["error"]) == ("failed", "Claude didn't answer.")
    c.post(f"/api/note-queue/{failed['id']}/retry", headers=AUTH)
    assert c.post("/api/note-queue/999/retry", headers=AUTH).status_code == 404


def test_a_word_comes_off_the_queue_and_removing_it_twice_is_fine() -> None:
    c = queue_client(Writer())
    add(c, {"entry": "ricane"})
    (note,) = items(c)
    assert c.delete(f"/api/note-queue/{note['id']}", headers=AUTH).status_code == 204
    assert c.delete(f"/api/note-queue/{note['id']}", headers=AUTH).status_code == 204
    assert items(c) == []


def test_a_restart_with_words_still_waiting_fills_them_on_the_next_ask() -> None:
    c = queue_client(Writer())
    store.add_queued(c.conn, "fr", DECK, [("ricane", "")], NOW)  # type: ignore[attr-defined]
    assert items(c)[0]["state"] == "waiting"  # this ask starts the pass
    assert items(c)[0]["state"] == "ready"


def test_the_queue_needs_the_passphrase() -> None:
    c = queue_client(Writer())
    assert c.get("/api/note-queue").status_code in (401, 403)
    assert c.post("/api/note-queue", json={}).status_code in (401, 403)
    assert c.delete("/api/note-queue/1").status_code in (401, 403)


def test_the_costs_report_the_queue() -> None:
    c = queue_client(Writer())
    add(c, {"entry": "ricane"}, {"entry": "bouder"})
    items(c)
    block = c.get("/api/costs", headers=AUTH).json()["note_queue"]
    assert block["notes"] == 2 and block["cost_usd"] == 2.0
    assert block["languages"] == [{"language": "fr", "name": "French", "notes": 2, "cost_usd": 2.0}]


def test_the_costs_report_a_failed_call_on_the_queue() -> None:
    c = queue_client(Writer(fail="Claude didn't write these (max_tokens).", billed=COST))
    add(c, {"entry": "ricane"})
    assert items(c)[0]["state"] == "failed"
    block = c.get("/api/costs", headers=AUTH).json()["note_queue"]
    assert block["notes"] == 1 and block["cost_usd"] == 2.0


def test_a_word_sent_twice_is_queued_once() -> None:
    conn = store.connect(":memory:")
    first = store.add_queued(conn, "fr", DECK, [("ricaner", ""), ("le hibou", "owl")], NOW)
    again = store.add_queued(conn, "fr", DECK, [("le hibou", "owl"), ("la chouette", "")], NOW)
    assert again[0] == first[1]
    assert [q.entry for q in store.queued_notes(conn)] == ["ricaner", "le hibou", "la chouette"]
    # The same word for another deck is another word.
    store.add_queued(conn, "fr", "Languages::Other", [("ricaner", "")], NOW)
    assert len(store.queued_notes(conn)) == 4


# ---- a word typed the way it sounds ----


def test_a_spelling_that_differs_from_the_entry_is_kept_and_one_that_doesnt_is_empty() -> None:
    assert spelled({"spelling": "торговаться"}, "torgovatsya") == Spelled("торговаться", [])
    assert spelled({"spelling": "ricane"}, "ricane") == Spelled("", [])
    # Missing or unusable: the entry as typed stands.
    assert spelled({}, "ricane") == Spelled("", [])
    assert spelled({"spelling": "a | b"}, "ricane") == Spelled("", [])
    assert spelled({"spelling": "<i>x</i>"}, "ricane") == Spelled("", [])


def test_alternatives_are_checked_without_repeats_and_capped() -> None:
    raw = {
        "spelling": "быть",
        "alternatives": [
            {"spelling": "бить", "meaning": "to beat"},
            {"spelling": "бить", "meaning": "to hit"},  # a repeat
            {"spelling": "быть", "meaning": "to be"},  # the spelling itself
            {"spelling": "bit", "meaning": "the entry"},  # the entry as typed
            {"spelling": "вить", "meaning": ""},  # no meaning to show
            {"spelling": "пить", "meaning": "to drink"},
            "not an object",
            {"spelling": "бит", "meaning": "a bit (computing)"},
            {"spelling": "быт", "meaning": "everyday life"},
        ],
    }
    got = spelled(raw, "bit")
    assert got.spelling == "быть"
    assert got.alternatives == [
        {"spelling": "бить", "meaning": "to beat"},
        {"spelling": "пить", "meaning": "to drink"},
        {"spelling": "бит", "meaning": "a bit (computing)"},
    ]
    assert len(got.alternatives) == MAX_ALTERNATIVES


def test_the_request_asks_for_the_spelling_and_the_other_words_it_could_be() -> None:
    message = request_message("ru", [("torgovatsya", "")])
    assert "- spelling:" in message
    assert "- alternatives:" in message
    assert "the spelling alone in Latin letters" in message


def test_the_request_asks_for_the_word_in_its_dictionary_form() -> None:
    # A Greek verb is noted in the first person singular of the present, not the form typed or met.
    greek = request_message("el", [("ταξιδέψουμε", "travel")])
    assert "dictionary form: a verb in the first person singular of the present" in greek
    assert "ταξιδεύω, not ταξιδέψουμε" in greek
    assert "a verb in the infinitive (hablar" in request_message("es", [("hablé", "")])
    # A language that doesn't inflect still asks for the dictionary form, with no rules to follow.
    thai = request_message("th", [("วิ่ง", "")])
    assert "its dictionary form." in thai


def test_a_filled_word_keeps_its_spelling_and_alternatives_unless_the_owner_gave_a_meaning() -> (
    None
):
    conn = store.connect(":memory:")
    store.add_queued(conn, "ru", "Languages::Русский", [("bit", ""), ("byt", "to be")], NOW)

    def answer(language: Any, asked: list[tuple[str, str]]) -> list[dict[str, Any]]:
        return [
            filled(
                e,
                spelling="быть",
                alternatives=[{"spelling": "бить", "meaning": "to beat"}],
                context="Я хочу <b>быть</b> дома.",
                romanization="Ya khochu byt' doma.",
                transliteration="byt'",
            )
            for e, _ in asked
        ]

    assert run(conn, Writer(answer)) == 2
    a, b = store.queued_notes(conn)
    assert (a.spelling, a.alternatives) == ("быть", [{"spelling": "бить", "meaning": "to beat"}])
    # "to be" says which word was meant, so there's nothing to choose.
    assert (b.spelling, b.alternatives) == ("быть", [])


def test_the_queue_endpoint_shows_a_ready_words_spelling_and_alternatives() -> None:
    def answer(language: Any, asked: list[tuple[str, str]]) -> list[dict[str, Any]]:
        return [
            filled(
                e, spelling="ricanait", alternatives=[{"spelling": "riait", "meaning": "laughed"}]
            )
            for e, _ in asked
        ]

    c = queue_client(Writer(answer))
    with c:
        add(c, {"entry": "ricane"})
        got = items(c)
    assert (got[0]["state"], got[0]["spelling"], got[0]["alternatives"]) == (
        "ready",
        "ricanait",
        [{"spelling": "riait", "meaning": "laughed"}],
    )


def test_a_queue_from_before_spellings_gets_the_columns(tmp_path: Any) -> None:
    path = tmp_path / "reader.db"
    old = sqlite3.connect(path)
    old.execute(
        "CREATE TABLE note_queue (id INTEGER PRIMARY KEY, language TEXT NOT NULL, deck TEXT NOT NULL,"
        " entry TEXT NOT NULL, meaning TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'waiting',"
        " fields TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL"
        " DEFAULT 0, created_at TEXT NOT NULL, tried_at TEXT, cost_usd REAL NOT NULL DEFAULT 0)"
    )
    old.execute(
        "INSERT INTO note_queue (language, deck, entry, created_at) VALUES ('fr', ?, 'ricane', ?)",
        (DECK, NOW.isoformat()),
    )
    old.commit()
    old.close()
    (word,) = store.queued_notes(store.connect(path))
    assert (word.entry, word.spelling, word.alternatives) == ("ricane", "", [])


def test_a_failed_word_with_tries_left_is_marked_retrying_until_they_run_out() -> None:
    c = queue_client(Writer(fail="Claude didn't answer (APIError)."))
    add(c, {"entry": "ricane"})
    (first,) = items(c)
    assert (first["state"], first["retrying"]) == ("failed", True)
    store.save_queue_result(c.conn, first["id"], "fr", None, "no", NOW, 0.0)  # type: ignore[attr-defined]
    for _ in range(MAX_ATTEMPTS):
        store.save_queue_result(c.conn, first["id"], "fr", None, "no", NOW, 0.0)  # type: ignore[attr-defined]
    assert items(c)[0]["retrying"] is False
