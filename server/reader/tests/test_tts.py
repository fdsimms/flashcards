import asyncio
from pathlib import Path

import httpx
import pytest
from franki_speech import SpeechClient

from franki_reader.tts import AudioCache, TtsFailed, azure_synthesize

# How Azure is called is tested with the shared client (server/speech/tests); this is the reader's side.


def run(handler: httpx.MockTransport) -> bytes:
    async def go() -> bytes:
        async with httpx.AsyncClient(transport=handler) as http:
            client = SpeechClient("k", "eastus", http=http)
            return await azure_synthesize(client)("สวัสดีครับ", "th-TH-NiwatNeural")

    return asyncio.run(go())


def test_speaks_a_line_through_the_shared_client() -> None:
    assert run(httpx.MockTransport(lambda r: httpx.Response(200, content=b"ID3mp3"))) == b"ID3mp3"


def test_a_failure_is_tts_failed_with_azures_reason() -> None:
    with pytest.raises(TtsFailed, match="refused the key"):
        run(httpx.MockTransport(lambda r: httpx.Response(401, text="bad key")))


def test_cache_writes_whole_files(tmp_path: Path) -> None:
    cache = AudioCache(tmp_path)
    assert not cache.has(3, 0)
    cache.write(3, 0, b"mp3")
    assert cache.has(3, 0)
    assert cache.path(3, 0).read_bytes() == b"mp3"
    assert list((tmp_path / "3").iterdir()) == [cache.path(3, 0)]
