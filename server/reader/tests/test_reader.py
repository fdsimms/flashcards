from scripted import ENTRIES

from franki_reader.generator import Line
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render
from franki_reader.store import StoredText

TEXT = StoredText(
    id=7,
    topic_id=1,
    title="At the stall",
    lines=(Line("A", "ฉัน|อยาก|*ข้าวเหนียวมะม่วง*|ครับ!", "I'd like mango sticky rice."),),
    glosses={"ทอน": "give change"},
    stretch=("ข้าวเหนียวมะม่วง",),
    coverage=1.0,
    roles={"A": "Vendor", "B": "Customer"},
)
MEANINGS = {e.text: e.meaning for e in ENTRIES}


def test_lines_are_split_by_the_server_with_status_and_gloss() -> None:
    out = render(TEXT, lexicon_from(ENTRIES), MEANINGS)
    words = out["lines"][0]["words"]
    assert [w["text"] for w in words] == ["ฉัน", "อยาก", "ข้าวเหนียวมะม่วง", "ครับ", "!"]
    mango = words[2]
    assert mango == {
        "text": "ข้าวเหนียวมะม่วง",
        "status": "known",
        "gloss": "mango sticky rice",
        "translit": None,
        "stretch": True,
        "deck": True,
        "grammar": None,
    }
    assert words[4] == {
        "text": "!",
        "status": None,
        "gloss": None,
        "translit": None,
        "stretch": False,
        "deck": False,
        "grammar": None,
    }
    assert out["lines"][0]["english"] == "I'd like mango sticky rice."


def test_the_speakers_roles_are_sent_with_the_text() -> None:
    assert render(TEXT, lexicon_from(ENTRIES), MEANINGS)["roles"] == {
        "A": "Vendor",
        "B": "Customer",
    }


def test_a_word_off_the_list_takes_the_models_gloss() -> None:
    text = StoredText(
        7, 1, "t", (Line("B", "ทอน|ครับ", "Here's your change."),), TEXT.glosses, (), 0.5
    )
    words = render(text, lexicon_from(ENTRIES), MEANINGS)["lines"][0]["words"]
    assert words[0] == {
        "text": "ทอน",
        "status": "unknown",
        "gloss": "give change",
        "translit": None,
        "stretch": False,
        "deck": False,  # unreviewed, so not counted as a deck word
        "grammar": None,
    }


def test_a_compound_of_deck_words_is_glossed_from_its_pieces() -> None:
    entries = [*ENTRIES, Entry(10, "ร้าน", "shop", "mature"), Entry(11, "อาหาร", "food", "mature")]
    text = StoredText(7, 1, "t", (Line("A", "ร้านอาหาร", "A restaurant."),), {}, (), 1.0)
    meanings = {e.text: e.meaning for e in entries}
    word = render(text, lexicon_from(entries), meanings)["lines"][0]["words"][0]
    assert word["text"] == "ร้านอาหาร"
    assert word["status"] == "known"
    assert word["gloss"] == "shop + food"


def test_a_word_off_the_list_takes_the_models_transliteration() -> None:
    text = StoredText(
        7,
        1,
        "t",
        (Line("B", "ทอน|ครับ", "Here's your change."),),
        TEXT.glosses,
        (),
        0.5,
        translits={"ทอน": "thɔɔn"},
    )
    words = render(text, lexicon_from(ENTRIES), MEANINGS)["lines"][0]["words"]
    assert words[0]["translit"] == "thɔɔn"
    assert words[1]["translit"] is None


def test_a_deck_words_own_transliteration_wins_over_the_models() -> None:
    entries = [*ENTRIES, Entry(10, "ทอน", "change", "mature", translit="thɔɔn")]
    text = StoredText(
        7, 1, "t", (Line("B", "ทอน", "Change."),), {}, (), 1.0, translits={"ทอน": "tohn"}
    )
    deck = {e.text: e.translit for e in entries if e.translit}
    word = render(text, lexicon_from(entries), {}, deck)["lines"][0]["words"][0]
    assert word["translit"] == "thɔɔn"


def test_a_compound_of_deck_words_is_transliterated_from_its_pieces() -> None:
    entries = [
        Entry(10, "ร้าน", "shop", "mature", translit="ráan"),
        Entry(11, "อาหาร", "food", "mature", translit="aa-hǎan"),
    ]
    text = StoredText(7, 1, "t", (Line("A", "ร้านอาหาร", "A restaurant."),), {}, (), 1.0)
    deck = {e.text: e.translit for e in entries}
    word = render(text, lexicon_from(entries), {}, deck)["lines"][0]["words"][0]
    assert word["translit"] == "ráan + aa-hǎan"
