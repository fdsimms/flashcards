from franki_reader.gender import full_voices, gender_problems, voice_for
from franki_reader.languages import LANGUAGES, VOICE_SLOTS

VOICES = {
    "male": "m1",
    "male2": "m2",
    "female": "f1",
    "female2": "f2",
}


def test_a_man_and_a_woman_each_get_the_first_voice_of_their_gender() -> None:
    genders = {"A": "male", "B": "female"}
    assert voice_for("A", genders, VOICES) == "m1"
    assert voice_for("B", genders, VOICES) == "f1"
    swapped = {"A": "female", "B": "male"}
    assert voice_for("A", swapped, VOICES) == "f1"
    assert voice_for("B", swapped, VOICES) == "m1"


def test_two_speakers_of_one_gender_are_read_in_different_voices() -> None:
    assert voice_for("A", {"A": "male", "B": "male"}, VOICES) == "m1"
    assert voice_for("B", {"A": "male", "B": "male"}, VOICES) == "m2"
    assert voice_for("A", {"A": "female", "B": "female"}, VOICES) == "f1"
    assert voice_for("B", {"A": "female", "B": "female"}, VOICES) == "f2"


def test_the_narrator_and_texts_from_before_genders_keep_their_voices() -> None:
    assert voice_for("N", {}, VOICES) == "m1"
    assert voice_for("N", {"A": "female", "B": "female"}, VOICES) == "m1"
    assert voice_for("A", {}, VOICES) == "m1"
    assert voice_for("B", {}, VOICES) == "f1"


def test_a_second_voice_a_language_lacks_is_the_first_of_its_gender() -> None:
    thai = full_voices(LANGUAGES["th"].voices)
    assert thai["male2"] == thai["male"] == "th-TH-NiwatNeural"
    assert thai["female2"] == "th-TH-AcharaNeural"
    for language in LANGUAGES.values():
        assert list(full_voices(language.voices)) == list(VOICE_SLOTS)


def test_a_thai_line_with_a_word_of_the_other_gender_is_a_problem() -> None:
    genders = {"A": "male", "B": "female"}
    fits = [("A", "สวัสดี|ครับ"), ("B", "สวัสดี|ค่ะ ไป|ไหน|คะ")]
    assert gender_problems("th", fits, genders) == []
    problems = gender_problems("th", [("A", "สวัสดี|ค่ะ"), ("B", "ไป|ไหน|ครับ")], genders)
    assert len(problems) == 2
    assert "Speaker A is a man" in problems[0] and "ค่ะ" in problems[0]
    assert "Speaker B is a woman" in problems[1] and "ครับ" in problems[1]


def test_the_check_reads_a_word_whether_or_not_the_model_split_it() -> None:
    woman = {"A": "female", "B": "female"}
    assert gender_problems("th", [("A", "ไปไหนครับ")], woman)
    assert gender_problems("th", [("A", "ผม|ชื่อ|ปีเตอร์")], woman)
    man = {"A": "male", "B": "male"}
    assert gender_problems("th", [("A", "ไป|ไหน|คะ")], man)
    assert gender_problems("th", [("A", "ไปไหนค่ะ")], man)
    assert gender_problems("th", [("A", "ดิฉัน|ชื่อ|ปีเตอร์")], man)


def test_words_that_only_look_like_a_gendered_one_are_not_flagged() -> None:
    man = {"A": "male", "B": "male"}
    # คะแนน is "score", and ฉัน is said by men too.
    assert gender_problems("th", [("A", "คะแนน|ของ|ฉัน|ครับ")], man) == []
    woman = {"A": "female", "B": "female"}
    # ผมยาว is "long hair": only a whole ผม counts, since it also starts other words.
    assert gender_problems("th", [("A", "ผมยาว|ค่ะ")], woman) == []


def test_the_narrator_and_the_other_languages_are_not_checked() -> None:
    assert gender_problems("th", [("N", "เขา|กิน|ค่ะ")], {"A": "male", "B": "male"}) == []
    assert gender_problems("es", [("A", "Estoy|cansada")], {"A": "male", "B": "female"}) == []


def test_only_the_first_few_problems_are_named_and_the_rest_counted() -> None:
    lines = [("A", "ค่ะ")] * 7
    problems = gender_problems("th", lines, {"A": "male", "B": "female"})
    assert len(problems) == 5 and problems[-1] == "3 more lines have the same problem."
