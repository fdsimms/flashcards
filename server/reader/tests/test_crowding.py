from test_generator import ENTRIES, LEXICON, ScriptedModel, draft, run

from franki_reader.coverage import check
from franki_reader.crowding import CROWD_MAX, CROWD_MAX_HARDER, CROWD_WINDOW, crowding
from franki_reader.generator import MAX_ATTEMPTS, TextRequest, system_prompt

KNOWN = "ผม|อยาก|กิน|ครับ"  # 4 known words
FILLER = [KNOWN] * 15  # 60 known words
# Three words the deck lacks (ทอน, กลิ่น, แรง) in 3 of the first 7 words, 95.5% known overall.
CROWDED = draft("ทอน|กลิ่น|แรง|" + KNOWN, *FILLER)
# The same three, a full window of known words apart.
SPREAD = draft(
    "ผม|ทอน|" + KNOWN + "|" + KNOWN,
    KNOWN,
    "กลิ่น|" + KNOWN + "|" + KNOWN,
    KNOWN,
    "แรง|" + KNOWN + "|" + KNOWN,
    *FILLER,
)


def lines(d: dict) -> list[str]:  # type: ignore[type-arg]
    return [ln["text"] for ln in d["lines"]]


def test_three_new_words_close_together_are_named_and_counted_once() -> None:
    problems, count = crowding(check(lines(CROWDED), LEXICON))
    assert count == 1
    assert len(problems) == 1
    for word in ("ทอน", "กลิ่น", "แรง"):
        assert word in problems[0]
    assert f"at most {CROWD_MAX} in any {CROWD_WINDOW} words" in problems[0]


def test_new_words_spread_apart_are_fine() -> None:
    assert crowding(check(lines(SPREAD), LEXICON)) == ([], 0)


def test_two_new_words_together_are_allowed() -> None:
    two = draft("ทอน|กลิ่น|" + KNOWN, *FILLER)
    assert crowding(check(lines(two), LEXICON)) == ([], 0)


def test_known_words_names_and_stretch_words_never_crowd() -> None:
    assert crowding(check([KNOWN] * 6, LEXICON)) == ([], 0)
    names = check(["~มะลิ~|~ต้น~|~นก~|" + KNOWN], LEXICON)
    assert crowding(names) == ([], 0)


def test_a_crowded_draft_goes_back_with_the_words_named() -> None:
    model = ScriptedModel(CROWDED, SPREAD)
    result = run(model, TextRequest("food"))
    assert result.passed and result.attempts == 2
    revision = model.sent[1][2]["content"]
    assert "crowded together" in revision and "กลิ่น" in revision


def test_a_text_crowded_every_time_is_still_served() -> None:
    # Coverage is fine, so it isn't dropped for crowding alone: the closest attempt is kept.
    model = ScriptedModel(*[CROWDED] * MAX_ATTEMPTS)
    result = run(model, TextRequest("food"))
    assert result.passed and result.floor_met
    assert result.attempts == MAX_ATTEMPTS and result.crowded == 1


def test_a_less_crowded_attempt_is_kept_over_a_more_crowded_one_of_equal_coverage() -> None:
    model = ScriptedModel(CROWDED, CROWDED, SPREAD)
    assert run(model, TextRequest("food")).crowded == 0


def test_the_prompts_ask_for_new_words_spread_out_and_with_a_clue() -> None:
    for language in ("th", "es"):
        prompt = system_prompt(ENTRIES, language)
        assert "never more than two" in prompt
        assert "where the line itself shows what it means" in prompt


def test_three_new_words_together_are_ordinary_on_the_harder_level() -> None:
    cov = check(lines(CROWDED), LEXICON)  # three new words in the first seven
    assert crowding(cov, 0.95)[1] == 1
    assert crowding(cov, 0.93) == ([], 0)
    four = draft("ทอน|กลิ่น|แรง|แทน|" + KNOWN, *FILLER)
    problems, count = crowding(check(lines(four), LEXICON), 0.93)
    assert count == 1 and f"at most {CROWD_MAX_HARDER} in any" in problems[0]
