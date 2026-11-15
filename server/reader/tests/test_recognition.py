from franki_reader.coverage import Lexicon
from franki_reader.recognition import measure

LEXICON = Lexicon(["ฉัน", "อยาก", "กิน", "ครับ"])
LINES = ["ฉัน|อยาก|กิน|ครับ", "ฉัน|กิน|ทอน|ครับ"]  # 8 words, 7 known (ฉัน, กิน, ครับ twice), ทอน off


def test_counts_the_known_words_looked_up() -> None:
    r = measure(LINES, LEXICON, ["ฉัน", "ทอน"])
    assert (r.tokens, r.known_tokens) == (8, 7)
    # ฉัน is twice in the text; ทอน isn't known, so looking it up says nothing about recognition.
    assert (r.looked_up_tokens, r.known_types, r.looked_up_types) == (2, 4, 1)
    assert r.verified == 7 / 8
    assert r.effective == 5 / 8


def test_looking_up_nothing_leaves_effective_at_verified() -> None:
    r = measure(LINES, LEXICON, [])
    assert r.effective == r.verified == 7 / 8


def test_an_empty_text_measures_zero_not_an_error() -> None:
    r = measure([], LEXICON, ["ฉัน"])
    assert (r.tokens, r.verified, r.effective) == (0, 0.0, 0.0)
