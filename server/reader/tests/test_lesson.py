from franki_reader import lesson
from franki_reader.lesson import Line, Phrase, Plan, Say, Silence


def phrase(text: str, english: str, *parts: str) -> Phrase:
    return Phrase(text, english, parts or (text,))


CAFE = phrase("Je voudrais un café.", "I'd like a coffee.", "Je voudrais", "un café")
PLEASE = phrase("S'il vous plaît.", "Please.")
BILL = phrase("L'addition, s'il vous plaît.", "The check, please.", "L'addition", "s'il vous plaît")
WATER = phrase("Une carafe d'eau.", "A jug of water.", "Une carafe", "d'eau")

PLAN = Plan(
    title="At the café",
    scene="ordering a coffee",
    dialogue=(
        Line("A", "Bonjour, vous désirez ?", "Hello, what would you like?"),
        Line("B", "Je voudrais un café.", "I'd like a coffee."),
    ),
    phrases=(CAFE, PLEASE, BILL, WATER),
)


def raw_phrase(text: str, english: str, parts: list[str]) -> dict[str, object]:
    return {"text": text, "english": english, "parts": parts}


class TestCleanPhrase:
    def test_keeps_a_phrase_whose_parts_make_it_up(self) -> None:
        got = lesson.clean_phrase(
            raw_phrase("Je voudrais un café.", "I'd like a coffee.", ["Je voudrais", "un café"])
        )
        assert got == CAFE

    def test_ignores_spacing_and_punctuation_when_putting_parts_back(self) -> None:
        got = lesson.clean_phrase(
            raw_phrase(
                "L'addition,  s'il vous plaît.", "The check.", ["L'addition,", "s'il vous plaît."]
            )
        )
        assert got is not None
        assert got.text == "L'addition, s'il vous plaît."

    def test_drops_a_phrase_whose_parts_are_other_words(self) -> None:
        assert (
            lesson.clean_phrase(raw_phrase("Je voudrais un café.", "x", ["Je veux", "un thé"]))
            is None
        )

    def test_drops_a_phrase_with_an_empty_part_or_none(self) -> None:
        assert lesson.clean_phrase(raw_phrase("Merci.", "Thanks.", ["Merci", " "])) is None
        assert lesson.clean_phrase(raw_phrase("Merci.", "Thanks.", [])) is None

    def test_drops_a_phrase_with_too_many_parts(self) -> None:
        assert lesson.clean_phrase(raw_phrase("a b c d e", "x", ["a", "b", "c", "d", "e"])) is None

    def test_drops_a_phrase_missing_its_english_or_not_a_dict(self) -> None:
        assert lesson.clean_phrase(raw_phrase("Merci.", "", ["Merci."])) is None
        assert lesson.clean_phrase("Merci.") is None
        assert (
            lesson.clean_phrase({"text": "Merci.", "english": "Thanks.", "parts": "Merci."}) is None
        )


class TestCleanPlan:
    def good(self) -> dict[str, object]:
        return {
            "title": "At the café",
            "dialogue": [
                {"speaker": "A", "text": "Bonjour.", "english": "Hello."},
                {"speaker": "B", "text": "Bonjour !", "english": "Hello!"},
            ],
            "phrases": [
                raw_phrase("Merci.", "Thank you.", ["Merci."]),
                raw_phrase("S'il vous plaît.", "Please.", ["S'il vous plaît."]),
                raw_phrase(
                    "Je voudrais un café.", "I'd like a coffee.", ["Je voudrais", "un café"]
                ),
            ],
        }

    def test_keeps_a_good_plan(self) -> None:
        plan = lesson.clean_plan(self.good(), "ordering a coffee")
        assert plan is not None
        assert plan.title == "At the café"
        assert [p.text for p in plan.phrases] == [
            "Merci.",
            "S'il vous plaît.",
            "Je voudrais un café.",
        ]
        assert len(plan.dialogue) == 2

    def test_needs_three_kept_phrases(self) -> None:
        raw = self.good()
        raw["phrases"] = raw["phrases"][:2]  # type: ignore[index]
        assert lesson.clean_plan(raw, "x") is None

    def test_a_dropped_phrase_doesnt_count(self) -> None:
        raw = self.good()
        raw["phrases"][2] = raw_phrase("Je voudrais un café.", "x", ["wrong", "parts"])  # type: ignore[index]
        assert lesson.clean_plan(raw, "x") is None

    def test_a_repeated_phrase_counts_once(self) -> None:
        raw = self.good()
        raw["phrases"][2] = raw_phrase("merci", "Thanks.", ["merci"])  # type: ignore[index]
        assert lesson.clean_plan(raw, "x") is None

    def test_needs_a_dialogue(self) -> None:
        raw = self.good()
        raw["dialogue"] = []
        assert lesson.clean_plan(raw, "x") is None

    def test_caps_the_number_of_phrases_and_lines(self) -> None:
        raw = self.good()
        raw["phrases"] = [
            raw_phrase(f"Mot{'a' * i}.", f"Word {i}.", [f"Mot{'a' * i}."]) for i in range(1, 9)
        ]
        raw["dialogue"] = [
            {"speaker": "A", "text": f"Ligne {i}.", "english": "Line."} for i in range(10)
        ]
        plan = lesson.clean_plan(raw, "x")
        assert plan is not None
        assert len(plan.phrases) == lesson.MAX_PHRASES
        assert len(plan.dialogue) == lesson.MAX_DIALOGUE

    def test_falls_back_to_the_scene_for_a_title(self) -> None:
        raw = self.good()
        raw["title"] = ""
        plan = lesson.clean_plan(raw, "ordering a coffee")
        assert plan is not None
        assert plan.title == "ordering a coffee"


class TestPause:
    def test_grows_with_the_words_in_tenths_of_a_second(self) -> None:
        assert lesson.pause_ms(4) == 4800
        assert lesson.pause_ms(8) == 7600

    def test_has_a_floor_and_a_ceiling(self) -> None:
        assert lesson.pause_ms(1) == lesson.PAUSE_MIN_MS
        assert lesson.pause_ms(100) == lesson.PAUSE_MAX_MS

    def test_counts_words_not_punctuation(self) -> None:
        assert lesson.word_count("L'addition, s'il vous plaît.") == 4


class TestBuildUp:
    def test_builds_from_the_last_part_to_the_whole(self) -> None:
        three = Phrase("Je voudrais un café noir.", "x", ("Je voudrais", "un café", "noir"))
        assert lesson.build_up(three) == ["noir", "un café noir", "Je voudrais un café noir."]

    def test_two_parts_end_on_the_whole_phrase_as_written(self) -> None:
        assert lesson.build_up(CAFE) == ["un café", "Je voudrais un café."]

    def test_one_part_is_only_the_phrase(self) -> None:
        assert lesson.build_up(PLEASE) == ["S'il vous plaît."]


def said(steps: list[lesson.Step], voice: str) -> list[str]:
    return [s.text for s in steps if isinstance(s, Say) and s.voice == voice]


class TestBuildScript:
    def test_opens_and_closes_on_the_dialogue(self) -> None:
        steps = lesson.build_script(PLAN)
        assert steps[0] == Say("narrator", "At the café. Listen to this conversation.")
        assert steps[2] == Say("male", "Bonjour, vous désirez ?")
        assert steps[4] == Say("female", "Je voudrais un café.")
        assert steps[-1] == Say("narrator", "That's the end of the lesson.")
        assert Say("narrator", "Now listen to the conversation again.") in steps

    def test_teaches_each_phrase_in_order_before_the_next(self) -> None:
        steps = lesson.build_script(PLAN)
        first = [
            i for i, s in enumerate(steps) if s == Say("narrator", "That means: I'd like a coffee.")
        ]
        second = [i for i, s in enumerate(steps) if s == Say("narrator", "That means: Please.")]
        assert len(first) == 1 and len(second) == 1
        assert first[0] < second[0]

    def test_builds_a_phrase_up_a_piece_at_a_time(self) -> None:
        steps = lesson.build_script(PLAN)
        taught = steps.index(Say("narrator", "That means: I'd like a coffee."))
        chunks = [
            s.text for s in steps[taught : taught + 12] if isinstance(s, Say) and s.voice == "male"
        ]
        assert chunks[:2] == ["un café", "Je voudrais un café."]

    def test_every_say_in_the_teaching_is_followed_by_a_silence_for_the_learner(self) -> None:
        steps = lesson.build_script(PLAN)
        asked = [
            i
            for i, s in enumerate(steps)
            if isinstance(s, Say) and s.text.startswith("How do you say")
        ]
        assert asked
        for i in asked:
            gap = steps[i + 1]
            assert isinstance(gap, Silence)
            assert gap.ms >= lesson.PAUSE_MIN_MS
            assert isinstance(steps[i + 2], Say) and steps[i + 2].voice == "male"  # type: ignore[union-attr]

    def test_a_phrase_is_asked_straight_after_it_is_taught(self) -> None:
        steps = lesson.build_script(PLAN)
        taught = steps.index(Say("narrator", "That means: Please."))
        asked = steps.index(Say("narrator", "How do you say: Please."))
        assert asked > taught
        between = [s for s in steps[taught:asked] if isinstance(s, Say) and s.voice == "narrator"]
        assert [s.text for s in between] == ["That means: Please.", "Repeat after me."]

    def test_earlier_phrases_come_back_at_widening_gaps(self) -> None:
        steps = lesson.build_script(PLAN)
        asks = [
            s.text.removeprefix("How do you say: ")
            for s in steps
            if isinstance(s, Say) and s.text.startswith("How do you say")
        ]
        # Each phrase when taught, then after 1 and 3 more have been taught, then the rest at the end.
        assert asks == [
            "I'd like a coffee.",
            "Please.",
            "I'd like a coffee.",  # one phrase on
            "The check, please.",
            "Please.",  # one phrase on
            "A jug of water.",
            "I'd like a coffee.",  # three phrases on
            "The check, please.",  # one phrase on
            "I'd like a coffee.",  # what the gaps didn't reach, in order
            "Please.",
            "The check, please.",
            "A jug of water.",
        ]

    def test_a_recall_never_comes_before_the_phrase_is_taught(self) -> None:
        steps = lesson.build_script(PLAN)
        taught: set[str] = set()
        for s in steps:
            if isinstance(s, Say) and s.text.startswith("That means: "):
                taught.add(s.text.removeprefix("That means: "))
            if isinstance(s, Say) and s.text.startswith("How do you say: "):
                assert s.text.removeprefix("How do you say: ") in taught

    def test_every_phrase_is_taught_once(self) -> None:
        steps = lesson.build_script(PLAN)
        means = [s.text for s in steps if isinstance(s, Say) and s.text.startswith("That means: ")]
        assert len(means) == len(PLAN.phrases)
        assert len(set(means)) == len(means)

    def test_a_short_lesson_still_ends_with_every_phrase_recalled(self) -> None:
        small = Plan("T", "s", PLAN.dialogue, PLAN.phrases[:3])
        steps = lesson.build_script(small)
        asks = [s.text for s in steps if isinstance(s, Say) and s.text.startswith("How do you say")]
        for p in small.phrases:
            assert asks.count(f"How do you say: {p.english}") >= 2


class TestClips:
    def test_each_distinct_clip_once_in_order_of_first_use(self) -> None:
        steps = lesson.build_script(PLAN)
        found = lesson.clips(steps)
        assert len(found) == len(set(found))
        assert found[0] == Say("narrator", "At the café. Listen to this conversation.")

    def test_billed_characters_count_a_repeated_clip_once(self) -> None:
        steps = lesson.build_script(PLAN)
        every = sum(len(s.text) for s in steps if isinstance(s, Say))
        assert 0 < lesson.characters(steps) < every

    def test_duration_adds_silences_and_clip_lengths(self) -> None:
        steps: list[lesson.Step] = [Say("narrator", "Hi."), Silence(1000), Say("male", "Salut.")]
        lengths = {Say("narrator", "Hi."): 500, Say("male", "Salut."): 800}
        assert lesson.duration_ms(steps, lengths) == 2300


def test_describe_lists_what_the_app_shows() -> None:
    out = lesson.describe(PLAN)
    assert out["title"] == "At the café"
    assert out["phrases"][0] == {"text": "Je voudrais un café.", "english": "I'd like a coffee."}
    assert out["dialogue"][1]["speaker"] == "B"
