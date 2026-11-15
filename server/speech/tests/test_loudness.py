"""Loudness leveling, against real ffmpeg (skipped where it isn't installed)."""

import shutil
import subprocess

import pytest

from franki_speech.loudness import (
    TARGET_LUFS,
    LoudnessError,
    measure_loudness,
    normalize_loudness,
    trim_trailing_silence,
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


def tone_then_silence(tone_seconds: float, silence_seconds: float) -> bytes:
    """A tone followed by silence, as MP3: how Azure ends a line."""
    return subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=300:duration={tone_seconds}",
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=r=24000:cl=mono:d={silence_seconds}",
            "-filter_complex",
            "[0][1]concat=n=2:v=0:a=1",
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


def seconds(audio: bytes) -> float:
    """The clip's length, from its decoded samples (a pipe has no duration in its header)."""
    pcm = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            "pipe:0",
            "-f",
            "s16le",
            "-ar",
            "24000",
            "-ac",
            "1",
            "pipe:1",
        ],
        input=audio,
        check=True,
        capture_output=True,
    ).stdout
    return len(pcm) / 2 / 24000


async def test_silence_at_the_end_is_cut_short_and_the_start_is_kept() -> None:
    clip = tone_then_silence(1.0, 1.5)
    trimmed = await trim_trailing_silence(clip)
    assert 1.0 <= seconds(trimmed) < 1.4
    assert seconds(clip) > 2.4


async def test_a_clip_with_nothing_to_trim_keeps_its_length() -> None:
    assert abs(seconds(await trim_trailing_silence(tone(0.5))) - 1.5) < 0.15
