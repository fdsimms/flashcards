import asyncio
from typing import Any

import pytest

from franki_reader import cram_themes
from franki_reader.cram_themes import (
    COUNT,
    MAX_ASKS,
    MAX_DECK,
    MAX_NEW,
    MAX_WORDS,
    MIN_QUESTIONS,
    Candidate,
    PoolWord,
    Seeds,
    Theme,
    ThemesFailed,
    clean_themes,
    deck_block,
    deck_of,
    lines_of,
    request_message,
    system_message,
    write_themes,
)
from franki_reader.generator import Usage
from franki_reader.lexicon import Entry, deck_lexicon

POOL = (
    PoolWord("n1", "un café", "a coffee", "carried"),
    PoolWord("n2", "la carte", "the menu", "missed"),
    PoolWord("n3", "l'addition", "the check", "fresh"),
)
CANDIDATES = (Candidate("commander", "to order"), Candidate("l'allergie", ""))
DECK = (
    Candidate("le vin", "the wine"),
    Candidate("un café", "a coffee"),
    Candidate("le pain", "bread"),
)


def seeds(**kwargs: object) -> Seeds:
    base: dict[str, object] = {
        "pool": POOL,
        "candidates": CANDIDATES,
        "weak_spots": (),
        "avoid": (),
        "stretch": False,
        "deck": DECK,
    }
    return Seeds(**{**base, **kwargs})  # type: ignore[arg-type]


def question(n: int = 1) -> dict[str, str]:
    return {"text": f"Vous aimez le café {n} ?", "english": f"Do you like coffee {n}?"}


def expect(n: int = 1) -> dict[str, dict[str, str]]:
    return {
        "question": {"text": f"Vous buvez du café {n} ?", "english": f"Do you drink coffee {n}?"},
        "answer": {"text": f"Oui, un café {n}.", "english": f"Yes, a coffee {n}."},
    }


def theme(**kwargs: object) -> dict[str, object]:
    base: dict[str, object] = {
        "title": "Ordering at a restaurant",
        "why": "Uses words you haven't used yet.",
        "words": [0, 1],
        "deck_words": [],
        "new_words": [{"word": "commander", "english": "to order"}],
        "asks": [question(1)],
        "expects": [expect(1)],
        "story": {"text": "Hier, j'ai pris un café.", "english": "Yesterday I had a coffee."},
    }
    return {**base, **kwargs}


def test_keeps_a_theme_and_turns_numbers_into_the_apps_ids() -> None:
    got = clean_themes({"themes": [theme()]}, seeds(), "fr")
    assert len(got) == 1
    t = got[0]
    assert t.title == "Ordering at a restaurant"
    assert t.word_ids == ("n1", "n2")
    assert t.new_words == (Candidate("commander", "to order"),)
    assert [q.english for q in t.asks] == ["Do you like coffee 1?"]
    assert [(e.question.english, e.answer.english) for e in t.expects] == [
        ("Do you drink coffee 1?", "Yes, a coffee 1.")
    ]
    assert t.story is not None and t.story.english == "Yesterday I had a coffee."


def test_drops_numbers_outside_the_lists_and_repeats() -> None:
    raw = {
        "themes": [
            theme(
                words=[0, 0, 7, -1, True, "1", 2],
                deck_words=[9, 0, 0, 1, 2],
                new_words=[
                    {"word": "le vin", "english": "wine"},
                    {"word": "un café", "english": "x"},
                ],
            )
        ]
    }
    t = clean_themes(raw, seeds(), "fr")[0]
    assert t.word_ids == ("n1", "n3")
    # D1 is un café, already among the app's words; a new word the deck has is no new word.
    assert t.deck_words == (Candidate("le vin", "the wine"), Candidate("le pain", "bread"))
    assert t.new_words == ()


def test_words_from_both_lists_stop_at_the_most_a_theme_carries() -> None:
    pool = tuple(PoolWord(f"n{n}", f"mot{n}", f"word {n}", "cram") for n in range(MAX_WORDS - 1))
    deck = tuple(Candidate(f"autre{n}", f"other {n}") for n in range(5))
    raw = {"themes": [theme(words=list(range(MAX_WORDS - 1)), deck_words=[0, 1, 2])]}
    t = clean_themes(raw, seeds(pool=pool, deck=deck), "fr")[0]
    assert len(t.word_ids) == MAX_WORDS - 1
    assert t.deck_words == (Candidate("autre0", "other 0"),)


def test_a_new_word_uses_the_decks_meaning_when_it_has_one_and_otherwise_claudes() -> None:
    raw = {
        "themes": [
            theme(
                new_words=[
                    {"word": "commander", "english": "something else"},
                    {"word": "l'allergie", "english": "allergy"},
                    {"word": "L'allergie", "english": "allergy again"},
                    {"word": "la ligne d'arrivée", "english": "finish line"},
                ]
            )
        ]
    }
    t = clean_themes(raw, seeds(), "fr")[0]
    assert t.new_words == (
        Candidate("commander", "to order"),
        Candidate("l'allergie", "allergy"),
        Candidate("la ligne d'arrivée", "finish line"),
    )


def test_a_new_word_must_be_written_in_the_language_and_short() -> None:
    thai = Seeds((PoolWord("n1", "วิ่ง", "to run", "cram"),), (), (), (), False)
    raw = {
        "themes": [
            theme(
                words=[0],
                new_words=[
                    {"word": "sen chai", "english": "finish line"},
                    {"word": "ก" * 61, "english": "long"},
                    {"word": "เส้นชัย", "english": "finish line"},
                ],
                asks=[{"text": "ครูวิ่งไหมครับ", "english": "Do you run?"}],
                expects=[
                    {
                        "question": {"text": "วิ่งกี่กิโล", "english": "How far?"},
                        "answer": {"text": "สิบกิโลครับ", "english": "Ten km."},
                    }
                ],
                story={"text": "ผมวิ่งครับ", "english": "I run."},
            )
        ]
    }
    assert clean_themes(raw, thai, "th")[0].new_words == (Candidate("เส้นชัย", "finish line"),)


def test_a_new_word_with_no_meaning_anywhere_is_dropped() -> None:
    raw = {"themes": [theme(new_words=[{"word": "l'allergie", "english": " "}])]}
    assert clean_themes(raw, seeds(), "fr")[0].new_words == ()


def test_at_most_the_most_new_words_and_questions() -> None:
    raw = {
        "themes": [
            theme(
                new_words=[{"word": f"mot{n}", "english": "x"} for n in range(10)],
                asks=[question(n) for n in range(10)],
            )
        ]
    }
    t = clean_themes(raw, seeds(), "fr")[0]
    assert len(t.new_words) == MAX_NEW
    assert len(t.asks) == MAX_ASKS


def test_a_theme_needs_words_a_question_to_ask_and_enough_questions() -> None:
    no_words = theme(words=[], new_words=[])
    few = theme(title="Few", expects=[])
    none_to_ask = theme(title="None to ask", asks=[], expects=[expect(1), expect(2)])
    ok = theme(title="Fine")
    only_deck = theme(title="Deck words", words=[], new_words=[], deck_words=[0])
    got = clean_themes({"themes": [no_words, few, none_to_ask, ok, only_deck]}, seeds(), "fr")
    assert [t.title for t in got] == ["Fine", "Deck words"]
    assert MIN_QUESTIONS == 2


def test_questions_and_story_must_be_in_the_languages_script() -> None:
    thai = Seeds((PoolWord("n1", "กิน", "to eat", "deck"),), (), (), (), False)
    good = {"text": "คุณชอบกินเผ็ดไหม", "english": "Do you like spicy food?"}
    romanized = {"text": "khun chop gin phet mai", "english": "Do you like spicy food?"}
    mixed = {"text": "คุณชอบ spicy ไหม", "english": "Do you like spicy food?"}
    raw = {
        "themes": [
            theme(
                words=[0],
                new_words=[],
                asks=[good, romanized, mixed, {**good, "text": "คุณกินข้าวหรือยัง"}],
                expects=[
                    {"question": romanized, "answer": good},
                    {"question": good, "answer": good},
                ],
                story=romanized,
            )
        ]
    }
    t = clean_themes(raw, thai, "th")[0]
    assert [q.text for q in t.asks] == ["คุณชอบกินเผ็ดไหม", "คุณกินข้าวหรือยัง"]
    assert len(t.expects) == 1
    assert t.story is None


def test_titles_are_trimmed_unique_and_not_taken() -> None:
    raw = {
        "themes": [
            theme(title='"At the bank."'),
            theme(title="at the BANK"),
            theme(title="Taken one"),
            theme(title="x" * 61),
            theme(title="  "),
        ]
    }
    got = clean_themes(raw, seeds(avoid=("taken ONE",)), "fr")
    assert [t.title for t in got] == ["At the bank"]


def test_stops_at_the_count_and_survives_a_malformed_answer() -> None:
    raw = {"themes": [theme(title=f"Theme {n}") for n in range(COUNT + 3)]}
    assert len(clean_themes(raw, seeds(), "fr")) == COUNT
    bads: list[Any] = [None, [], {}, {"themes": "a"}, {"themes": [1, "a", None]}, {"themes": [{}]}]
    for bad in bads:
        assert clean_themes(bad, seeds(), "fr") == []
    odd = theme(words="a", deck_words="d", new_words="b", asks="c", expects=5, story=4)
    assert clean_themes({"themes": [odd]}, seeds(), "fr") == []


def test_a_reason_too_long_to_show_is_left_out() -> None:
    assert clean_themes({"themes": [theme(why="x" * 300)]}, seeds(), "fr")[0].why == ""


def test_the_request_numbers_both_lists_and_names_why_each_word_is_there() -> None:
    text = request_message(seeds(weak_spots=("Telling time: minutes:to",), avoid=("At the bank",)))
    assert "[0] un café (a coffee) - not used at the last lesson" in text
    assert "[1] la carte (the menu) - missed in practice rounds" in text
    assert "[2] l'addition (the check) - added lately" in text
    assert "- commander (to order)" in text
    assert "- l'allergie\n" in text + "\n"
    assert "- Telling time: minutes:to" in text
    assert "- At the bank" in text


def test_the_request_leaves_out_what_there_is_none_of() -> None:
    text = request_message(seeds(candidates=()))
    assert "lacks" not in text
    assert "has been missing" not in text
    assert "taken" not in text


def test_the_system_message_names_the_language_and_the_level() -> None:
    assert "French" in system_message("fr", False)
    assert "within the learner's level" in system_message("fr", False)
    assert "stretch" in system_message("fr", True)


def test_the_system_message_asks_for_spoken_not_written_register() -> None:
    text = system_message("th", False)
    assert "ordinary person talks in everyday conversation" in text
    assert "not the way a textbook or a written text puts it" in text


def test_each_register_changes_what_the_system_message_asks_for() -> None:
    casual = system_message("th", False, register="casual")
    formal = system_message("th", False, register="formal")
    assert "with friends or family" in casual
    assert "stranger, a boss or an interviewer" in formal
    assert "with friends or family" not in system_message("th", False)


def test_a_topic_leads_the_request_and_asks_for_angles_on_it() -> None:
    text = request_message(seeds(topic="My violin recital"))
    assert text.startswith("What the lesson is for: My violin recital\n\nThe learner's words:")
    assert "angle on that" in system_message("fr", False, topic=True)
    assert "angle on that" not in system_message("fr", False)
    assert not request_message(seeds()).startswith("What the lesson")


def test_what_the_learner_says_in_thai_is_asked_for_in_their_gender() -> None:
    male = system_message("th", False, learner="male")
    assert "in everything the learner says" in male
    assert "ผม" in male
    assert "never ฉัน" in male
    assert "Leave the polite ending off the tutor's questions" in male
    assert "ค่ะ" in system_message("th", False, learner="female")
    assert "ครับ" not in system_message("fr", False, learner="male")


def test_a_thai_story_in_the_other_genders_words_is_dropped_but_the_theme_stays() -> None:
    def thai(story: str, learner: str) -> object:
        raw = {
            "themes": [
                theme(
                    asks=[{"text": "คุณวิ่งบ่อยไหม", "english": "Do you run often?"}] * 2,
                    expects=[],
                    story={"text": story, "english": "I ran."},
                )
            ]
        }
        got = clean_themes(raw, seeds(learner=learner), "th")
        assert len(got) == 1
        return got[0].story

    assert thai("ฉันวิ่งเสร็จในสามสิบนาที", "male") is None
    assert thai("ผมวิ่งเสร็จในสามสิบนาทีครับ", "male") is not None
    assert thai("ผมวิ่งเสร็จในสามสิบนาทีครับ", "female") is None
    assert thai("ฉันวิ่งเสร็จในสามสิบนาทีค่ะ", "female") is not None


def test_the_learners_own_thai_questions_and_answers_must_be_in_their_gender() -> None:
    asks = [
        {"text": "ครูเคยวิ่งมาราธอนไหมครับ", "english": "Have you run a marathon?"},
        {"text": "ครูเคยวิ่งมาราธอนไหมคะ", "english": "Have you run a marathon?"},
    ]
    expects = [
        {
            "question": {"text": "เหนื่อยไหม", "english": "Were you tired?"},
            "answer": {"text": "เหนื่อยมากครับ", "english": "Very."},
        },
        {
            "question": {"text": "วิ่งกี่กิโล", "english": "How far?"},
            "answer": {"text": "ยี่สิบเอ็ดกิโลค่ะ", "english": "21 km."},
        },
    ]
    raw = {"themes": [theme(asks=asks, expects=expects, story={"text": "ผมวิ่ง", "english": "x"})]}
    t = clean_themes(raw, seeds(learner="male"), "th")[0]
    assert [a.text for a in t.asks] == ["ครูเคยวิ่งมาราธอนไหมครับ"]
    # The tutor's question isn't checked (the tutor's gender isn't known); the learner's answer is.
    assert [e.answer.text for e in t.expects] == ["เหนื่อยมากครับ"]


def test_facts_lead_the_request_after_the_topic_and_the_prompt_keeps_to_them() -> None:
    text = request_message(seeds(topic="Half marathon", facts="Ran 21 km in 2:05"))
    assert text.startswith(
        "What the lesson is for: Half marathon\n\n"
        "What really happened, in the learner's words: Ran 21 km in 2:05\n\nThe learner's words:"
    )
    assert "never add a fact" in system_message("fr", False, facts=True)
    assert "never add a fact" not in system_message("fr", False)


def test_a_cram_word_is_named_as_chosen_for_the_lesson_and_asked_for_first() -> None:
    text = request_message(seeds(pool=(PoolWord("n1", "vite", "fast", "cram"),)))
    assert "[0] vite (fast) - chosen for this lesson" in text
    assert "chosen for this lesson first" in system_message("fr", False)


def entry(note_id: int, text: str, tier: str = "mature") -> Entry:
    return Entry(note_id, text, f"{text} meaning", tier)  # type: ignore[arg-type]


def test_the_deck_block_lists_studied_words_in_note_order_and_keeps_the_newest() -> None:
    entries = [entry(3, "trois"), entry(1, "un"), entry(2, "deux", "unreviewed")]
    deck = deck_of(entries)
    assert deck == (Candidate("un", "un meaning"), Candidate("trois", "trois meaning"))
    block = deck_block("fr", deck)
    assert block.startswith("Every French word the learner has studied")
    assert "[D0] un (un meaning)\n[D1] trois (trois meaning)" in block
    many = [entry(n, f"mot{n}") for n in range(MAX_DECK + 5)]
    assert deck_of(many)[0].text == "mot5"


def themes_of(*themes: dict[str, object]) -> dict[str, Any]:
    return {"themes": list(themes)}


def run_writes(
    answers: list[Any], s: Seeds, known: list[str], fail_second: bool = False
) -> tuple[list[Theme], Usage, list[Seeds]]:
    asked: list[Seeds] = []

    async def write(language: str, seeds_: Seeds) -> tuple[Any, Usage]:
        asked.append(seeds_)
        if fail_second and len(asked) == 2:
            raise ThemesFailed("Claude didn't answer.", Usage(input_tokens=5))
        return answers[min(len(asked), len(answers)) - 1], Usage(input_tokens=10)

    checker = deck_lexicon("fr", known)
    themes, used = asyncio.run(write_themes(write, "fr", s, checker, {"loin": "far"}))
    return themes, used, asked


KNOWN = ["vous", "aimez", "le", "café", "buvez", "du", "oui", "un", "hier", "j'ai", "pris"]


def test_an_unknown_word_takes_its_meaning_whatever_its_case() -> None:
    # The meanings are kept in lower case; a line's first word is capitalized.
    far = theme(story={"text": "Loin, j'ai pris un café.", "english": "x"})
    themes, _, _ = run_writes([themes_of(far)], seeds(), KNOWN)
    assert ("Loin", "far") in [(c.text, c.english) for c in themes[0].unknown]


def test_known_lines_are_kept_without_asking_again() -> None:
    themes, used, asked = run_writes([themes_of(theme())], seeds(), KNOWN)
    assert len(asked) == 1 and asked[0].feedback == ""
    assert themes[0].unknown == ()
    assert used.input_tokens == 10


def test_too_many_unknown_words_asks_once_more_naming_them_and_keeps_the_better() -> None:
    far = theme(story={"text": "Hier, j'ai couru loin, très loin, vraiment.", "english": "x"})
    themes, used, asked = run_writes([themes_of(far), themes_of(theme())], seeds(), KNOWN)
    assert len(asked) == 2
    assert "couru" in asked[1].feedback and "loin" in asked[1].feedback
    assert themes[0].unknown == ()
    assert used.input_tokens == 20


def test_the_unknown_words_left_are_marked_with_a_meaning_where_one_is_kept() -> None:
    far = theme(story={"text": "Hier, j'ai couru loin.", "english": "x"})
    # Two unknown words are within Comfortable's limit: no second ask.
    themes, _, asked = run_writes([themes_of(far)], seeds(), KNOWN)
    assert len(asked) == 1
    assert themes[0].unknown == (Candidate("couru", ""), Candidate("loin", "far"))
    assert lines_of(themes[0])[-1] == "Hier, j'ai couru loin."


def test_a_new_word_offered_isnt_counted_unknown() -> None:
    t = theme(
        new_words=[{"word": "loin", "english": "far"}],
        story={"text": "Hier, loin.", "english": "x"},
    )
    themes, _, _ = run_writes([themes_of(t)], seeds(), KNOWN)
    assert themes[0].unknown == ()


def test_a_failed_second_ask_keeps_the_first_and_counts_both() -> None:
    far = theme(story={"text": "Hier, j'ai couru loin, très loin, vraiment.", "english": "x"})
    themes, used, _ = run_writes([themes_of(far)], seeds(), KNOWN, fail_second=True)
    assert [t.title for t in themes] == ["Ordering at a restaurant"]
    assert used.input_tokens == 15


def test_a_failed_first_ask_raises_with_what_it_cost() -> None:
    async def write(language: str, seeds_: Seeds) -> tuple[Any, Usage]:
        raise ThemesFailed("Claude didn't answer.", Usage(input_tokens=7))

    with pytest.raises(ThemesFailed) as e:
        asyncio.run(write_themes(write, "fr", seeds()))
    assert e.value.usage.input_tokens == 7


def test_the_claude_call_gives_up_after_a_minute_without_retrying() -> None:
    options: dict[str, object] = {}

    class Client:
        def with_options(self, **kw: object) -> "Client":
            options.update(kw)
            return self

    # Only the options matter here: the call itself fails on the fake, as a timeout would.
    write = cram_themes.claude_themes(Client())  # type: ignore[arg-type]

    async def attempt() -> None:
        await write("th", seeds())

    with pytest.raises(Exception):  # noqa: B017
        asyncio.run(attempt())
    assert options == {"timeout": cram_themes.REQUEST_TIMEOUT_SECONDS, "max_retries": 0}
