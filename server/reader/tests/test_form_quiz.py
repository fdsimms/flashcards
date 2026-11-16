"""Form quiz: which words the app hides behind a fill-in slot, and that the choice comes from what the
text already carries, is the same every time, and leaves a short text alone."""

from typing import Any

from franki_reader import form_quiz
from franki_reader.generator import Line
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.reader import render
from franki_reader.store import StoredText


def w(
    text: str,
    form: str | None = None,
    lemma: str | None = None,
    **over: Any,
) -> dict[str, Any]:
    """A word as the reader serves it: known, with a dictionary form and a form, unless said."""
    word: dict[str, Any] = {
        "text": text,
        "status": "known",
        "stretch": False,
        "lemma": lemma,
        "form": {"id": form, "name": form} if form else None,
        "contraction": None,
    }
    return word | over


def space() -> dict[str, Any]:
    return {"text": " ", "status": None, "lemma": None, "form": None, "stretch": False}


def line(*words: dict[str, Any]) -> list[dict[str, Any]]:
    """A line's words with spaces between them."""
    out: list[dict[str, Any]] = []
    for word in words:
        out += [word, space()]
    return out[:-1]


def n(prefix: str, i: int) -> str:
    """A word made only of letters (a digit isn't one), different for every i."""
    return prefix + chr(97 + i % 26) + chr(97 + i // 26)


def filler(n_: int) -> list[list[dict[str, Any]]]:
    return [line(w(n("a", i)), w(n("b", i))) for i in range(n_)]


def quizzed(lines: list[list[dict[str, Any]]]) -> list[tuple[int, str]]:
    return [(i, x["text"]) for i, ln in enumerate(lines) for x in ln if x.get("quiz")]


def test_a_known_inflected_word_with_a_named_form_is_asked() -> None:
    lines = [*filler(3), line(w("Ja"), w("myszy", "genitive", "mysz"))]
    form_quiz.mark(lines, 1)
    assert quizzed(lines) == [(3, "myszy")]


def test_a_word_not_chosen_has_no_quiz_key_at_all() -> None:
    lines = [*filler(3), line(w("Ja"), w("myszy", "genitive", "mysz"))]
    form_quiz.mark(lines, 1)
    assert all("quiz" not in x for ln in lines[:3] for x in ln)


def test_only_a_word_that_could_be_asked_fairly_is() -> None:
    cases = {
        "a practice word": w("myszy", "genitive", "mysz", stretch=True),
        "a name": w("myszy", "genitive", "mysz", status="name"),
        "a word outside the deck": w("myszy", "genitive", "mysz", status="unknown"),
        "a word only partly known": w("myszy", "genitive", "mysz", status="partial"),
        "a word with no dictionary form": w("myszy", "genitive", None),
        "a word with no form named": w("myszy", None, "mysz"),
        "a word that is its own dictionary form": w("Mysz", "nominative", "mysz"),
        "a contraction": w("στο", "article", "σε", contraction="σε + το"),
        "a form of a phrase": w("myszy", "genitive", "mysz domowa"),
        "a word with a hyphen": w("my-szy", "genitive", "mysz"),
    }
    for what, word in cases.items():
        lines = [*filler(3), line(w("Ja"), word)]
        assert form_quiz.pick(lines, 1) == [], what


def test_the_first_word_of_a_line_is_never_asked() -> None:
    lines = [*filler(3), line(w("Myszy", "genitive", "mysz"), w("są"))]
    assert form_quiz.pick(lines, 1) == []


def test_a_word_is_asked_only_at_its_first_appearance() -> None:
    # The form was picked for the first line it is in; the same spelling later may be another form.
    first = line(w("Ja"), w("myszy", "genitive", "mysz"))
    again = line(w("Ja"), w("myszy", "genitive", "mysz"))
    assert form_quiz.pick([first, *filler(2), again], 1) == [(0, 2)]
    assert form_quiz.pick([*filler(2), again, first], 1) == [(2, 2)]
    assert form_quiz.pick([*filler(3), again], 1) == [(3, 2)]


def test_a_short_text_has_none_and_a_longer_one_a_few() -> None:
    def text(count: int) -> list[list[dict[str, Any]]]:
        return [line(w("Ja"), w(n("c", i), "genitive", n("d", i))) for i in range(count)]

    assert form_quiz.pick(text(3), 1) == []
    assert len(form_quiz.pick(text(4), 1)) == 1
    assert len(form_quiz.pick(text(8), 1)) == 2
    assert len(form_quiz.pick(text(12), 1)) == 3
    assert len(form_quiz.pick(text(40), 1)) == form_quiz.MAX_PER_TEXT


def test_one_to_a_line_spread_down_the_text_in_order() -> None:
    lines = [
        line(w("Ja"), w(n("c", i), "genitive", n("d", i)), w(n("e", i), "dative", n("f", i)))
        for i in range(12)
    ]
    picked = form_quiz.pick(lines, 5)
    assert len(picked) == 3
    assert [p[0] for p in picked] == sorted({p[0] for p in picked})
    assert picked[0][0] < 4 and picked[-1][0] >= 8  # not bunched at one end


def test_a_form_not_asked_yet_is_preferred() -> None:
    lines = [
        line(w("Ja"), w(n("c", i), "genitive", n("d", i)), w(n("e", i), "dative", n("f", i)))
        for i in range(12)
    ]
    forms = [lines[ln][at]["form"]["id"] for ln, at in form_quiz.pick(lines, 0)]
    assert len(forms) == 3 and forms[0] != forms[1]  # the second is the form the first wasn't


def test_the_same_text_gets_the_same_words_every_time() -> None:
    def build() -> list[list[dict[str, Any]]]:
        return [line(w("Ja"), w(n("c", i), "genitive", n("d", i))) for i in range(12)]

    assert form_quiz.pick(build(), 9) == form_quiz.pick(build(), 9)


# ==== As served ====

LINES = (
    Line("A", "Jeg|snakket|med|henne|i|går.", "I talked with her yesterday."),
    Line("B", "Gutten|har|gått|hjem.", "The boy has gone home."),
    Line("A", "Han|snakket|med|gutten.", "He talked with the boy."),
    Line("B", "Hun|har|gått|ut.", "She has gone out."),
)


def test_a_served_text_flags_a_word_the_text_has_a_form_for() -> None:
    lexicon = lexicon_from([Entry(1, "mat", "food", "mature")], "nb", 1000)
    base = StoredText(
        id=3,
        topic_id=1,
        title="t",
        lines=LINES,
        glosses={},
        stretch=(),
        coverage=1.0,
        roles={},
        language="nb",
        forms={"snakket": {"id": "past"}, "gått": {"id": "participle"}},
    )
    out = render(base, lexicon, {})
    flagged = [
        (i, x["text"], x["form"]["id"])
        for i, ln in enumerate(out["lines"])
        for x in ln["words"]
        if x.get("quiz")
    ]
    assert len(flagged) == 1
    line_no, word, form = flagged[0]
    assert word in {"snakket", "gått"} and form in {"past", "participle"}
    # The one chosen is a first appearance, never the first word of its line.
    assert out["lines"][line_no]["words"][0]["text"] != word
