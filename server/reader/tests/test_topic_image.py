"""Starting a topic from an image: Claude names the grammar point, the title is checked, and
nothing is stored."""

import random
from typing import Any

from fastapi.testclient import TestClient
from scripted import ENTRIES, IN_RANGE, ScriptedModel
from test_app import AUTH, NOW, started

from franki_reader import store
from franki_reader.app import create_app
from franki_reader.engine import Engine
from franki_reader.generator import Usage
from franki_reader.languages import Code
from franki_reader.topic_image import (
    MAX_READS_PER_DAY,
    NOT_FOUND,
    ReadFailed,
    clean_title,
)

COST = Usage(1_000_000, 0, 0, 0, "claude-sonnet-5-5")  # $2


class Reader:
    def __init__(self, *answers: str | None | ReadFailed) -> None:
        self.answers = list(answers)
        self.seen: list[tuple[Code, str, str]] = []

    async def __call__(
        self, language: Code, data: str, media_type: str
    ) -> tuple[str | None, Usage]:
        self.seen.append((language, data, media_type))
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, ReadFailed):
            raise answer
        return answer, COST


def client(reader: Reader | None) -> tuple[TestClient, Any]:
    conn = store.connect(":memory:")
    store.save_snapshot(conn, ENTRIES, NOW)
    engine = Engine(conn, ScriptedModel(IN_RANGE).ask_for, None, lambda: NOW, random.Random(1))
    return started(create_app(engine, "open sesame", read_topic_image=reader)), conn


def read(c: TestClient, **over: Any) -> Any:
    body = {"language": "th", "image": "aGVsbG8=", "media_type": "image/jpeg", **over}
    return c.post("/api/grammar-topics/read-image", json=body, headers=AUTH)


# ==== The title ====


def test_a_title_is_one_clean_line_or_nothing() -> None:
    assert clean_title('  "Serial   verbs" ') == "Serial verbs"
    assert clean_title("") is None
    assert clean_title("x" * 81) is None
    assert clean_title("Serial verbs — going") is None
    assert clean_title("**Serial** verbs") is None
    assert clean_title(None) is None


# ==== Through the API ====


def test_the_image_is_read_and_its_title_returned() -> None:
    reader = Reader("Serial verbs")
    c, conn = client(reader)
    response = read(c, language="th", media_type="image/png")
    assert response.status_code == 200 and response.json() == {"title": "Serial verbs"}
    assert reader.seen == [("th", "aGVsbG8=", "image/png")]
    # Only the cost is kept: no topic is made until the owner has looked at the title.
    assert store.list_grammar_topics(conn, "th") == []
    assert store.topic_image_spending(conn, NOW.replace(year=2000)) == {"th": (1, 2.0)}


def test_no_grammar_point_in_the_image_says_so() -> None:
    c, conn = client(Reader(None))
    response = read(c)
    assert response.status_code == 422 and response.json()["detail"] == NOT_FOUND
    assert store.topic_image_spending(conn, NOW.replace(year=2000)) == {"th": (1, 2.0)}


def test_a_failed_call_is_refused_with_its_reason_and_still_costs() -> None:
    c, conn = client(Reader(ReadFailed("Claude didn't answer. Try again in a moment.", COST)))
    response = read(c)
    assert response.status_code == 503
    assert response.json()["detail"] == "Claude didn't answer. Try again in a moment."
    assert store.topic_image_spending(conn, NOW.replace(year=2000)) == {"th": (1, 2.0)}


def test_without_claude_it_says_how_to_turn_it_on() -> None:
    c, _ = client(None)
    response = read(c)
    assert response.status_code == 503 and "ANTHROPIC_API_KEY" in response.json()["detail"]


def test_a_file_that_is_not_an_image_type_is_refused() -> None:
    c, _ = client(Reader("Serial verbs"))
    assert read(c, media_type="application/pdf").status_code == 422
    assert read(c, image="").status_code == 422


def test_reads_are_capped_a_day() -> None:
    c, _ = client(Reader("Serial verbs"))
    for _ in range(MAX_READS_PER_DAY):
        assert read(c).status_code == 200
    over = read(c)
    assert over.status_code == 429 and str(MAX_READS_PER_DAY) in over.json()["detail"]
