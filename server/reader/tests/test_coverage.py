import pytest

from franki_reader.coverage import FLOOR, Lexicon, check, parse_line, segment_line

# The four phrases are real entries in the Thai deck, and the brief's feasibility test called out the
# words inside them (ข้าวเหนียว, รับ, เก็บ, ตุ๊กตุ๊ก) as false misses: the deck has them only inside
# these phrases. ทอน is a word the deck lacks entirely.
DECK = [
    "ข้าวเหนียวมะม่วง",
    "รับอะไรดี",
    "เก็บเงิน",
    "รถตุ๊กตุ๊ก",
    "ฉัน",
    "อยาก",
    "กิน",
    "ครับ",
    "ร้าน",
    "อาหาร",
    "บาท",
    "ไป",
    "ไหน",
    "มะม่วง",
]


@pytest.fixture(scope="module")
def lexicon() -> Lexicon:
    return Lexicon(DECK)


def statuses(lines: list[str], lexicon: Lexicon) -> dict[str, str]:
    return {t.text: t.status for t in check(lines, lexicon).tokens}


def test_a_deck_phrase_stays_one_known_token(lexicon: Lexicon) -> None:
    assert statuses(["ฉันอยากกินข้าวเหนียวมะม่วงครับ"], lexicon) == {
        "ฉัน": "known",
        "อยาก": "known",
        "กิน": "known",
        "ข้าวเหนียวมะม่วง": "known",
        "ครับ": "known",
    }


@pytest.mark.parametrize("word", ["ข้าวเหนียว", "รับ", "เก็บ", "ตุ๊กตุ๊ก"])
def test_a_word_only_inside_a_deck_phrase_is_partial(lexicon: Lexicon, word: str) -> None:
    assert word in lexicon.partial
    assert statuses([f"ฉัน{word}ครับ"], lexicon)[word] == "partial"


def test_partial_counts_as_unknown_for_coverage(lexicon: Lexicon) -> None:
    result = check(["ฉันกินข้าวเหนียว"], lexicon)
    assert (result.known, result.counted) == (2, 3)
    assert result.words("partial") == ["ข้าวเหนียว"]


def test_a_word_inside_a_phrase_that_is_also_an_entry_is_not_partial(lexicon: Lexicon) -> None:
    assert "มะม่วง" not in lexicon.partial
    assert "รถ" in lexicon.partial


def test_partial_is_found_by_segmenting_not_by_substring(lexicon: Lexicon) -> None:
    # ครับ contains the letters of รับ, but รับ isn't a word inside it.
    assert statuses(["ครับ"], lexicon) == {"ครับ": "known"}


def test_a_word_outside_the_deck_is_unknown(lexicon: Lexicon) -> None:
    result = check(["ฉัน|ทอน|ครับ"], lexicon)
    assert result.words("unknown") == ["ทอน"]
    assert result.words("partial") == []


def test_a_token_that_splits_into_entries_is_known(lexicon: Lexicon) -> None:
    # ร้านอาหาร is one word in PyThaiNLP's dictionary; the deck has ร้าน and อาหาร.
    assert statuses(["ร้านอาหาร"], lexicon) == {"ร้านอาหาร": "known"}


def test_a_token_that_splits_into_entries_is_known_even_inside_a_longer_entry() -> None:
    # With ร้านอาหารไทย in the deck too, ร้านอาหาร is inside a phrase, but it's still ร้าน + อาหาร.
    assert statuses(["ร้านอาหาร"], Lexicon([*DECK, "ร้านอาหารไทย"])) == {"ร้านอาหาร": "known"}


def test_numbers_are_known_and_spaces_and_punctuation_are_not_counted(lexicon: Lexicon) -> None:
    result = check(["25 บาท ครับ!", "๑๐๐ บาท"], lexicon)
    assert [t.text for t in result.tokens] == ["25", "บาท", "ครับ", "๑๐๐", "บาท"]
    assert result.ratio == 1.0


def test_the_models_word_breaks_are_ignored(lexicon: Lexicon) -> None:
    # The model glued an unknown word onto a known one. Re-segmenting catches it.
    result = check(["ฉัน|กินทอน|ครับ"], lexicon)
    assert "ทอน" in result.words("unknown")
    assert not result.meets()


def test_stretch_words_are_read_from_asterisks() -> None:
    assert parse_line("ฉัน|ต้องการ|*น้ำ*") == ("ฉันต้องการน้ำ", ["น้ำ"])


def test_a_thai_space_marks_a_clause_break_and_is_kept() -> None:
    assert parse_line("สวัสดี|ค่ะ รับ|อะไร|ดี|คะ?")[0] == "สวัสดีค่ะ รับอะไรดีคะ?"
    assert parse_line("ครับ   *ไป*|ไหน")[0] == "ครับ ไปไหน"
    assert parse_line("OK ค่ะ")[0] == "OK ค่ะ"


def test_a_space_beside_a_bar_is_dropped() -> None:
    assert parse_line("ฉัน | ต้องการ| *น้ำ* ") == ("ฉันต้องการน้ำ", ["น้ำ"])


def test_a_space_after_a_clause_opening_connective_is_dropped() -> None:
    assert parse_line("เขา|ดู|เด็ก แล้ว เดิน|มา")[0] == "เขาดูเด็ก แล้วเดินมา"
    assert parse_line("แต่ เขา|หิว")[0] == "แต่เขาหิว"
    assert parse_line("*แล้ว* เดิน")[0] == "แล้วเดิน"
    assert parse_line("ถ้า|ฝน|ตก ก็ ไม่|ไป")[0] == "ถ้าฝนตก ก็ไม่ไป"
    assert parse_line("เขา|หิว จึง กิน")[0] == "เขาหิว จึงกิน"
    # Ending a clause, it keeps the space after it.
    assert parse_line("กิน|ข้าว|แล้ว เขา|ไป")[0] == "กินข้าวแล้ว เขาไป"


def test_a_clause_break_is_not_counted_as_a_word(lexicon: Lexicon) -> None:
    result = check(["ฉัน|อยาก|กิน ไป|ไหน|ครับ"], lexicon)
    assert [t.text for t in result.tokens] == ["ฉัน", "อยาก", "กิน", "ไป", "ไหน", "ครับ"]


def test_stretch_words_are_listed_once_in_order(lexicon: Lexicon) -> None:
    result = check(["*ทอน*|ครับ", "ฉัน|*เก็บ*|*ทอน*"], lexicon)
    assert result.stretch_words == ("ทอน", "เก็บ")


def test_floor() -> None:
    lexicon = Lexicon(["ฉัน"])
    nine_known = ["ฉัน"] * 9
    assert check([*nine_known, "ทอน"], lexicon).meets(FLOOR)
    assert not check([*nine_known[:8], "ทอน"], lexicon).meets(FLOOR)


def test_empty_text_does_not_pass() -> None:
    assert not check([], Lexicon(["ฉัน"])).meets()


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("ฉันถามอีกว่า", ["ฉัน", "ถาม", "อีก", "ว่า"]),
        ("ฉันบอกว่าไม่ไป", ["ฉัน", "บอก", "ว่า", "ไม่", "ไป"]),
        ("เขาออกว่าจะมา", ["เขา", "ออก", "ว่า", "จะ", "มา"]),
        ("เขามาจากว่า", ["เขา", "มาจาก", "ว่า"]),
        ("ฉันต้องไปประตูไหนคะ", ["ฉัน", "ต้อง", "ไป", "ประตู", "ไหน", "คะ"]),
        ("แล้วจะไป", ["แล้ว", "จะ", "ไป"]),
        ("ตามมากไป", ["ตาม", "มาก", "ไป"]),
    ],
)
def test_a_letter_glued_to_a_particle_goes_back_to_its_word(
    lexicon: Lexicon, line: str, expected: list[str]
) -> None:
    assert lexicon.segment(line) == expected


@pytest.mark.parametrize(
    ("line", "expected"),
    [("ราคาถูกกว่า", ["ราคา", "ถูก", "กว่า"]), ("ดีกว่าเดิม", ["ดีกว่า", "เดิม"])],
)
def test_a_real_kwa_is_left_alone(lexicon: Lexicon, line: str, expected: list[str]) -> None:
    assert lexicon.segment(line) == expected


def test_a_marked_name_is_not_counted_for_or_against_coverage(lexicon: Lexicon) -> None:
    # สมชาย isn't in the deck: unmarked, its two syllables are unknown words and lower coverage.
    assert check(["สมชาย|กิน|ครับ"], lexicon).words("unknown") == ["สม", "ชาย"]
    marked = check(["~สมชาย~|กิน|ครับ"], lexicon)
    assert [t.text for t in marked.tokens] == ["กิน", "ครับ"]
    assert marked.names == ("สมชาย",)
    assert marked.meets()


def test_the_name_marks_are_dropped_from_the_plain_text() -> None:
    assert parse_line("~สมชาย~|*กิน*|ครับ") == ("สมชายกินครับ", ["กิน"])
    assert parse_line("~Kasia~|mieszka|*tu*.", True) == ("Kasia mieszka tu.", ["tu"])


def test_only_the_marked_occurrence_is_a_name(lexicon: Lexicon) -> None:
    # มะม่วง is a deck word (mango) that is also used here as a name, once.
    pieces = segment_line("มะม่วง|กิน|~มะม่วง~", lexicon)
    assert [(p, n) for p, n in pieces if p == "มะม่วง"] == [("มะม่วง", False), ("มะม่วง", True)]


def test_names_are_listed_once_in_order(lexicon: Lexicon) -> None:
    result = check(["~สมชาย~|ไป", "~มาลี~|กับ|~สมชาย~"], lexicon)
    assert result.names == ("สมชาย", "มาลี")
