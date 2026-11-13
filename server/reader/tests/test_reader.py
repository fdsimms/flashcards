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
        "lemma": None,
        "translit": None,
        "stretch": True,
        "deck": True,
        "wanikani": False,
        "rank": None,
        "grammar": None,
    }
    assert words[4] == {
        "text": "!",
        "status": None,
        "gloss": None,
        "lemma": None,
        "translit": None,
        "stretch": False,
        "deck": False,
        "wanikani": False,
        "rank": None,
        "grammar": None,
    }
    assert out["lines"][0]["english"] == "I'd like mango sticky rice."


def test_a_lines_paragraph_mark_is_sent_with_it() -> None:
    text = StoredText(
        7,
        1,
        "t",
        (Line("N", "ฉัน", "I.", True), Line("N", "กิน", "Eat.")),
        {},
        (),
        1.0,
        form="story",
    )
    lines = render(text, lexicon_from(ENTRIES), MEANINGS)["lines"]
    assert [ln["paragraph"] for ln in lines] == [True, False]


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
        "lemma": None,
        "translit": None,
        "stretch": False,
        "deck": False,  # unreviewed, so not counted as a deck word
        "wanikani": False,
        "rank": 4787,
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


def test_a_marked_name_is_sent_with_the_name_status() -> None:
    text = StoredText(
        7,
        1,
        "t",
        (Line("A", "~สมชาย~|กิน|ครับ", "Somchai eats."),),
        {"สมชาย": "a man's name"},
        (),
        1.0,
    )
    words = render(text, lexicon_from(ENTRIES), MEANINGS)["lines"][0]["words"]
    assert [(w["text"], w["status"]) for w in words][:1] == [("สมชาย", "name")]
    assert words[0]["gloss"] == "a man's name"


def test_a_form_is_sent_with_its_dictionary_form_and_thai_has_none() -> None:
    from franki_reader.reader import lemma_for

    polish = lexicon_from([Entry(1, "rozumieć", "to understand", "mature")], "pl")
    assert lemma_for("Rozumiem", polish) == "rozumieć"
    assert lemma_for("rozumieć", polish) is None  # already the dictionary form
    assert lemma_for("ptak", polish) is None
    assert lemma_for("ฉัน", lexicon_from(ENTRIES)) is None


def test_a_line_says_its_register_or_nothing_for_an_older_text() -> None:
    text = StoredText(
        7,
        1,
        "t",
        (Line("A", "ฉัน", "I.", False, "casual"), Line("B", "กิน", "Eat.")),
        {},
        (),
        1.0,
    )
    out = render(text, lexicon_from(ENTRIES), MEANINGS)
    assert [ln["register"] for ln in out["lines"]] == ["casual", ""]
