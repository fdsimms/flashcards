import asyncio
import shutil
import subprocess

import pytest

from franki_reader import lesson_audio
from franki_reader.lesson import Say, Silence, Step
from franki_reader.lesson_audio import BYTES_PER_MS, render, silence


def pcm_ms(data: bytes) -> int:
    return len(data) // BYTES_PER_MS


class Fakes:
    """Stand-ins for Azure and ffmpeg: a clip is its text as bytes, and decoding makes one
    millisecond of audio per character, so lengths are known."""

    def __init__(self) -> None:
        self.spoken: list[Say] = []
        self.encoded: bytes = b""

    async def speak(self, clip: Say) -> bytes:
        self.spoken.append(clip)
        return clip.text.encode()

    async def level(self, clip: bytes) -> bytes:
        return clip

    async def decode(self, mp3: bytes) -> bytes:
        return bytes([1]) * (len(mp3) * BYTES_PER_MS)

    async def encode(self, pcm: bytes) -> bytes:
        self.encoded = pcm
        return b"MP3"


async def run(steps: list[Step], fakes: Fakes) -> lesson_audio.Rendered:
    return await render(
        steps, fakes.speak, decode=fakes.decode, encode=fakes.encode, level_clip=fakes.level
    )


def test_lays_clips_and_silences_end_to_end() -> None:
    fakes = Fakes()
    steps: list[Step] = [Say("narrator", "Hi."), Silence(100), Say("male", "Salut.")]
    out = asyncio.run(run(steps, fakes))
    assert out.audio == b"MP3"
    assert out.duration_ms == 3 + 100 + 6
    assert pcm_ms(fakes.encoded) == out.duration_ms
    # The silence sits between the two clips, as zeros.
    assert fakes.encoded[: 3 * BYTES_PER_MS] == bytes([1]) * (3 * BYTES_PER_MS)
    assert fakes.encoded[3 * BYTES_PER_MS : 103 * BYTES_PER_MS] == silence(100)


def test_speaks_each_distinct_clip_once() -> None:
    fakes = Fakes()
    again = Say("male", "Salut.")
    steps: list[Step] = [again, Silence(10), Say("narrator", "Hi."), Silence(10), again]
    out = asyncio.run(run(steps, fakes))
    assert sorted(c.text for c in fakes.spoken) == ["Hi.", "Salut."]
    assert out.duration_ms == 6 + 10 + 3 + 10 + 6


def test_says_when_the_clips_are_spoken_and_joining_starts() -> None:
    fakes = Fakes()
    spoken_at_joining: list[int] = []
    asyncio.run(
        render(
            [Say("narrator", "Hi."), Say("male", "Salut.")],
            fakes.speak,
            decode=fakes.decode,
            encode=fakes.encode,
            level_clip=fakes.level,
            on_joining=lambda: spoken_at_joining.append(len(fakes.spoken)),
        )
    )
    assert spoken_at_joining == [2]


def test_the_same_words_in_two_voices_are_two_clips() -> None:
    fakes = Fakes()
    steps: list[Step] = [Say("male", "Oui."), Say("female", "Oui.")]
    asyncio.run(run(steps, fakes))
    assert len(fakes.spoken) == 2


def test_a_failure_to_speak_stops_the_lesson() -> None:
    fakes = Fakes()

    async def broken(clip: Say) -> bytes:
        raise lesson_audio.LessonAudioFailed("Azure didn't answer.")

    with pytest.raises(lesson_audio.LessonAudioFailed, match="Azure"):
        asyncio.run(
            render(
                [Say("male", "Oui.")],
                broken,
                decode=fakes.decode,
                encode=fakes.encode,
                level_clip=fakes.level,
            )
        )


def test_silence_is_zeros_of_the_right_length() -> None:
    assert silence(0) == b""
    assert pcm_ms(silence(250)) == 250
    assert set(silence(5)) == {0}


needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg isn't installed")


def tone(ms: int) -> bytes:
    """A real MP3 of a tone, made by ffmpeg, as Azure's clip stands in."""
    return subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={ms / 1000}",
            "-ar",
            "24000",
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            "-f",
            "mp3",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
    ).stdout


@needs_ffmpeg
def test_makes_a_real_mp3_about_as_long_as_the_script() -> None:
    async def speak(clip: Say) -> bytes:
        return tone(500)

    async def keep(clip: bytes) -> bytes:
        return clip

    steps: list[Step] = [Say("narrator", "Hi."), Silence(1000), Say("male", "Salut.")]
    out = asyncio.run(render(steps, speak, level_clip=keep))
    # Two half-second clips and a second of silence; an MP3 adds a little padding at its ends.
    assert 1900 <= out.duration_ms <= 2300
    # The MP3 decodes back to about as much audio as was laid down.
    decoded = asyncio.run(lesson_audio.ffmpeg_decode(out.audio))
    assert 1900 <= pcm_ms(decoded) <= 2300
