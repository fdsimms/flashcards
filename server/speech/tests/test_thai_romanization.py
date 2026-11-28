from franki_speech.thai_romanization import (
    THAI_SCHEME,
    is_toneless,
    letters_wrong,
    tone_mismatch,
    tones_of,
    tones_of_ipa,
)


def test_letters_outside_the_scheme_are_wrong() -> None:
    for fine in ("phuu-khǎo", "dtà-goon", "bpàak-gaa", "rə̂əm", "khàaeng", "khǎo glàp bâan láaeo"):
        assert not letters_wrong(fine), fine
    for wrong in ("pak-ka", "ta-kohn", "thà-nɔ̌ɔn", "Khǎo", "kʉ̂n", "bâan."):
        assert letters_wrong(wrong), wrong


def test_a_sentence_with_four_syllables_and_no_mark_is_toneless() -> None:
    assert is_toneless("chiang mai mi phukhao sung lae")
    assert not is_toneless("chiang mai mi phûukhǎo")
    assert not is_toneless("phukhao sung")  # too short to say


def test_tones_are_read_from_marks_and_from_ipa() -> None:
    assert tones_of("phuu-khǎo") == ["mid", "rising"]
    assert tones_of("rə̂əm dtà-goon sǔung") == ["falling", "low", "mid", "rising"]
    assert tones_of_ipa("/pʰuː˧.kʰaw˩˩˦/") == ["mid", "rising"]
    assert tones_of_ipa("/kaːn˧.kʰɛŋ˨˩.kʰan˩˩˦/") == ["mid", "low", "rising"]
    assert tones_of_ipa("/t͡ɕʰat̚˦˥/") == ["high"]
    # No tone letters, or one this doesn't know: nothing to compare against.
    assert tones_of_ipa("/pʰuːkʰaw/") is None
    assert tones_of_ipa("/pʰuː˧˦˧/") is None
    assert tones_of_ipa("") is None


def test_marks_that_disagree_with_the_ipa_are_reported() -> None:
    assert tone_mismatch("phuu-khǎo", "/pʰuː˧.kʰaw˩˩˦/") is None
    assert tone_mismatch("phuu-khao", "/pʰuː˧.kʰaw˩˩˦/") == (["mid", "mid"], ["mid", "rising"])
    # Written without hyphens it is one token: the marked tones are compared instead.
    assert tone_mismatch("phukhao", "/pʰuː˧.kʰaw˩˩˦/") == (["mid"], ["mid", "rising"])
    assert tone_mismatch("phukhǎo", "/pʰuː˧.kʰaw˩˩˦/") is None
    assert tone_mismatch("mai", "/maj˧/") is None
    assert tone_mismatch("", "/pʰuː˧.kʰaw˩˩˦/") is None
    # A syllable missing from the romanization drops a marked tone.
    assert tone_mismatch("gaan-khàaeng", "/kaːn˧.kʰɛŋ˨˩.kʰan˩˩˦/") is not None


def test_the_scheme_keeps_its_tone_rule() -> None:
    assert "Tones: mid no mark, low à, falling â, high á, rising ǎ" in THAI_SCHEME
