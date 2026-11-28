import asyncio
import json

import httpx
import pytest

from franki_speech.transcribe import Phrase, TranscribeFailed, cost_usd, parse, transcribe

ANSWER = {
    "durationMilliseconds": 9000,
    "phrases": [
        {"offsetMilliseconds": 4000, "durationMilliseconds": 2000, "text": "Poproszę  kawę."},
        {"offsetMilliseconds": 960, "durationMilliseconds": 640, "text": "Dzień dobry."},
        {"offsetMilliseconds": 7000, "durationMilliseconds": 500, "text": " "},
    ],
}


def test_reads_each_phrase_and_its_times_in_order() -> None:
    found = parse(ANSWER)
    assert found.duration_ms == 9000
    assert found.phrases == (
        Phrase(960, 1600, "Dzień dobry."),
        Phrase(4000, 6000, "Poproszę kawę."),
    )
    with pytest.raises(TranscribeFailed):
        parse([])


def test_prices_an_hour_at_the_estimate() -> None:
    assert cost_usd(1860) == 0.52 and cost_usd(-5) == 0


def test_asks_azure_to_fetch_the_audio_in_the_language() -> None:
    asked: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return httpx.Response(200, json=ANSWER)

    http = httpx.AsyncClient(transport=httpx.MockTransport(answer))
    found = asyncio.run(
        transcribe(http, "k", "westeurope", "https://cdn.example.com/a.mp3", "pl-PL")
    )
    assert len(found.phrases) == 2
    request = asked[0]
    assert request.url.host == "westeurope.api.cognitive.microsoft.com"
    assert request.url.params["api-version"] == "2025-10-15"
    assert request.headers["Ocp-Apim-Subscription-Key"] == "k"
    body = request.content.decode()
    definition = json.loads(
        body.split("application/json")[1].split("\r\n\r\n", 1)[1].split("\r\n--")[0]
    )
    assert definition == {
        "audioUrl": "https://cdn.example.com/a.mp3",
        "locales": ["pl-PL"],
        "profanityFilterMode": "None",
    }


@pytest.mark.parametrize(
    ("status", "says"),
    [(401, "refused the key"), (429, "busy"), (400, "couldn't transcribe")],
)
def test_a_refusal_says_what_to_do(status: int, says: str) -> None:
    http = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(status, json={"message": "bad audio"})
        )
    )
    with pytest.raises(TranscribeFailed, match=says):
        asyncio.run(transcribe(http, "k", "westeurope", "https://x.example.com/a.mp3", "pl-PL"))


def test_no_words_heard_is_a_refusal() -> None:
    http = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"phrases": []}))
    )
    with pytest.raises(TranscribeFailed, match="no words"):
        asyncio.run(transcribe(http, "k", "r", "https://x.example.com/a.mp3", "pl-PL"))
