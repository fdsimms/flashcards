from franki_reader import lesson
from franki_reader.lesson import Line, Phrase, Plan, Say, Silence
from franki_reader.lexicon import Entry, lexicon_from


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

MIX = phrase("L'addition, un café.", "The check, a coffee.")
PLAN_WITH_MIXES = Plan(PLAN.title, PLAN.scene, PLAN.dialogue, PLAN.phrases, (MIX,))


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


KNOWN = {"je", "voudrais", "un", "café", "l'addition"}


class TestCleanMix:
    def test_keeps_a_sentence_made_only_of_known_words(self) -> None:
        mix = lesson.clean_mix({"text": "Je voudrais l'addition.", "english": "x"}, KNOWN)
        assert mix == Phrase("Je voudrais l'addition.", "x", ("Je voudrais l'addition.",))

    def test_drops_a_sentence_with_a_new_word(self) -> None:
        assert lesson.clean_mix({"text": "Je voudrais un thé.", "english": "x"}, KNOWN) is None

    def test_drops_a_malformed_sentence(self) -> None:
        assert lesson.clean_mix({"text": "Je voudrais"}, KNOWN) is None
        assert lesson.clean_mix("Je voudrais", KNOWN) is None
        assert lesson.clean_mix({"text": "...", "english": "x"}, KNOWN) is None


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

    def test_keeps_mixes_made_of_taught_words_only(self) -> None:
        raw = self.good()
        raw["mixes"] = [
            {"text": "Merci, je voudrais un café.", "english": "Thanks, I'd like a coffee."},
            {"text": "Merci pour le thé.", "english": "Thanks for the tea."},
            {"text": "Merci.", "english": "Thank you."},  # a phrase already taught
        ]
        plan = lesson.clean_plan(raw, "s")
        assert plan is not None
        assert [m.text for m in plan.mixes] == ["Merci, je voudrais un café."]

    def test_a_plan_with_no_usable_mixes_is_still_kept(self) -> None:
        plan = lesson.clean_plan({**self.good(), "mixes": "nope"}, "s")
        assert plan is not None and plan.mixes == ()

    def test_caps_the_mixes(self) -> None:
        raw = self.good()
        raw["mixes"] = [{"text": f"Merci {'merci ' * i}café.", "english": "x"} for i in range(1, 8)]
        plan = lesson.clean_plan(raw, "s")
        assert plan is not None and len(plan.mixes) == lesson.MAX_MIXES

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


class TestThai:
    def test_counts_thai_words_though_there_are_no_spaces(self) -> None:
        assert lesson.word_count("ผมอยากได้กาแฟ") == 3  # ผม | อยากได้ | กาแฟ, by newmm
        assert lesson.word_count("สวัสดีครับ") >= 2

    def test_vowel_and_tone_marks_dont_split_a_word(self) -> None:
        assert lesson.tokens("สวัสดี") == ["สวัสดี"]

    def test_a_thai_phrase_is_built_up_with_no_space_between_parts(self) -> None:
        p = phrase("ผมอยากได้กาแฟ", "I'd like a coffee.", "ผมอยากได้", "กาแฟ")
        assert lesson.build_up(p) == ["กาแฟ", "ผมอยากได้กาแฟ"]
        p3 = phrase("ผมอยากได้กาแฟหนึ่งแก้ว", "x", "ผมอยากได้", "กาแฟ", "หนึ่งแก้ว")
        assert lesson.build_up(p3) == ["หนึ่งแก้ว", "กาแฟหนึ่งแก้ว", "ผมอยากได้กาแฟหนึ่งแก้ว"]

    def test_keeps_a_thai_phrase_whose_parts_make_it_up(self) -> None:
        raw = raw_phrase("ผมอยากได้กาแฟ", "I'd like a coffee.", ["ผมอยากได้", "กาแฟ"])
        assert lesson.clean_phrase(raw) is not None

    def test_drops_a_thai_phrase_whose_parts_are_other_words(self) -> None:
        raw = raw_phrase("ผมอยากได้กาแฟ", "I'd like a coffee.", ["ผมอยากได้", "ชา"])
        assert lesson.clean_phrase(raw) is None

    def test_a_mix_may_only_use_taught_thai_words(self) -> None:
        known = lesson.words_of("ผมอยากได้กาแฟ")
        assert lesson.clean_mix({"text": "กาแฟ", "english": "Coffee."}, known) is not None
        assert lesson.clean_mix({"text": "ผมอยากได้ชา", "english": "Tea."}, known) is None


class TestJapanese:
    def test_counts_japanese_words_as_the_reader_splits_them(self) -> None:
        assert lesson.tokens("すみません、駅はどこですか？") == [
            "すみません",
            "駅",
            "は",
            "どこ",
            "です",
            "か",
        ]
        assert lesson.word_count("お茶を飲みたいです。") == 3  # お茶 | を | 飲みたいです

    def test_a_japanese_phrase_is_built_up_with_no_space_between_parts(self) -> None:
        p = phrase("コーヒーを一つください", "One coffee, please.", "コーヒーを", "一つください")
        assert lesson.build_up(p) == ["一つください", "コーヒーを一つください"]

    def test_keeps_a_japanese_phrase_whose_parts_make_it_up(self) -> None:
        raw = raw_phrase("コーヒーをください。", "Coffee, please.", ["コーヒーを", "ください"])
        assert lesson.clean_phrase(raw) is not None
        other = raw_phrase("コーヒーをください。", "Coffee, please.", ["お茶を", "ください"])
        assert lesson.clean_phrase(other) is None

    def test_a_mix_may_only_use_taught_japanese_words(self) -> None:
        known = lesson.words_of("コーヒーをください") | lesson.words_of("お茶です")
        assert lesson.clean_mix({"text": "お茶をください", "english": "Tea, please."}, known)
        assert lesson.clean_mix({"text": "水をください", "english": "Water."}, known) is None


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
    def test_opens_on_the_dialogue_and_ends_the_lesson(self) -> None:
        steps = lesson.build_script(PLAN)
        assert steps[0] == Say("narrator", "At the café. Listen to this conversation.")
        assert steps[2] == Say("male", "Bonjour, vous désirez ?")
        assert steps[4] == Say("female", "Je voudrais un café.")
        assert steps[-1] == Say("narrator", "That's the end of the lesson.")

    def test_closes_with_the_learner_taking_the_first_speakers_part(self) -> None:
        steps = lesson.build_script(PLAN)
        start = steps.index(
            Say("narrator", "Now take part in the conversation. You are the first speaker.")
        )
        tail = steps[start:]
        cue = tail.index(Say("narrator", "You say: Hello, what would you like?"))
        # "Bonjour, vous désirez ?" uses no word a phrase taught, so it's heard first, then repeated.
        assert tail[cue + 1] == Say("male", "Bonjour, vous désirez ?")
        gap = tail[cue + 2]
        assert isinstance(gap, Silence) and gap.ms >= lesson.PAUSE_MIN_MS
        # The other speaker's line is played with no cue and no answer to wait for.
        assert Say("female", "Je voudrais un café.") in tail
        assert Say("narrator", "You say: I'd like a coffee.") not in tail

    def test_asks_each_mix_after_every_phrase_is_taught_and_before_the_role_play(self) -> None:
        steps = lesson.build_script(PLAN_WITH_MIXES)
        asked = steps.index(Say("narrator", "How do you say: The check, a coffee."))
        last_taught = max(
            i for i, s in enumerate(steps) if s == Say("narrator", "That means: A jug of water.")
        )
        role = steps.index(
            Say("narrator", "Now take part in the conversation. You are the first speaker.")
        )
        assert last_taught < asked < role
        assert steps[asked + 2] == Say("male", MIX.text)

    def test_a_line_made_of_taught_words_is_asked_cold_and_any_other_is_heard_first(self) -> None:
        lines = (
            Line("A", "Je voudrais un café.", "I'd like a coffee."),
            Line("B", "Voilà.", "Here you are."),
            Line("A", "Merci beaucoup.", "Thank you very much."),
        )
        taught = lesson.words_of("Je voudrais un café.")
        steps = lesson._role_play(lines, "male", taught)
        cold = steps.index(Say("narrator", "You say: I'd like a coffee."))
        assert isinstance(steps[cold + 1], Silence)
        assert steps[cold + 2] == Say("male", "Je voudrais un café.")
        new = steps.index(Say("narrator", "You say: Thank you very much."))
        assert steps[new + 1] == Say("male", "Merci beaucoup.")
        assert isinstance(steps[new + 2], Silence)
        assert (
            Say("narrator", "When a line is new, you will hear it first and then say it.") in steps
        )

    def test_says_the_learner_is_second_when_the_dialogue_starts_with_b(self) -> None:
        lines = (Line("B", "Bonjour.", "Hello."), Line("A", "Bonjour.", "Hello."))
        said_by_narrator = [
            s.text
            for s in lesson._role_play(lines, "male", set())
            if isinstance(s, Say) and s.voice == "narrator"
        ]
        assert "first speaker" not in said_by_narrator[0]
        assert "second speaker" in said_by_narrator[0]

    def test_a_plan_without_mixes_has_no_mix_introduction(self) -> None:
        steps = lesson.build_script(PLAN)
        assert not any(isinstance(s, Say) and "put them together" in s.text for s in steps)

    def test_teaches_each_phrase_in_order_before_the_next(self) -> None:
        steps = lesson.build_script(PLAN)
        first = [
            i for i, s in enumerate(steps) if s == Say("narrator", "That means: I'd like a coffee.")
        ]
        second = [i for i, s in enumerate(steps) if s == Say("narrator", "That means: Please.")]
        assert len(first) == 1 and len(second) == 1
        assert first[0] < second[0]

    def test_the_native_voice_is_slow_only_while_a_phrase_is_taught(self) -> None:
        steps = lesson.build_script(PLAN)
        native = [s for s in steps if isinstance(s, Say) and s.voice != "narrator"]
        slow = {s.text for s in native if s.slow}
        assert {"un café", "Je voudrais un café."} <= slow
        # The dialogue, the role-play and a phrase asked for are at normal speed, and the narrator
        # is never slowed.
        assert Say("male", "Bonjour, vous désirez ?") in steps
        assert Say("female", "Je voudrais un café.") in steps
        asked = steps.index(Say("narrator", "How do you say: I'd like a coffee."))
        assert steps[asked + 2] == Say("male", "Je voudrais un café.")
        assert not any(s.slow for s in steps if isinstance(s, Say) and s.voice == "narrator")

    def test_a_phrase_taught_slowly_and_asked_normally_is_two_clips(self) -> None:
        clips = lesson.clips(lesson.build_script(PLAN))
        assert Say("male", "Je voudrais un café.", slow=True) in clips
        assert Say("male", "Je voudrais un café.") in clips

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
        assert [s.text for s in between] == ["That means: Please.", "Listen and repeat."]

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


def known(*words: str):  # type: ignore[no-untyped-def]
    return lexicon_from([Entry(i, w, "x", "mature") for i, w in enumerate(words)], "fr", 0)


def plan_saying(*lines: str) -> Plan:
    dialogue = tuple(Line("A", text, "x") for text in lines)
    return Plan(PLAN.title, PLAN.scene, dialogue, PLAN.phrases)


class TestUnfamiliarWords:
    def test_taught_and_known_words_are_fine(self) -> None:
        plan = plan_saying("Bonjour, je voudrais un café.")
        assert lesson.unfamiliar_words(plan, known("bonjour")) == []

    def test_a_line_may_hold_a_couple_of_strangers(self) -> None:
        plan = plan_saying("Bonjour, quelle boulangerie !")
        assert lesson.unfamiliar_words(plan, known("bonjour")) == []

    def test_names_the_strangers_of_a_line_over_the_allowance(self) -> None:
        plan = plan_saying("Quelle boulangerie magnifique !", "Bonjour.")
        assert lesson.unfamiliar_words(plan, known("bonjour")) == [
            "Quelle",
            "boulangerie",
            "magnifique",
        ]

    def test_a_word_taught_in_a_phrase_isnt_a_stranger(self) -> None:
        plan = plan_saying("Une carafe d'eau, magnifique, quelle boulangerie")
        assert lesson.unfamiliar_words(plan, known()) == ["magnifique", "quelle", "boulangerie"]


class TestLearner:
    def test_a_woman_learner_repeats_after_the_womans_voice_and_plays_a_woman(self) -> None:
        steps = lesson.build_script(PLAN, "female")
        assert steps[2] == Say("female", "Bonjour, vous désirez ?")  # A is the learner
        assert steps[4] == Say("male", "Je voudrais un café.")
        taught = steps.index(Say("narrator", "That means: I'd like a coffee."))
        assert steps[taught - 2] == Say("female", CAFE.text, slow=True)

    def test_the_role_play_plays_the_other_speaker_and_the_learner_answers_in_their_own_voice(
        self,
    ) -> None:
        tail = lesson.build_script(PLAN, "female")
        cue = tail.index(Say("narrator", "You say: Hello, what would you like?"))
        assert tail[cue + 1] == Say("female", "Bonjour, vous désirez ?")
        assert Say("male", "Je voudrais un café.") in tail[cue:]

    def test_a_man_is_the_default(self) -> None:
        assert lesson.build_script(PLAN) == lesson.build_script(PLAN, "male")


# A lesson made from the learner's own words and phrases (a cram in the app).
GIVEN = (
    Phrase("Un café", "a coffee", ("Un café",)),
    Phrase("L'addition, s'il vous plaît", "the check, please", ("L'addition, s'il vous plaît",)),
    Phrase("presque", "almost", ("presque",)),
)
GIVEN_RAW = {
    "title": "At the café",
    "dialogue": [
        {"speaker": "A", "text": "Un café, s'il vous plaît.", "english": "A coffee, please."},
        {"speaker": "B", "text": "Voilà.", "english": "Here you are."},
    ],
    "phrases": [
        # Claude's own split of a given phrase, its spacing and punctuation changed: kept, with the
        # learner's text and meaning.
        {
            "text": "L'addition s'il vous plaît.",
            "english": "Check please",
            "parts": ["L'addition", "s'il vous plaît."],
        },
        {"text": "Un café", "english": "A coffee", "parts": ["Un café"]},
        # Not one of the learner's: dropped.
        {"text": "Bonjour", "english": "Hello", "parts": ["Bonjour"]},
    ],
    "mixes": [{"text": "Un café, s'il vous plaît", "english": "A coffee, please"}],
}


def test_a_given_plan_teaches_every_given_phrase_as_the_learner_has_it() -> None:
    plan = lesson.clean_given_plan(GIVEN_RAW, "my lesson", GIVEN)
    assert plan is not None
    assert plan.title == "At the café"
    assert plan.phrases == (
        Phrase(
            "L'addition, s'il vous plaît",
            "the check, please",
            ("L'addition", "s'il vous plaît."),
        ),
        Phrase("Un café", "a coffee", ("Un café",)),
        # Left out by Claude: taught whole, last.
        Phrase("presque", "almost", ("presque",)),
    )
    assert [m.text for m in plan.mixes] == ["Un café, s'il vous plaît"]


def test_a_given_plan_drops_a_mix_that_is_only_given_phrases_in_a_row() -> None:
    raw = {
        **GIVEN_RAW,
        "mixes": [
            {"text": "Presque, un café", "english": "almost, a coffee"},
            {"text": "Un café, s'il vous plaît", "english": "A coffee, please"},
        ],
    }
    plan = lesson.clean_given_plan(raw, "my lesson", GIVEN)
    assert plan is not None
    assert [m.text for m in plan.mixes] == ["Un café, s'il vous plaît"]


def test_a_given_plan_needs_a_dialogue_and_phrases() -> None:
    assert lesson.clean_given_plan({**GIVEN_RAW, "dialogue": []}, "x", GIVEN) is None
    assert lesson.clean_given_plan(GIVEN_RAW, "x", ()) is None
    assert lesson.clean_given_plan("nope", "x", GIVEN) is None


def test_a_given_plan_keeps_a_longer_dialogue() -> None:
    line = {"speaker": "A", "text": "Un café.", "english": "A coffee."}
    raw = {**GIVEN_RAW, "dialogue": [line] * 12}
    plan = lesson.clean_given_plan(raw, "x", GIVEN)
    assert plan is not None and len(plan.dialogue) == lesson.MAX_GIVEN_DIALOGUE


def test_given_phrases_are_squashed_each_once_and_capped() -> None:
    given = lesson.given_phrases(
        [("  Un  café ", "a coffee"), ("un café.", "again"), ("", "empty"), ("x" * 201, "long")]
        + [(f"mot{i}", f"word {i}") for i in range(20)]
    )
    assert given[0] == Phrase("Un café", "a coffee", ("Un café",))
    assert len(given) == lesson.MAX_GIVEN
    assert all(p.text != "un café." for p in given)
