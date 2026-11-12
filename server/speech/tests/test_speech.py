"""The shared Azure client, against a faked Azure: what it sends, and how each failure reads."""

import asyncio

import httpx
import pytest

from franki_speech import OUTPUT_FORMAT, THAI_PAUSE, SpeechClient, SpeechError, locale_of, ssml

VOICE = "th-TH-NiwatNeural"


def test_ssml_names_the_voice_takes_its_language_and_escapes_the_text() -> None:
    out = ssml("A & B <ok>", VOICE)
    assert "xml:lang='th-TH'" in out and "<voice name='th-TH-NiwatNeural'>" in out
    assert "<prosody rate='+0%'>A &amp; B &lt;ok&gt;</prosody>" in out
    assert "xml:lang='es-MX'" in ssml("¿Qué tal?", "es-MX-JorgeNeural")


def test_ssml_pauses_at_a_thai_clause_break() -> None:
    out = ssml("สวัสดีครับ ไปไหนครับ? กลับบ้าน OK ค่ะ", VOICE)
    assert f"สวัสดีครับ{THAI_PAUSE}ไปไหนครับ?{THAI_PAUSE}กลับบ้าน OK ค่ะ" in out
    assert "<break" not in ssml("¿Qué tal? Bien.", "es-MX-JorgeNeural")


def test_ssml_sets_the_speed() -> None:
    assert "<prosody rate='-20%'>" in ssml("x", VOICE, 0.8)


def test_a_name_that_isnt_a_voice_says_so() -> None:
    with pytest.raises(SpeechError, match="isn't an Azure voice name"):
        locale_of("Niwat")


def run(handler: httpx.MockTransport, text: str = "สวัสดีครับ") -> bytes:
    async def go() -> bytes:
        async with httpx.AsyncClient(transport=handler) as http:
            return await SpeechClient("k", "eastus", http=http, user_agent="test").synthesize(
                text, VOICE
            )

    return asyncio.run(go())


def test_posts_ssml_to_the_regional_endpoint_with_the_key_and_format() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"ID3mp3")

    assert run(httpx.MockTransport(handler)) == b"ID3mp3"
    request = seen[0]
    assert str(request.url) == "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"
    assert request.headers["Ocp-Apim-Subscription-Key"] == "k"
    assert request.headers["X-Microsoft-OutputFormat"] == OUTPUT_FORMAT
    assert request.headers["Content-Type"] == "application/ssml+xml"
    assert request.headers["User-Agent"] == "test"
    assert "สวัสดีครับ" in request.content.decode()


@pytest.mark.parametrize(
    ("status", "match"),
    [
        (401, "refused the key"),
        (400, "Check the voice name"),
        (429, "limiting requests"),
        (500, "500"),
    ],
)
def test_an_error_status_says_what_to_do(status: int, match: str) -> None:
    with pytest.raises(SpeechError, match=match):
        run(httpx.MockTransport(lambda r: httpx.Response(status, text="no")))


def test_an_empty_body_is_an_error() -> None:
    with pytest.raises(SpeechError, match="no audio"):
        run(httpx.MockTransport(lambda r: httpx.Response(200, content=b"")))


def test_a_network_error_says_azure_couldnt_be_reached() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(SpeechError, match="Couldn't reach Azure"):
        run(httpx.MockTransport(handler))
