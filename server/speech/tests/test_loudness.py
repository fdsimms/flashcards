"""Loudness leveling, against real ffmpeg (skipped where it isn't installed)."""

import shutil
import subprocess

import pytest

from franki_speech.loudness import (
    TARGET_LUFS,
    LoudnessError,
    measure_loudness,
    normalize_loudness,
)

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg"),
]


def tone(volume: float, seconds: float = 1.5) -> bytes:
    """A speech-band tone at `volume` (1.0 is full scale), as MP3."""
    return subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=300:duration={seconds}",
            "-af",
            f"volume={volume}",
            "-ar",
            "24000",
            "-ac",
            "1",
            "-f",
            "mp3",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def test_a_quiet_and_a_loud_clip_end_at_the_same_level() -> None:
    quiet, loud = tone(0.03), tone(0.8)
    assert abs((await measure_loudness(loud) or 0) - (await measure_loudness(quiet) or 0)) > 15
    levels = [await measure_loudness(await normalize_loudness(c)) for c in (quiet, loud)]
    assert all(x is not None and abs(x - TARGET_LUFS) < 1.0 for x in levels)


def silence() -> bytes:
    return subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=24000:cl=mono",
            "-t",
            "1",
            "-f",
            "mp3",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout


async def test_silence_is_returned_as_it_was() -> None:
    silent = silence()
    assert await measure_loudness(silent) is None
    assert await normalize_loudness(silent) == silent


async def test_something_that_isnt_audio_is_refused_with_a_reason() -> None:
    with pytest.raises(LoudnessError, match="couldn't read"):
        await normalize_loudness(b"not audio at all")
