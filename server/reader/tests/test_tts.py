import asyncio
from pathlib import Path

import httpx
import pytest
from franki_speech import SpeechClient, WordMark
from franki_speech.sdk import SdkResult

from franki_reader.tts import AudioCache, Spoken, TtsFailed, azure_synthesize

# How Azure is called is tested with the shared client (server/speech/tests); this is the reader's side.


MARKS = [WordMark("สวัสดี", 50, 600), WordMark("ครับ", 600, 900)]


def run(sdk: SdkResult) -> Spoken:
    async def speak(key: str, region: str, body: str) -> SdkResult:
        return sdk

    async def go() -> Spoken:
        rest = httpx.MockTransport(lambda r: httpx.Response(200, content=b"ID3rest"))
        async with httpx.AsyncClient(transport=rest) as http:
            client = SpeechClient("k", "eastus", http=http, sdk_speak=speak)
            return await azure_synthesize(client)("สวัสดีครับ", "th-TH-NiwatNeural")

    return asyncio.run(go())


def test_speaks_a_line_with_its_word_timings_through_the_shared_client() -> None:
    assert run(SdkResult(audio=b"ID3mp3", marks=MARKS)) == Spoken(b"ID3mp3", MARKS)


def test_a_line_azure_couldnt_time_is_still_spoken() -> None:
    assert run(SdkResult(error="ConnectionFailure")) == Spoken(b"ID3rest", None)


def test_a_failure_is_tts_failed_with_azures_reason() -> None:
    with pytest.raises(TtsFailed, match="refused the key"):
        run(SdkResult(error="AuthenticationFailure"))


def test_cache_writes_whole_files(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path)
    assert not cache.has(3, 0)
    cache.write(3, 0, Spoken(b"mp3"))
    assert cache.has(3, 0)
    assert cache.path(3, 0).read_bytes() == b"mp3"
    assert list((tmp_path / "3").iterdir()) == [cache.path(3, 0)]
    assert cache.marks(3, 0) is None


def test_cache_keeps_a_lines_word_timings_beside_its_audio(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path)
    cache.write(3, 1, Spoken(b"mp3", MARKS))
    assert cache.marks(3, 1) == MARKS
    assert sorted(p.name for p in (tmp_path / "3").iterdir()) == ["1.json", "1.mp3"]
    # Recorded again without timings (the SDK couldn't be used): the old ones don't stay behind.
    cache.write(3, 1, Spoken(b"mp3"))
    assert cache.marks(3, 1) is None
    cache.drop(3)
    assert cache.marks(3, 1) is None


def test_unreadable_timings_are_none(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path)
    cache.write(3, 0, Spoken(b"mp3", MARKS))
    cache.path(3, 0).with_suffix(".json").write_text('{"not": "a list"}')
    assert cache.marks(3, 0) is None
