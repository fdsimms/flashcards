import asyncio
import json
import random
from dataclasses import replace
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started
from test_generator import FakeClient, finish, response

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.lexicon import Entry, lexicon_from
from franki_reader.situations import (
    MAX_UNKNOWN,
    Conversation,
    Line,
    Roles,
    SituationFailed,
    claude_feedback,
    claude_play,
    clean_feedback,
    clean_line,
    conversation_message,
    feedback_message,
    next_line,
    unknown_words,
    word_list,
)
from franki_reader.tts import ClipCache, Spoken

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2
CHECKER = lexicon_from(ENTRIES, "th")
ROLES = Roles("a customer", "the vendor", "Noi", "female")
START = {
    "you": "a customer",
    "them": "the vendor",
    "name": "Noi",
    "gender": "female",
    "line": "รับอะไรดีครับ",
    "english": "What would you like?",
    "glosses": [],
    "done": False,
}
TURN = {
    "line": "ฉันอยากกินข้าวเหนียวมะม่วงครับ",
    "english": "I want mango sticky rice.",
    "glosses": [],
    "done": False,
}
SCENE = "Ordering street food"


def talk(*lines: tuple[str, str]) -> Conversation:
    return Conversation("th", SCENE, ROLES, tuple(Line(s, t) for s, t in lines))  # type: ignore[arg-type]


# ==== A line of theirs ====


def test_a_first_line_comes_with_the_roles() -> None:
    cleaned = clean_line(START)
    assert cleaned is not None
    assert cleaned["roles"] == {
        "you": "a customer",
        "them": "the vendor",
        "name": "Noi",
        "gender": "female",
    }
    assert cleaned["line"] == "รับอะไรดีครับ" and cleaned["done"] is False


def test_glosses_dont_overwrite_the_lines_english() -> None:
    cleaned = clean_line(
        {**TURN, "glosses": [{"word": "ทุเรียน", "english": "durian"}, {"word": " "}]}
    )
    assert cleaned is not None
    assert cleaned["english"] == "I want mango sticky rice."
    assert cleaned["glosses"] == {"ทุเรียน": "durian"}


def test_a_line_with_markup_or_no_roles_on_a_first_turn_is_none() -> None:
    assert clean_line({**TURN, "line": "ฉัน|อยาก"}) is None
    assert clean_line({**TURN, "line": "  "}) is None
    assert clean_line({**START, "gender": "robot"}) is None
    assert clean_line({**START, "name": ""}) is None


def test_unknown_words_are_found_once_each() -> None:
    assert unknown_words("ฉันอยากกินทอนทอนครับ", CHECKER) == ["ทอน"]
    assert unknown_words("ฉันอยากกินครับ", CHECKER) == []


def test_messages_carry_the_parts_and_the_conversation() -> None:
    first = conversation_message(Conversation("th", SCENE, None, ()))
    assert "Start the conversation" in first
    later = conversation_message(talk(("them", "รับอะไรดีครับ"), ("you", "ขอ [mango] ครับ")))
    assert "Noi: รับอะไรดีครับ" in later and "Learner: ขอ [mango] ครับ" in later
    assert "Learner line 1: ขอ [mango] ครับ" in feedback_message(
        talk(("them", "x"), ("you", "ขอ [mango] ครับ"))
    )


def test_the_word_list_has_studied_words_only_without_the_texts_rules() -> None:
    listed = word_list(ENTRIES)
    assert (
        "ทอน" not in listed and "ฉัน | I; me | M" in listed and "|" not in listed.split("\n")[0][-1:]
    )


def run_next(
    *answers: dict[str, Any] | Exception,
) -> tuple[dict[str, Any], list[str], Usage, list[str]]:
    sent: list[str] = []
    queue = list(answers)

    async def play(
        entries: list[Entry], conversation: Conversation, feedback: str
    ) -> tuple[dict[str, Any], Usage]:
        sent.append(feedback)
        answer = queue.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer, COST

    line, unknown, used = asyncio.run(next_line(play, ENTRIES, talk(("you", "ครับ")), CHECKER))
    return line, unknown, used, sent


def test_a_line_within_the_known_words_is_kept_first_time() -> None:
    line, unknown, used, sent = run_next(TURN)
    assert line["line"] == TURN["line"] and unknown == [] and sent == [""]
    assert used.cost_usd() == 2.0


def test_a_line_with_too_many_unknown_words_goes_back_once_naming_them() -> None:
    many: dict[str, Any] = {**TURN, "line": "ทอนทุเรียนมังคุดเงาะครับ"}
    line, _, used, sent = run_next(many, TURN)
    assert len(unknown_words(many["line"], CHECKER)) > MAX_UNKNOWN
    assert "outside the list" in sent[1] and "ทอน" in sent[1]
    assert line["line"] == TURN["line"] and used.cost_usd() == 4.0


def test_the_first_line_is_kept_when_the_second_try_fails() -> None:
    many = {**TURN, "line": "ทอนทุเรียนมังคุดเงาะครับ"}
    line, unknown, _, _ = run_next(many, SituationFailed("no", COST))
    assert line["line"] == many["line"] and "ทอน" in unknown


# ==== Feedback ====


def test_feedback_keeps_the_learners_lines_and_words_worth_adding() -> None:
    conversation = talk(("them", "รับอะไรดีครับ ทุเรียน"), ("you", "ขอ [mango] ครับ"), ("you", "ครับ"))
    answer = {
        "lines": [
            {
                "index": 1,
                "verdict": "almost",
                "corrected": "ขอ มะม่วง ครับ",
                "note": "Mango is มะม่วง.",
            },
            {"index": 2, "verdict": "right", "corrected": "ค่ะ", "note": "Fine."},
            {"index": 0, "verdict": "right", "corrected": "x", "note": "Not theirs."},
            {"index": 1, "verdict": "right", "corrected": "dup", "note": "Twice."},
        ],
        "words": [
            {"word": "มะม่วง", "english": "mango", "why": "asked"},
            {"word": "ทุเรียน", "english": "durian", "why": "heard"},
            {"word": "เงาะ", "english": "rambutan", "why": "heard"},  # not in their lines
            {"word": "ฉัน", "english": "I", "why": "asked"},  # already known
        ],
    }
    cleaned = clean_feedback(answer, conversation, CHECKER)
    assert cleaned["lines"] == [
        {"index": 1, "verdict": "almost", "corrected": "ขอ มะม่วง ครับ", "note": "Mango is มะม่วง."},
        {"index": 2, "verdict": "right", "corrected": "ครับ", "note": "Fine."},
    ]
    assert [w["word"] for w in cleaned["words"]] == ["มะม่วง", "ทุเรียน"]


# ==== Claude's calls ====


def test_claude_plays_a_first_turn_with_the_start_schema() -> None:
    fake = FakeClient(response("end_turn", json.dumps(START)))
    answer, used = finish(claude_play(fake)(ENTRIES, Conversation("th", SCENE, None, ()), ""))  # type: ignore[arg-type]
    assert answer == START and used.cost_usd() > 0
    schema = fake.calls[0]["output_config"]["format"]["schema"]
    assert "gender" in schema["required"]
    assert fake.calls[0]["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_a_second_try_sends_the_feedback_after_the_conversation() -> None:
    fake = FakeClient(response("end_turn", json.dumps(TURN)))
    finish(claude_play(fake)(ENTRIES, talk(("you", "ครับ")), "Fewer words."))  # type: ignore[arg-type]
    messages = fake.calls[0]["messages"]
    assert messages[-1] == {"role": "user", "content": "Fewer words."}
    assert "gender" not in fake.calls[0]["output_config"]["format"]["schema"]["required"]


def test_claude_feedback_fails_with_its_cost_when_cut_off() -> None:
    fake = FakeClient(response("max_tokens", "{"))
    try:
        finish(claude_feedback(fake)(talk(("you", "ครับ"))))  # type: ignore[arg-type]
    except SituationFailed as e:
        assert e.usage.cost_usd() > 0
    else:
        raise AssertionError("expected SituationFailed")


# ==== The clip cache ====


def test_clips_are_found_by_key_and_old_ones_dropped(tmp_path: Path) -> None:
    clips = ClipCache(tmp_path)
    key = ClipCache.key("รับอะไรดีครับ", "th-TH-PremwadeeNeural")
    assert clips.path(key) is None
    clips.write(key, b"mp3", NOW)
    assert clips.path(key) == tmp_path / f"{key}.mp3"
    assert clips.path("../etc/passwd") is None
    other = ClipCache.key("ครับ", "v")
    clips.write(other, b"mp3", NOW + ClipCache.KEEP * 100)
    assert clips.path(key) is None and clips.path(other) is not None


# ==== The API ====


def client(
    play: Any = None, feedback: Any = None, tmp: Path | None = None, entries: list[Entry] = ENTRIES
) -> TestClient:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, entries, NOW)
    spoken: list[tuple[str, str]] = []

    async def synthesize(text: str, voice: str, locale: str) -> Spoken:
        spoken.append((text, voice))
        return Spoken(b"mp3")

    engine = Engine(
        conn,
        ScriptedModel(IN_RANGE).ask_for,
        None,
        lambda: NOW,
        random.Random(1),
        synthesize=synthesize if tmp else None,
    )
    app = create_app(
        engine,
        "open sesame",
        play=play,
        give_feedback=feedback,
        clips=ClipCache(tmp) if tmp else None,
    )
    c = started(app)
    c.spoken = spoken  # type: ignore[attr-defined]
    return c


def playing(*answers: dict[str, Any]) -> tuple[Any, list[Conversation]]:
    seen: list[Conversation] = []
    queue = list(answers)

    async def play(
        entries: list[Entry], conversation: Conversation, feedback: str
    ) -> tuple[dict[str, Any], Usage]:
        seen.append(conversation)
        return queue.pop(0), COST

    return play, seen


def test_a_first_turn_sets_the_roles_speaks_the_line_and_counts_both_costs(tmp_path: Path) -> None:
    play, seen = playing(START)
    app = client(play, tmp=tmp_path)
    got = app.post(
        "/api/situations/turn", json={"language": "th", "scene": SCENE}, headers=AUTH
    ).json()
    assert got["roles"]["gender"] == "female" and got["line"] == "รับอะไรดีครับ"
    assert "".join(w["text"] for w in got["words"]) == "รับอะไรดีครับ"
    assert (
        got["audio"]
        and app.get(f"/api/situations/audio/{got['audio']}", headers=AUTH).content == b"mp3"
    )
    assert app.spoken[0][1] == "th-TH-PremwadeeNeural"  # type: ignore[attr-defined]
    assert seen[0].roles is None
    costs = app.get("/api/costs", headers=AUTH).json()["situations"]
    assert (
        costs["asked"] == 1
        and costs["cost_usd"] == 2.0
        and costs["audio_chars"] == len("รับอะไรดีครับ")
    )


def test_a_later_turn_sends_the_roles_and_needs_the_learners_line_last() -> None:
    play, seen = playing(TURN)
    app = client(play)
    roles = {"you": "a customer", "them": "the vendor", "name": "Noi", "gender": "female"}
    body: dict[str, Any] = {
        "language": "th",
        "scene": SCENE,
        "roles": roles,
        "lines": [{"speaker": "them", "text": "รับอะไรดีครับ"}],
    }
    assert app.post("/api/situations/turn", json=body, headers=AUTH).status_code == 422
    body["lines"].append({"speaker": "you", "text": " ขอ  [mango]  ครับ "})
    got = app.post("/api/situations/turn", json=body, headers=AUTH).json()
    assert got["audio"] is None and "roles" not in got
    assert seen[0].roles == ROLES and seen[0].lines[-1] == Line("you", "ขอ [mango] ครับ")
    without_roles = {**body, "roles": None}
    assert app.post("/api/situations/turn", json=without_roles, headers=AUTH).status_code == 422


def test_a_word_due_and_not_reviewed_counts_as_unknown() -> None:
    held = [replace(e, due=True, reviewed=False) if e.text == "กิน" else e for e in ENTRIES]
    play, _ = playing({**TURN, "line": "ฉันอยากกินครับ"})
    got = client(play, entries=held).post(
        "/api/situations/turn",
        json={"language": "th", "scene": SCENE, "roles": None, "lines": []},
        headers=AUTH,
    )
    assert got.status_code == 503  # a first turn's line came without roles
    play, _ = playing({**START, "line": "ฉันอยากกินครับ"})
    got = client(play, entries=held).post(
        "/api/situations/turn", json={"language": "th", "scene": SCENE}, headers=AUTH
    )
    assert got.json()["unknown"] == ["กิน"]


def test_feedback_is_cleaned_and_its_cost_kept() -> None:
    async def feedback(conversation: Conversation) -> tuple[dict[str, Any], Usage]:
        return {
            "lines": [{"index": 1, "verdict": "right", "corrected": "x", "note": "Good."}],
            "words": [],
        }, COST

    app = client(feedback=feedback)
    roles = {"you": "a customer", "them": "the vendor", "name": "Noi", "gender": "female"}
    lines = [{"speaker": "them", "text": "รับอะไรดีครับ"}, {"speaker": "you", "text": "ครับ"}]
    got = app.post(
        "/api/situations/feedback",
        json={"language": "th", "scene": SCENE, "roles": roles, "lines": lines},
        headers=AUTH,
    )
    assert got.json() == {
        "lines": [{"index": 1, "verdict": "right", "corrected": "ครับ", "note": "Good."}],
        "words": [],
    }
    only_theirs = {"language": "th", "scene": SCENE, "roles": roles, "lines": lines[:1]}
    assert app.post("/api/situations/feedback", json=only_theirs, headers=AUTH).status_code == 422


def test_scenes_without_claude_and_the_passphrase() -> None:
    app = client()
    scenes = app.get("/api/situations/scenes?language=th", headers=AUTH).json()
    assert "Ordering street food" in scenes
    got = app.post("/api/situations/turn", json={"language": "th", "scene": SCENE}, headers=AUTH)
    assert got.status_code == 503 and "play a situation" in got.json()["detail"]
    assert (
        app.post("/api/situations/turn", json={"language": "th", "scene": SCENE}).status_code == 401
    )
    assert app.get("/api/situations/audio/" + "0" * 32, headers=AUTH).status_code == 404
