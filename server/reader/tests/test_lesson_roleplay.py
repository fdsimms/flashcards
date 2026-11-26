"""The role-play (`Plan.roleplay`): a second conversation whose lines for A recombine the taught
words, acted out last in place of replaying the dialogue."""

from dataclasses import replace

from franki_reader import lesson
from franki_reader.lesson import Line, Phrase, Plan, Say

PHRASES = (
    Phrase("Un café, s'il vous plaît.", "A coffee, please.", ("Un café,", "s'il vous plaît.")),
    Phrase("Oui, avec du lait.", "Yes, with milk.", ("Oui,", "avec du lait.")),
    Phrase("Merci, au revoir.", "Thank you, goodbye.", ("Merci,", "au revoir.")),
)
DIALOGUE = (
    Line("A", "Un café, s'il vous plaît.", "A coffee, please."),
    Line("B", "Avec du lait ?", "With milk?"),
    Line("A", "Oui, avec du lait.", "Yes, with milk."),
)
MIXES = (Phrase("Un café avec du lait, merci.", "A coffee with milk, thank you.", ("x",)),)


def item(speaker: str, text: str, english: str = "x") -> dict[str, str]:
    return {"speaker": speaker, "text": text, "english": english}


GOOD = [
    item("B", "Vous désirez ?"),
    item("A", "Oui, un café, merci.", "Yes, a coffee, thank you."),
    item("B", "Voilà."),
    item("A", "Oui, un café avec du lait.", "Yes, a coffee with milk."),
]


def clean(raw: object) -> tuple[Line, ...]:
    return lesson.clean_roleplay(raw, PHRASES, DIALOGUE, MIXES)


def test_keeps_a_conversation_whose_a_lines_recombine_taught_words() -> None:
    lines = clean(GOOD)
    assert [(line.speaker, line.text) for line in lines] == [
        (g["speaker"], g["text"]) for g in GOOD
    ]


def test_bs_lines_may_use_any_words() -> None:
    assert len(clean(GOOD)) == 4


def test_an_a_line_with_a_word_not_taught_drops_the_whole_conversation() -> None:
    assert clean([*GOOD, item("A", "Un thé, merci.")]) == ()


def test_an_a_line_that_is_a_taught_phrase_drops_it() -> None:
    assert clean([*GOOD[:2], item("A", "Merci, au revoir.")]) == ()


def test_punctuation_and_case_dont_make_a_replay_new() -> None:
    assert clean([*GOOD[:2], item("A", "oui avec du lait")]) == ()


def test_an_a_line_that_is_a_line_of_the_dialogue_or_a_mix_drops_it() -> None:
    assert clean([*GOOD[:2], item("A", "Avec du lait.")]) == ()  # B's line of the dialogue
    assert clean([*GOOD[:2], item("A", "Un café avec du lait, merci.")]) == ()


def test_needs_at_least_two_lines_for_a() -> None:
    assert clean(GOOD[:2]) == ()


def test_a_conversation_is_cut_to_the_longest_allowed() -> None:
    long = [item("A", "Un café, merci.") if i % 2 == 0 else item("B", "Voilà.") for i in range(9)]
    assert len(clean(long)) == lesson.MAX_ROLEPLAY


def test_unusable_input_is_no_conversation() -> None:
    assert clean(None) == () and clean("text") == () and clean([1, {}, item("A", "")]) == ()


def plan(roleplay: tuple[Line, ...]) -> Plan:
    return Plan(
        title="Coffee",
        scene="ordering a coffee",
        dialogue=DIALOGUE,
        phrases=PHRASES,
        mixes=MIXES,
        roleplay=roleplay,
    )


def role_play_part(steps: list[lesson.Step]) -> list[lesson.Step]:
    start = next(
        i
        for i, s in enumerate(steps)
        if isinstance(s, Say) and s.text.startswith("Now take part in the conversation")
    )
    return steps[start:]


def spoken(steps: list[lesson.Step]) -> list[str]:
    return [s.text for s in steps if isinstance(s, Say) and s.voice != "narrator"]


def test_the_lesson_acts_out_the_roleplay_when_there_is_one() -> None:
    steps = lesson.build_script(plan(clean(GOOD)))
    said = spoken(role_play_part(steps))
    assert "Oui, un café, merci." in said and "Vous désirez ?" in said
    assert "Un café, s'il vous plaît." not in said


def test_the_lesson_acts_out_the_dialogue_when_there_is_no_roleplay() -> None:
    said = spoken(role_play_part(lesson.build_script(plan(()))))
    assert "Oui, avec du lait." in said


def test_a_roleplay_of_taught_words_is_asked_cold_with_no_new_line_notice() -> None:
    narrator = [
        s.text
        for s in role_play_part(lesson.build_script(plan(clean(GOOD))))
        if isinstance(s, Say) and s.voice == "narrator"
    ]
    assert "When a line is new, you will hear it first and then say it." not in narrator


def test_the_transcript_knows_what_a_roleplay_line_means() -> None:
    steps = lesson.build_script(plan(clean(GOOD)))
    placed = [lesson.Placed(s, i * 1000, i * 1000 + 900) for i, s in enumerate(steps)]
    script = lesson.script_of(plan(clean(GOOD)), placed)
    english = {e["text"]: e["english"] for e in script["entries"] if e["kind"] == "say"}
    assert english["Oui, un café, merci."] == "Yes, a coffee, thank you."


def test_the_roleplay_does_not_change_how_the_plan_is_shown() -> None:
    assert lesson.describe(plan(clean(GOOD))) == lesson.describe(replace(plan(()), roleplay=()))
