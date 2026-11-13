import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from franki_reader.coverage import Lexicon
from franki_reader.generator import (
    MAX_ATTEMPTS,
    MAX_NAMES,
    MODEL,
    GenerationFailed,
    TextRequest,
    Usage,
    claude_ask,
    generate,
    request_message,
    system_prompt,
)
from franki_reader.lexicon import Entry

ENTRIES = [
    Entry(1, "ฉัน", "I; me", "mature"),
    Entry(2, "อยาก", "want to", "mature"),
    Entry(3, "กิน", "eat", "mature"),
    Entry(4, "ข้าวเหนียวมะม่วง", "mango sticky rice", "young"),
    Entry(5, "ครับ", "polite particle (male)", "mature"),
    Entry(6, "รับอะไรดี", "what would you like?", "mature"),
    Entry(7, "ทอน", "give change", "unreviewed"),
]
LEXICON = Lexicon(e.text for e in ENTRIES if e.tier != "unreviewed")
MANGO = ENTRIES[3]


def draft(*texts: str, glosses: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "title": "At the stall",
        "roles": {"A": "Vendor", "B": "Customer"},
        "genders": {"A": "male", "B": "male"},
        "characters": {"A": "shopkeeper", "B": "friend"},
        "lines": [
            {"speaker": "AB"[i % 2], "text": t, "english": f"line {i}"} for i, t in enumerate(texts)
        ],
        "glosses": [{"word": w, "english": e} for w, e in (glosses or {}).items()],
    }


GOOD = draft("ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ")


class ScriptedModel:
    """Returns the given drafts in order and records every conversation it was sent."""

    def __init__(self, *drafts: dict[str, Any] | Exception) -> None:
        self.drafts = list(drafts)
        self.sent: list[list[dict[str, Any]]] = []

    async def __call__(
        self, messages: list[dict[str, Any]]
    ) -> tuple[dict[str, Any], list[Any], Usage]:
        self.sent.append(list(messages))
        d = self.drafts.pop(0)
        if isinstance(d, Exception):
            raise d
        return d, [{"type": "text", "text": "draft"}], Usage(100, 50, 1000, 0)


def run(model: ScriptedModel, request: TextRequest) -> Any:
    return asyncio.run(generate(model, LEXICON, request))


def test_a_good_first_draft_passes_in_one_attempt() -> None:
    result = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    assert result.passed and result.attempts == 1
    assert result.coverage.ratio == 1.0
    assert result.glosses["ข้าวเหนียวมะม่วง"] == "mango sticky rice"


def test_the_models_roles_for_the_speakers_are_kept() -> None:
    result = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    assert result.roles == {"A": "Vendor", "B": "Customer"}


def test_a_draft_under_the_floor_goes_back_with_the_words_named() -> None:
    bad = draft("ฉัน|อยาก|ทอน|ครับ", "*ข้าวเหนียวมะม่วง*|*ข้าวเหนียวมะม่วง*")
    model = ScriptedModel(bad, GOOD)
    result = run(model, TextRequest("food", (MANGO,)))

    assert result.passed and result.attempts == 2
    revision = model.sent[1]
    assert [m["role"] for m in revision] == ["user", "assistant", "user"]
    assert "ทอน" in revision[2]["content"]
    assert "not in the list" in revision[2]["content"]


def test_partial_words_are_named_separately() -> None:
    bad = draft("ฉัน|รับ|ครับ", "*ข้าวเหนียวมะม่วง*|*ข้าวเหนียวมะม่วง*")
    model = ScriptedModel(bad, GOOD)
    run(model, TextRequest("food", (MANGO,)))
    assert "only appear inside longer list entries" in model.sent[1][2]["content"]
    assert "รับ" in model.sent[1][2]["content"]


def test_a_stretch_word_used_once_is_sent_back_even_at_full_coverage() -> None:
    once = draft("ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ")
    model = ScriptedModel(once, GOOD)
    result = run(model, TextRequest("food", (MANGO,)))
    assert result.attempts == 2
    assert "fewer than 2 times" in model.sent[1][2]["content"]


def test_gives_up_after_three_attempts_and_does_not_pass() -> None:
    bad = draft("ทอน|ทอน|ฉัน")
    model = ScriptedModel(*[bad] * MAX_ATTEMPTS)
    result = run(model, TextRequest("food"))
    assert not result.passed
    assert result.attempts == MAX_ATTEMPTS
    assert len(model.sent) == MAX_ATTEMPTS


def test_the_conversation_is_append_only() -> None:
    bad = draft("ทอน|ฉัน")
    model = ScriptedModel(bad, bad, bad)
    run(model, TextRequest("food"))
    first, second, third = model.sent
    assert second[: len(first)] == first
    assert third[: len(second)] == second


def test_missing_glosses_are_reported() -> None:
    almost = draft(*["ฉัน|อยาก|กิน|ครับ"] * 6, "ทอน")
    result = run(ScriptedModel(almost), TextRequest("food"))
    assert result.passed
    assert result.missing_glosses == ("ทอน",)
    glossed = draft(*["ฉัน|อยาก|กิน|ครับ"] * 6, "ทอน", glosses={"ทอน": "change"})
    assert run(ScriptedModel(glossed), TextRequest("food")).missing_glosses == ()


def test_a_draft_with_no_lines_fails() -> None:
    with pytest.raises(GenerationFailed):
        run(ScriptedModel({"title": "x", "lines": [], "glosses": []}), TextRequest("food"))


def test_more_than_three_stretch_words_is_refused() -> None:
    with pytest.raises(ValueError):
        TextRequest("food", tuple(ENTRIES[:4]))


def test_system_prompt_lists_only_known_words_and_is_stable() -> None:
    prompt = system_prompt(ENTRIES)
    assert "ข้าวเหนียวมะม่วง | mango sticky rice | Y" in prompt
    assert "ฉัน | I; me | M" in prompt
    assert "ทอน" not in prompt
    assert system_prompt(list(reversed(ENTRIES))) == prompt


class FakeClient:
    def __init__(self, response: Any) -> None:
        self.calls: list[dict[str, Any]] = []
        self.response = response
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self.response


def response(stop_reason: str, text: str | None) -> Any:
    content = [SimpleNamespace(type="text", text=text)] if text is not None else []
    usage = SimpleNamespace(
        input_tokens=120,
        output_tokens=900,
        cache_read_input_tokens=15000,
        cache_creation_input_tokens=None,
    )
    return SimpleNamespace(
        stop_reason=stop_reason, content=content, usage=usage, model="claude-sonnet-5-5"
    )


def test_claude_ask_sends_the_cached_lexicon_schema_and_fallback() -> None:
    import json

    client = FakeClient(response("end_turn", json.dumps(GOOD)))
    ask = claude_ask(client, ENTRIES)  # type: ignore[arg-type]
    parsed, _content, used = asyncio.run(ask([{"role": "user", "content": "hi"}]))

    assert parsed == GOOD
    assert used == Usage(120, 900, 15000, 0, "claude-sonnet-5-5")
    call = client.calls[0]
    assert call["model"] == MODEL
    assert call["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "thinking" not in call


@pytest.mark.parametrize(
    ("stop_reason", "text"),
    [("refusal", None), ("max_tokens", '{"title"'), ("end_turn", None), ("end_turn", "not json")],
)
def test_claude_ask_turns_bad_responses_into_generation_failed(
    stop_reason: str, text: str | None
) -> None:
    ask = claude_ask(FakeClient(response(stop_reason, text)), ENTRIES)  # type: ignore[arg-type]
    with pytest.raises(GenerationFailed) as failed:
        asyncio.run(ask([{"role": "user", "content": "hi"}]))
    assert failed.value.usage.output_tokens == 900  # the call is still paid for


def test_usage_adds_up_across_attempts() -> None:
    bad = draft("ทอน|ฉัน")
    result = run(ScriptedModel(bad, GOOD), TextRequest("food", (MANGO,)))
    assert result.usage == Usage(200, 100, 2000, 0)


def test_cost_uses_the_model_prices() -> None:
    # 1M of each at Sonnet 5.5 prices: $2 in, $10 out, $0.20 cache read, $2.50 cache write.
    assert Usage(1_000_000, 1_000_000, 1_000_000, 1_000_000).cost_usd() == pytest.approx(14.70)


def test_claude_ask_turns_an_api_error_into_generation_failed() -> None:
    import anthropic
    import httpx2

    class Down:
        def __init__(self) -> None:
            self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

        async def create(self, **kwargs: Any) -> Any:
            raise anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x"))

    ask = claude_ask(Down(), ENTRIES)  # type: ignore[arg-type]
    with pytest.raises(GenerationFailed, match="APIConnectionError"):
        asyncio.run(ask([{"role": "user", "content": "hi"}]))


def test_the_answering_model_is_recorded_and_priced() -> None:
    import json

    reply = response("end_turn", json.dumps(GOOD))
    reply.model = "claude-opus-4-8"
    _, _, used = asyncio.run(claude_ask(FakeClient(reply), ENTRIES)([]))  # type: ignore[arg-type]
    assert used.model == "claude-opus-4-8"
    assert Usage(1_000_000, model="claude-opus-4-8").cost_usd() == pytest.approx(5.0)
    assert Usage(1_000_000, model="something-new").cost_usd() == pytest.approx(2.0)


# ==== Choosing stretch words ====

ORDER = ENTRIES[5]  # รับอะไรดี


def test_the_model_is_offered_words_to_choose_from() -> None:
    model = ScriptedModel(GOOD)
    result = run(model, TextRequest("food", (MANGO, ORDER), choose=2))

    assert result.passed
    assert result.stretch == ("ข้าวเหนียวมะม่วง",)
    assert result.glosses["ข้าวเหนียวมะม่วง"] == "mango sticky rice"
    asked = model.sent[0][0]["content"]
    assert "pick 1 to 2 of these that fit the topic" in asked
    assert "รับอะไรดี" in asked


def test_a_draft_that_chooses_no_stretch_word_goes_back() -> None:
    model = ScriptedModel(draft("ฉัน|อยาก|กิน|ครับ"), GOOD)
    result = run(model, TextRequest("food", (MANGO, ORDER), choose=1))

    assert result.passed and result.attempts == 2
    assert "No stretch word from the list was used" in model.sent[1][2]["content"]


def test_a_draft_that_chooses_too_many_goes_back() -> None:
    both = draft("*ข้าวเหนียวมะม่วง*|*รับอะไรดี*", "*ข้าวเหนียวมะม่วง*|*รับอะไรดี*")
    model = ScriptedModel(both, GOOD)
    result = run(model, TextRequest("food", (MANGO, ORDER), choose=1))

    assert result.passed and result.attempts == 2
    assert "Use at most 1 stretch words" in model.sent[1][2]["content"]
    assert result.stretch == ("ข้าวเหนียวมะม่วง",)


def test_a_chosen_word_used_once_goes_back() -> None:
    once = draft("ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ")
    model = ScriptedModel(once, GOOD)
    run(model, TextRequest("food", (MANGO, ORDER), choose=2))
    assert "appear fewer than 2 times: ข้าวเหนียวมะม่วง" in model.sent[1][2]["content"]


def test_choosing_has_the_same_limits() -> None:
    with pytest.raises(ValueError):
        TextRequest("food", tuple(ENTRIES[:6]), choose=4)
    with pytest.raises(ValueError):
        TextRequest("food", (), choose=1)
    TextRequest("food", tuple(ENTRIES[:6]), choose=3)  # many to choose from is fine


def test_a_story_is_asked_for_by_name_and_a_dialogue_by_default() -> None:
    from franki_reader.generator import request_message

    assert "Write a dialogue of 8 lines." in request_message(TextRequest("food"))
    story = request_message(TextRequest("food", lines=6, form="story"))
    assert "Write a short story of 6 lines." in story


def _marked(*marks: bool) -> dict[str, Any]:
    d = draft(*["ฉัน|อยาก|กิน|ครับ"] * len(marks))
    for line, mark in zip(d["lines"], marks, strict=True):
        line["paragraph"] = mark
    return d


def test_a_story_keeps_its_paragraph_marks_and_the_first_line_opens_one() -> None:
    story = run(
        ScriptedModel(_marked(False, False, True, False)), TextRequest("food", form="story")
    )
    assert [ln.paragraph for ln in story.lines] == [True, False, True, False]


def test_a_story_with_no_marks_has_no_paragraphs() -> None:
    story = run(ScriptedModel(_marked(False, False)), TextRequest("food", form="story"))
    assert [ln.paragraph for ln in story.lines] == [False, False]


def test_a_dialogue_has_no_paragraphs_even_if_the_model_marks_them() -> None:
    result = run(ScriptedModel(_marked(True, True)), TextRequest("food"))
    assert [ln.paragraph for ln in result.lines] == [False, False]


def test_the_system_prompt_is_the_same_for_stories_and_dialogues() -> None:
    # The form goes in the request, so the cached lexicon prefix is shared by both.
    prompt = system_prompt(ENTRIES)
    assert "every line's speaker is N" in prompt
    assert "dialogue" in prompt


# 12 of 13 words known (92.3%), and 10 of 11 (90.9%): under the floor, over the minimum.
NEAR = draft(*["ฉัน|อยาก|กิน|ครับ"] * 3, "ทอน")
NEARER_MISS = draft(*["ฉัน|อยาก|กิน|ครับ"] * 2, "ฉัน|กิน", "ทอน")


def test_when_every_attempt_misses_the_closest_one_over_the_minimum_is_kept() -> None:
    model = ScriptedModel(NEARER_MISS, NEAR, NEARER_MISS)
    result = run(model, TextRequest("food", floor=0.95))
    assert result.passed
    assert not result.floor_met
    assert round(result.coverage.ratio, 3) == 0.923
    assert result.attempts == MAX_ATTEMPTS
    assert len(model.sent) == MAX_ATTEMPTS  # it still tried every attempt first
    one = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,))).usage
    assert (
        result.usage.output_tokens == one.output_tokens * MAX_ATTEMPTS
    )  # every attempt is paid for


CUT_OFF = Usage(100, 4000, 1000, 0)


def test_a_revision_that_fails_keeps_the_closest_earlier_draft_and_its_cost() -> None:
    model = ScriptedModel(NEAR, GenerationFailed("The response was cut off", CUT_OFF))
    result = run(model, TextRequest("food", floor=0.95))
    assert result.passed and not result.floor_met
    assert round(result.coverage.ratio, 3) == 0.923
    assert result.attempts == 2
    assert result.usage == Usage(100, 50, 1000, 0) + CUT_OFF


def test_a_revision_that_fails_with_nothing_kept_is_returned_unpassed_with_its_cost() -> None:
    bad = draft("ทอน|ทอน|ฉัน")
    model = ScriptedModel(bad, bad, GenerationFailed("Claude didn't answer"))
    result = run(model, TextRequest("food"))
    assert not result.passed and result.attempts == MAX_ATTEMPTS
    assert result.usage == Usage(200, 100, 2000, 0)  # stored as dropped, so its cost is on record


def test_a_first_attempt_that_fails_raises_with_its_cost() -> None:
    model = ScriptedModel(GenerationFailed("The response was cut off", CUT_OFF))
    with pytest.raises(GenerationFailed, match="cut off") as failed:
        run(model, TextRequest("food"))
    assert failed.value.usage == CUT_OFF


def test_a_text_that_meets_the_floor_says_so() -> None:
    assert run(ScriptedModel(GOOD), TextRequest("food", (MANGO,))).floor_met


def test_a_text_under_90_still_fails() -> None:
    bad = draft("ทอน|ทอน|ฉัน")
    result = run(ScriptedModel(NEAR, bad, bad), TextRequest("food", floor=0.99))
    # NEAR is 92.3%, under the 99% asked for but over 90%, so it's the one kept.
    assert result.passed and not result.floor_met
    assert not run(ScriptedModel(bad, bad, bad), TextRequest("food")).passed


# 19 of 20 words known (95%): inside the range of a 92% target with its 96% ceiling.
IN_BAND = draft(*["ฉัน|อยาก|กิน|ครับ"] * 4, "ฉัน|อยาก|กิน|ทอน")


def test_a_draft_over_the_ceiling_is_too_easy_and_goes_back() -> None:
    model = ScriptedModel(GOOD, IN_BAND)
    result = run(model, TextRequest("food", floor=0.92, ceiling=0.96))
    assert result.passed and result.attempts == 2
    assert round(result.coverage.ratio, 2) == 0.95
    assert "too easy" in model.sent[1][-1]["content"]
    assert "between 92% and 96%" in model.sent[1][-1]["content"]


def test_no_ceiling_leaves_an_easy_draft_alone() -> None:
    assert run(ScriptedModel(GOOD), TextRequest("food")).attempts == 1


def test_when_every_attempt_is_too_easy_the_text_is_still_kept() -> None:
    model = ScriptedModel(GOOD, GOOD, GOOD)
    result = run(model, TextRequest("food", (MANGO,), floor=0.92, ceiling=0.96))
    assert result.passed and result.floor_met  # too easy is revised, never refused
    assert result.attempts == MAX_ATTEMPTS


def test_the_models_transliterations_are_kept_for_the_words_it_gave_them_for() -> None:
    d = draft(*["ฉัน|อยาก|กิน|ครับ"] * 6, "ทอน")
    d["glosses"] = [
        {"word": "ทอน", "english": "change", "translit": " thɔɔn "},
        {"word": "ฉัน", "english": "I", "translit": ""},
    ]
    result = run(ScriptedModel(d), TextRequest("food"))
    assert result.translits == {"ทอน": "thɔɔn"}


def test_a_story_episode_asks_to_carry_the_story_on() -> None:
    from franki_reader.generator import StoryContext

    first = request_message(TextRequest("a noodle stall", story=StoryContext(1, "a noodle stall")))
    assert "first episode of an ongoing story" in first and "It's about: a noodle stall" in first
    assert '"series"' in first and '"cast"' in first

    later = request_message(
        TextRequest(
            "a noodle stall",
            story=StoryContext(3, "", "Noi's stall", "Noi sells noodles.", ("One.", "Two.")),
        )
    )
    assert 'episode 3 of an ongoing story, "Noi\'s stall"' in later
    assert "Noi sells noodles." in later and "- One.\n- Two." in later


def test_a_draft_with_a_line_that_does_not_fit_its_speaker_is_sent_back() -> None:
    wrong = draft("ฉัน|อยาก|กิน|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ")
    wrong["genders"] = {"A": "male", "B": "female"}  # B says ครับ
    model = ScriptedModel(wrong, GOOD)
    result = run(model, TextRequest("food", (MANGO,)))
    assert result.passed and result.attempts == 2
    assert result.genders == {"A": "male", "B": "male"} and result.gender_ok
    assert "Speaker B is a woman" in model.sent[-1][-1]["content"]


def test_a_draft_that_never_fits_is_not_kept_however_good_its_coverage() -> None:
    wrong = dict(GOOD, genders={"A": "male", "B": "female"})
    result = run(ScriptedModel(wrong, wrong, wrong), TextRequest("food", (MANGO,)))
    assert not result.passed and not result.gender_ok
    assert result.coverage.ratio == 1.0


def test_a_dialogue_has_to_say_who_is_a_man_or_a_woman() -> None:
    unsaid = dict(GOOD, genders={"A": "none", "B": "none"})
    model = ScriptedModel(unsaid, GOOD)
    result = run(model, TextRequest("food", (MANGO,)))
    assert result.passed and result.attempts == 2
    assert 'Say in "genders"' in model.sent[-1][-1]["content"]


def test_a_story_has_no_genders() -> None:
    story = dict(GOOD, genders={"A": "female", "B": "female"})
    story["lines"] = [dict(line, speaker="N") for line in GOOD["lines"]]
    result = run(ScriptedModel(story), TextRequest("food", (MANGO,), form="story"))
    assert result.genders == {} and result.gender_ok


def test_each_speaker_is_given_a_character() -> None:
    result = run(ScriptedModel(GOOD), TextRequest("food", (MANGO,)))
    assert result.characters == {"A": "shopkeeper", "B": "friend"}


def test_a_character_that_is_not_in_the_set_is_dropped() -> None:
    odd = dict(GOOD, characters={"A": "wizard", "B": "doctor"})
    result = run(ScriptedModel(odd), TextRequest("food", (MANGO,)))
    assert result.characters == {"B": "doctor"}


def test_a_story_has_no_characters() -> None:
    story = dict(GOOD, characters={"A": "doctor", "B": "friend"})
    story["lines"] = [dict(line, speaker="N") for line in GOOD["lines"]]
    result = run(ScriptedModel(story), TextRequest("food", (MANGO,), form="story"))
    assert result.characters == {}


def test_a_marked_name_does_not_lower_coverage() -> None:
    named = draft("~สมชาย~|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ")
    result = run(ScriptedModel(named), TextRequest("food", (MANGO,)))
    assert result.passed and result.coverage.names == ("สมชาย",)


def test_too_many_names_go_back_to_the_model() -> None:
    names = "|".join(f"~ชื่อ{i}~" for i in range(MAX_NAMES + 1))
    too_many = draft(f"{names}|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ")
    model = ScriptedModel(too_many, GOOD)
    result = run(model, TextRequest("food", (MANGO,)))
    assert result.attempts == 2
    assert f"Mark at most {MAX_NAMES} different names" in str(model.sent[1][-1])


def test_the_prompts_state_the_name_limit() -> None:
    for language in ("th", "es"):
        assert f"at most {MAX_NAMES} different names" in system_prompt(ENTRIES, language)
