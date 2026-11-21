from datetime import date

from franki_reader.coverage import Lexicon
from franki_reader.generator import TextRequest, request_message
from franki_reader.met import MET_DAYS, MetWord, PastReading, pick_met

LEXICON = Lexicon(["ฉัน", "อยาก", "กิน", "ครับ"])
GLOSSES = {"ทอน": "give change", "ร่ม": "umbrella", "ฉัน": "I"}
TODAY = date(2026, 11, 20)


def read(day: int, line: str, *looked_up: str) -> PastReading:
    return PastReading(date(2026, 11, day), (line,), looked_up, GLOSSES)


def test_a_word_looked_up_outside_the_deck_is_offered_on_a_later_day() -> None:
    picked = pick_met([read(18, "ฉัน|อยาก|ทอน|ครับ", "ทอน")], LEXICON, TODAY)
    assert picked == [MetWord("ทอน", "give change")]


def test_a_known_word_and_a_word_never_looked_up_are_not() -> None:
    assert pick_met([read(18, "ฉัน|อยาก|ทอน|ครับ", "ฉัน")], LEXICON, TODAY) == []
    assert pick_met([read(18, "ฉัน|อยาก|ทอน|ครับ")], LEXICON, TODAY) == []


def test_a_word_the_deck_has_since_learned_is_left_alone() -> None:
    learned = Lexicon(["ฉัน", "อยาก", "กิน", "ครับ", "ทอน"])
    assert pick_met([read(18, "ฉัน|อยาก|ทอน|ครับ", "ทอน")], learned, TODAY) == []


def test_a_word_already_met_today_waits_for_another_day() -> None:
    readings = [read(18, "ฉัน|ทอน|ครับ", "ทอน"), read(20, "ฉัน|กิน|ทอน|ครับ")]
    assert pick_met(readings, LEXICON, TODAY) == []


def test_a_word_is_left_alone_once_met_on_enough_days_whichever_text_brought_it() -> None:
    readings = [read(10, "ฉัน|ทอน|ครับ", "ทอน")]
    readings += [read(10 + n, "ฉัน|กิน|ทอน|ครับ") for n in range(1, MET_DAYS - 1)]
    assert [w.text for w in pick_met(readings, LEXICON, TODAY)] == ["ทอน"]
    readings.append(read(10 + MET_DAYS - 1, "ทอน|ครับ"))
    assert pick_met(readings, LEXICON, TODAY) == []


def test_the_words_met_least_come_first_and_only_a_few_are_offered() -> None:
    readings = [
        read(15, "ฉัน|ทอน|ครับ", "ทอน"),
        read(16, "ฉัน|ทอน|ร่ม|ครับ", "ร่ม"),
    ]
    assert [w.text for w in pick_met(readings, LEXICON, TODAY)] == ["ร่ม", "ทอน"]
    assert [w.text for w in pick_met(readings, LEXICON, TODAY, 1)] == ["ร่ม"]


def test_the_request_lists_them_as_words_outside_the_list() -> None:
    message = request_message(TextRequest("food", met=(MetWord("ทอน", "give change"),)))
    assert "Words met before" in message
    assert "- ทอน (give change)" in message
    assert "Words met before" not in request_message(TextRequest("food"))
