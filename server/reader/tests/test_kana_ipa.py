"""Kana to IPA by rule (kana_ipa.py), in the style Wiktionary uses for Tokyo Japanese."""

import pytest

from franki_reader.kana_ipa import ipa_of_reading


@pytest.mark.parametrize(
    ("reading", "ipa"),
    [
        ("しんぶん", "/ɕimbɯɴ/"),  # ん before a lip sound is m, at the end ɴ
        ("にほんご", "/ɲihoŋɡo/"),  # before g it's ŋ
        ("とうきょう", "/toːkʲoː/"),  # おう is long, きょ is palatalized
        ("せんせい", "/senseː/"),  # えい is long, ん before s is n
        ("ざっし", "/dzaɕɕi/"),  # っ doubles the next consonant
        ("いっぱい", "/ippai/"),
        ("おおきい", "/oːkiː/"),  # a repeated vowel is long
        ("コーヒー", "/koːçiː/"),  # katakana, and ー lengthens
        ("ひゃく", "/çakɯ/"),
        ("は", "/wa/"),  # a lone particle is read as one
        ("を", "/o/"),
    ],
)
def test_a_reading_becomes_ipa(reading: str, ipa: str) -> None:
    assert ipa_of_reading(reading) == ipa


@pytest.mark.parametrize("reading", ["", "ABC", "13にち", "きます1", "漢字"])
def test_anything_but_kana_has_none(reading: str) -> None:
    assert ipa_of_reading(reading) is None
