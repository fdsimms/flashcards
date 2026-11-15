"""A story's characters: finding their quotations, giving each a voice, and cutting a line into the
voices that speak it (cast.py)."""

from franki_speech import Part

from franki_reader.cast import (
    AGE_PITCH,
    CastVoice,
    Speaker,
    assign,
    line_parts,
    parse_speakers,
    quotation_texts,
    quote_problems,
    quote_spans,
)

# Russian has one man's voice and two women's, so it runs out of voices soonest.
RU = {
    "male": "ru-RU-DmitryNeural",
    "male2": "ru-RU-DmitryNeural",
    "female": "ru-RU-SvetlanaNeural",
    "female2": "ru-RU-DariyaNeural",
}
ANYA = Speaker("Аня", "female", "child")
MAMA = Speaker("Мама", "female", "adult")
LINE = "«Мама, туда нельзя!» — говорит Аня, и ей очень неловко. «Почему?» — удивляется мама."


def quoted(text: str) -> list[str]:
    return [text[a:b] for a, b in quote_spans(text)]


def test_quotations_are_found_by_the_languages_marks() -> None:
    assert quoted(LINE) == ["«Мама, туда нельзя!»", "«Почему?»"]
    assert quoted("“ฉัน|กิน” เขา|พูด") == ["“ฉัน|กิน”"]
    assert quoted("„Ja“, sagt er, „nein”.") == ["„Ja“", "„nein”"]
    assert quoted("「はい」と言った。") == ["「はい」"]
    assert quoted('He said "yes" and "no".') == ['"yes"', '"no"']


def test_a_mark_that_is_never_closed_starts_nothing_and_no_marks_means_none() -> None:
    assert quote_spans("«Мама, туда нельзя") == []
    assert quote_spans("На кухне горит свет.") == []


def test_speakers_are_read_from_the_draft_and_the_bad_ones_left_out() -> None:
    found = parse_speakers(
        [
            {"name": " Аня ", "gender": "female", "age": "child"},
            {"name": "аня", "gender": "male", "age": "elder"},  # the same name again
            {"name": "Тишка", "gender": "none", "age": "child"},  # no gender to read in
            {"name": "Дед", "gender": "male", "age": "ancient"},  # an age that isn't one
            {"name": "", "gender": "male", "age": "adult"},
            "Мама",
        ]
    )
    assert found == (Speaker("Аня", "female", "child"), Speaker("Дед", "male", "adult"))
    assert parse_speakers(None) == () and parse_speakers("x") == ()


def test_each_character_gets_a_voice_nobody_else_has_and_the_narrator_keeps_the_mans() -> None:
    got = assign([ANYA, MAMA, Speaker("Папа", "male", "adult")], {}, RU)
    voices = {name: (v.voice, v.pitch) for name, v in got.items()}
    assert voices["Аня"] == (RU["female"], AGE_PITCH["child"])
    # A second woman is the second woman's voice; the man shares the narrator's only voice, higher.
    assert voices["Мама"] == (RU["female"], 0)
    assert voices["Папа"] == (RU["male"], 10)
    assert len(set(voices.values())) == 3


def test_a_child_is_higher_and_an_elder_lower_than_an_adult_of_the_same_voice() -> None:
    got = assign([Speaker("Дед", "male", "elder"), Speaker("Мальчик", "male", "child")], {}, RU)
    assert got["Дед"].pitch == AGE_PITCH["elder"] and got["Мальчик"].pitch == AGE_PITCH["child"]


def test_two_women_use_both_voices_before_a_third_shares_one_at_another_pitch() -> None:
    women = [Speaker(n, "female", "adult") for n in ("Ира", "Ася", "Вера")]
    got = assign(women, {}, RU)
    assert [(v.voice, v.pitch) for v in got.values()] == [
        (RU["female"], 0),
        (RU["female2"], 0),
        (RU["female"], 10),
    ]


def test_a_character_who_has_a_voice_keeps_it_and_the_next_gets_one_that_is_left() -> None:
    known = {"Аня": CastVoice("female", "child", "ru-RU-DariyaNeural", 18)}
    # Told again, as the model might, they're not given another; settings changing since doesn't move them.
    assert assign([ANYA], known, {**RU, "female": "other-voice"}) == {}
    assert assign([Speaker("аня", "female", "adult")], known, RU) == {}
    new = assign([MAMA], known, RU)
    assert new["Мама"].voice == RU["female"] and new["Мама"].pitch == 0


def test_voices_are_used_up_before_any_is_reused() -> None:
    many = [Speaker(f"M{i}", "male", "adult") for i in range(30)]
    got = assign(many, {}, RU)
    assert len(got) == 30  # every one of them got something, however crowded


def test_a_line_is_cut_into_the_narrator_and_each_character_in_order() -> None:
    cast = {
        "Аня": CastVoice("female", "child", "ru-RU-DariyaNeural", 18),
        "Мама": CastVoice("female", "adult", "ru-RU-SvetlanaNeural", 0),
    }
    parts = line_parts(LINE, ["Аня", "Мама"], cast, "narr")
    assert parts == [
        Part("«Мама, туда нельзя!»", "ru-RU-DariyaNeural", 18),
        Part(" — говорит Аня, и ей очень неловко. ", "narr"),
        Part("«Почему?»", "ru-RU-SvetlanaNeural", 0),
        Part(" — удивляется мама.", "narr"),
    ]
    assert "".join(p.text for p in parts) == LINE  # the words keep their timing


def test_a_quotation_nobody_is_named_for_or_with_no_voice_stays_the_narrators() -> None:
    cast = {"Аня": CastVoice("female", "child", "ru-RU-DariyaNeural", 18)}
    assert line_parts(LINE, [], cast, "narr") == [Part(LINE, "narr")]
    assert line_parts(LINE, ["Неизвестный", "аня"], cast, "narr") == [
        Part(LINE[: LINE.index("«Почему")], "narr"),
        Part("«Почему?»", "ru-RU-DariyaNeural", 18),
        Part(" — удивляется мама.", "narr"),
    ]
    assert line_parts("Тихо.", ["Аня"], cast, "narr") == [Part("Тихо.", "narr")]


def test_attributions_that_dont_match_the_quotations_are_sent_back() -> None:
    known = {"Аня": 1, "Мама": 2}
    assert quote_problems([(LINE, ["Аня", "Мама"]), ("Тихо.", [])], known) == []
    problems = quote_problems([("Тихо.", []), (LINE, ["Аня"])], known)
    assert len(problems) == 1 and problems[0].startswith("Line 2 has 2 quotations but")
    problems = quote_problems([(LINE, ["Аня", "Тишка"])], known)
    assert len(problems) == 1 and '"Тишка"' in problems[0] and "speakers" in problems[0]


def test_many_bad_lines_are_counted_not_listed() -> None:
    problems = quote_problems([(LINE, [])] * 7, {})
    assert len(problems) == 5 and problems[-1] == "3 more lines have the same problem."


def test_each_quotation_comes_with_who_says_it() -> None:
    assert quotation_texts(LINE, ["Аня", "Мама"]) == [
        ("Аня", "«Мама, туда нельзя!»"),
        ("Мама", "«Почему?»"),
    ]
    assert quotation_texts(LINE, ["Аня"]) == []
