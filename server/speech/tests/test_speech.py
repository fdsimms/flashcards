"""The shared Azure client, against a faked Azure: what it sends, and how each failure reads."""

import asyncio

import httpx
import pytest

from franki_speech import (
    OUTPUT_FORMAT,
    THAI_PAUSE,
    THAI_PRONUNCIATIONS,
    SpeechClient,
    SpeechError,
    WordMark,
    is_multilingual,
    locale_of,
    ssml,
    text_locale,
)
from franki_speech.sdk import SdkMissing, SdkResult

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


def test_ssml_respells_a_thai_word_the_voice_misreads() -> None:
    out = ssml("มะม่วงราคาห้าสิบบาทค่ะ", VOICE)
    assert "<sub alias='มะ\u200bม่วง'>มะม่วง</sub>ราคา" in out
    assert "<sub" not in ssml("มะม่วง", "es-MX-JorgeNeural")


def test_a_thai_respelling_has_no_space_the_voice_would_pause_at() -> None:
    for alias in THAI_PRONUNCIATIONS.values():
        assert not any(c.isspace() and c != "\u200b" for c in alias)


def test_ssml_sets_the_speed() -> None:
    assert "<prosody rate='-20%'>" in ssml("x", VOICE, 0.8)


MULTI = "en-US-AvaMultilingualNeural"


def test_a_multilingual_voice_is_told_the_texts_language() -> None:
    out = ssml("東京", MULTI, 0.8, language="ja-JP")
    assert out == (
        "<speak version='1.0' xml:lang='en-US'><voice name='en-US-AvaMultilingualNeural'>"
        "<lang xml:lang='ja-JP'><prosody rate='-20%'>東京</prosody></lang></voice></speak>"
    )


def test_a_multilingual_voice_reading_its_own_language_or_an_unknown_one_gets_no_lang() -> None:
    plain = ssml("Hello", MULTI)
    assert "<lang" not in plain and "xml:lang='en-US'" in plain
    assert ssml("Hello", MULTI, language="en-us") == plain


def test_thai_read_by_a_multilingual_voice_gets_thais_pauses_and_respellings() -> None:
    out = ssml("มะม่วง ไปไหนครับ", MULTI, language="th-TH")
    assert "<lang xml:lang='th-TH'>" in out
    assert f"<sub alias='มะ\u200bม่วง'>มะม่วง</sub>{THAI_PAUSE}ไปไหนครับ" in out
    # Without the text's language, the voice's (English) decides, as before.
    assert "<break" not in ssml("มะม่วง ไปไหนครับ", MULTI)


def test_a_voice_that_isnt_multilingual_ignores_the_texts_language() -> None:
    assert ssml("สวัสดีครับ ไปไหน", VOICE, language="ja-JP") == ssml("สวัสดีครับ ไปไหน", VOICE)
    assert ssml("¿Qué tal?", "es-MX-JorgeNeural", language="es-ES") == ssml(
        "¿Qué tal?", "es-MX-JorgeNeural"
    )


def test_a_texts_language_is_a_locale() -> None:
    assert text_locale("th-th") == "th-TH"
    assert text_locale("sr-latn-rs") == "sr-Latn-RS"
    for bad in ["th", "Thai", "ja-JP' x='1", ""]:
        with pytest.raises(SpeechError, match="isn't a language and region"):
            text_locale(bad)
    with pytest.raises(SpeechError):
        ssml("x", MULTI, language="ja")


def test_a_multilingual_voice_is_known_by_its_name() -> None:
    assert is_multilingual(MULTI) and not is_multilingual(VOICE)


def test_a_name_that_isnt_a_voice_says_so() -> None:
    with pytest.raises(SpeechError, match="isn't an Azure voice name"):
        locale_of("Niwat")


async def no_sleep(seconds: float) -> None:
    waits.append(seconds)


waits: list[float] = []


def run(handler: httpx.MockTransport, text: str = "สวัสดีครับ") -> bytes:
    async def go() -> bytes:
        async with httpx.AsyncClient(transport=handler) as http:
            return await SpeechClient(
                "k", "eastus", http=http, user_agent="test", sleep=no_sleep
            ).synthesize(text, VOICE)

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


def test_a_rate_limit_is_retried_after_retry_after_then_succeeds() -> None:
    waits.clear()
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(429, headers={"Retry-After": "3"})
        return httpx.Response(200, content=b"ID3mp3")

    assert run(httpx.MockTransport(handler)) == b"ID3mp3"
    assert calls == 3 and waits == [3.0, 3.0]


def test_a_rate_limit_that_never_clears_gives_up_with_the_message() -> None:
    waits.clear()
    with pytest.raises(SpeechError, match="limiting requests"):
        run(httpx.MockTransport(lambda r: httpx.Response(429)))
    assert waits == [2.0, 4.0, 6.0]


# `speak`: the Speech SDK's call, with word timings, falling back to REST where it can't be made.

MARKS = [WordMark("สวัสดี", 50, 600), WordMark("ครับ", 600, 900)]


def speak(
    sdk: list[SdkResult | Exception],
    rest: httpx.MockTransport | None = None,
    endpoint: str | None = None,
) -> tuple[tuple[bytes, list[WordMark] | None], list[str]]:
    """Speaks a line with the SDK's answers taken in turn from `sdk`; returns what `speak` gave and
    the SSML the SDK was sent."""
    sent: list[str] = []

    async def fake(key: str, region: str, body: str) -> SdkResult:
        assert (key, region) == ("k", "eastus")
        sent.append(body)
        answer = sdk.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    rest = rest or httpx.MockTransport(lambda r: httpx.Response(200, content=b"ID3rest"))

    async def go() -> tuple[bytes, list[WordMark] | None]:
        async with httpx.AsyncClient(transport=rest) as http:
            client = SpeechClient(
                "k", "eastus", endpoint=endpoint, http=http, sleep=no_sleep, sdk_speak=fake
            )
            return await client.speak("สวัสดีครับ", VOICE)

    return asyncio.run(go()), sent


def test_speak_gives_the_sdks_audio_and_word_timings_for_the_same_ssml() -> None:
    (audio, marks), sent = speak([SdkResult(audio=b"ID3sdk", marks=MARKS)])
    assert audio == b"ID3sdk" and marks == MARKS
    assert sent == [ssml("สวัสดีครับ", VOICE)]


def test_speak_and_synthesize_send_the_texts_language() -> None:
    sent: list[str] = []

    async def fake(key: str, region: str, body: str) -> SdkResult:
        sent.append(body)
        return SdkResult(error="ConnectionFailure")

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.content.decode())
        return httpx.Response(200, content=b"ID3rest")

    async def go() -> tuple[bytes, list[WordMark] | None]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = SpeechClient("k", "eastus", http=http, sleep=no_sleep, sdk_speak=fake)
            return await client.speak("東京", MULTI, language="ja-JP")

    assert asyncio.run(go()) == (b"ID3rest", None)
    # The SDK's try and REST's fallback both say it.
    assert sent == [ssml("東京", MULTI, language="ja-JP")] * 2


def test_a_refused_lang_element_is_asked_for_again_without_it() -> None:
    # The <lang> element is written from Microsoft's examples, unchecked against a live key: if
    # Azure refuses it, the line is still recorded, as it was before.
    sent: list[str] = []

    async def fake(key: str, region: str, body: str) -> SdkResult:
        sent.append(body)
        if "<lang" in body:
            return SdkResult(error="BadRequest", details="lang")
        return SdkResult(audio=b"ID3sdk", marks=MARKS)

    def refuses(request: httpx.Request) -> httpx.Response:
        sent.append(request.content.decode())
        return httpx.Response(
            400 if "<lang" in request.content.decode() else 200, content=b"ID3rest"
        )

    async def go() -> tuple[tuple[bytes, list[WordMark] | None], bytes]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(refuses)) as http:
            client = SpeechClient("k", "eastus", http=http, sleep=no_sleep, sdk_speak=fake)
            return (
                await client.speak("東京", MULTI, language="ja-JP"),
                await client.synthesize("東京", MULTI, language="ja-JP"),
            )

    spoken, synthesized = asyncio.run(go())
    assert spoken == (b"ID3sdk", MARKS) and synthesized == b"ID3rest"
    assert sent == [ssml("東京", MULTI, language="ja-JP"), ssml("東京", MULTI)] * 2


def test_a_refusal_without_a_lang_element_is_not_asked_again() -> None:
    with pytest.raises(SpeechError, match="refused the request"):
        speak([SdkResult(error="BadRequest", details="voice")])


def test_speak_falls_back_to_rest_without_timings_when_the_sdk_wont_load() -> None:
    (audio, marks), _ = speak([SdkMissing("libMicrosoft.CognitiveServices.Speech.core.so")])
    assert (audio, marks) == (b"ID3rest", None)


@pytest.mark.parametrize("code", ["ConnectionFailure", "ServiceTimeout", "ServiceUnavailable"])
def test_speak_tries_rest_when_the_sdk_cant_get_through(code: str) -> None:
    (audio, marks), _ = speak([SdkResult(error=code, details="WS_OPEN_ERROR")])
    assert (audio, marks) == (b"ID3rest", None)


def test_speak_tries_rest_when_the_sdk_never_answers() -> None:
    async def hangs(key: str, region: str, body: str) -> SdkResult:
        await asyncio.sleep(3600)
        raise AssertionError("not reached")

    async def go() -> tuple[bytes, list[WordMark] | None]:
        rest = httpx.MockTransport(lambda r: httpx.Response(200, content=b"ID3rest"))
        async with httpx.AsyncClient(transport=rest) as http:
            client = SpeechClient(
                "k", "eastus", http=http, sleep=no_sleep, sdk_speak=hangs, sdk_timeout=0.01
            )
            return await client.speak("สวัสดีครับ", VOICE)

    assert asyncio.run(go()) == (b"ID3rest", None)


def test_speak_uses_rest_for_a_custom_endpoint() -> None:
    (audio, marks), sent = speak([], endpoint="https://custom.example")
    assert (audio, marks, sent) == (b"ID3rest", None, [])


@pytest.mark.parametrize(
    ("code", "match"),
    [
        ("AuthenticationFailure", "refused the key"),
        ("Forbidden", "refused the key"),
        ("BadRequest", "Check the voice name"),
        ("ServiceError", "ServiceError: it broke"),
    ],
)
def test_an_sdk_refusal_reads_as_the_rest_one_does(code: str, match: str) -> None:
    with pytest.raises(SpeechError, match=match):
        speak([SdkResult(error=code, details="it broke")])


def test_an_sdk_rate_limit_is_retried_then_gives_up_with_the_message() -> None:
    waits.clear()
    limited = SdkResult(error="TooManyRequests")
    (audio, _), _ = speak([limited, SdkResult(audio=b"ID3sdk", marks=MARKS)])
    assert audio == b"ID3sdk" and waits == [2.0]
    waits.clear()
    with pytest.raises(SpeechError, match="limiting requests"):
        speak([limited] * 4)
    assert waits == [2.0, 4.0, 6.0]


def test_an_sdk_answer_with_no_audio_is_an_error() -> None:
    with pytest.raises(SpeechError, match="no audio"):
        speak([SdkResult(audio=b"")])
