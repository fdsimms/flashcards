"""
The one call made through Azure's Speech SDK (`azure-cognitiveservices-speech`) rather than the
REST API: speaking SSML with word boundaries, which the REST endpoint doesn't return. Blocking, so
the client runs it in a thread. Kept to plain data in and out so the client's handling of what it
returns is tested without the SDK (`SpeechClient.speak`).

Open risk: checked against the SDK's own source (1.53: `SpeechSynthesizer.speak_ssml_async`,
`synthesis_word_boundary`, whose event gives `audio_offset` in 100 ns ticks, `duration` as a
timedelta and the word's `text`, and `SpeechSynthesisCancellationDetails.error_code`), and run here
far enough to load its native library and fail on a made-up key; not yet against a live key.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class WordMark:
    """One word as the voice spoke it: its text (as the SSML spells it) and where it starts and
    ends in the audio, in milliseconds."""

    text: str
    start: int
    end: int


@dataclass
class SdkResult:
    """What one SDK call came to: the audio and its words, or the SDK's error code's name
    (`CancellationErrorCode`, "AuthenticationFailure", "TooManyRequests"...) and its details."""

    audio: bytes = b""
    marks: list[WordMark] = field(default_factory=list)
    error: str | None = None
    details: str = ""


class SdkMissing(Exception):
    """The SDK, or the native library under it, couldn't be loaded on this machine."""


def speak_ssml(key: str, region: str, ssml_text: str) -> SdkResult:
    try:
        # The SDK ships no types; what's read from it is kept to a few attributes, below.
        import azure.cognitiveservices.speech as speechsdk  # type: ignore[import-untyped]
    except (ImportError, OSError) as e:  # OSError: the package is there but its .so won't load
        raise SdkMissing(str(e)) from e

    config = speechsdk.SpeechConfig(subscription=key, region=region)
    config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3
    )
    # audio_config=None: the audio comes back in the result, rather than playing on a speaker.
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=config, audio_config=None)
    marks: list[WordMark] = []

    def on_word(evt: speechsdk.SpeechSynthesisWordBoundaryEventArgs) -> None:
        # Punctuation and sentence boundaries come through the same event; only words are kept.
        if evt.boundary_type != speechsdk.SpeechSynthesisBoundaryType.Word:
            return
        start = round(evt.audio_offset / 10_000)
        marks.append(WordMark(evt.text, start, start + round(evt.duration.total_seconds() * 1000)))

    synthesizer.synthesis_word_boundary.connect(on_word)
    result = synthesizer.speak_ssml_async(ssml_text).get()
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return SdkResult(audio=bytes(result.audio_data), marks=marks)
    details = result.cancellation_details
    code = getattr(details, "error_code", None)
    return SdkResult(
        error=code.name if code is not None else "Unknown",
        details=str(getattr(details, "error_details", "") or ""),
    )
