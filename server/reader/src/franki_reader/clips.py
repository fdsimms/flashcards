"""Lines spoken with Azure outside a text (a situation's lines, a grammar lesson's examples), kept in
the clip cache (`tts.ClipCache`) and served by key from `/api/situations/audio/{key}`."""

from franki_reader.engine import Engine
from franki_reader.languages import LANGUAGES, Code
from franki_reader.tts import SLOW_RATE, ClipCache, TtsFailed, billed_chars


async def speak_clip(
    engine: Engine,
    clips: ClipCache | None,
    language: Code,
    gender: str,
    line: str,
    slow: bool = False,
) -> tuple[str | None, int]:
    """`line` spoken in the language's voice for `gender`: the clip's key (None when there's no text
    to speech or Azure failed) and the characters Azure billed for it, 0 when the clip was already
    there. The slow clip (`tts.SLOW_RATE`) is its own, under its own key."""
    if clips is None or engine.synthesize is None:
        return None, 0
    voice = engine.voices_for(language)["female" if gender == "female" else "male"]
    key = ClipCache.key(line, f"{voice}@slow{SLOW_RATE}" if slow else voice)
    if clips.path(key) is not None:
        return key, 0
    locale = LANGUAGES[language].locale
    try:
        spoken = await (
            engine.synthesize(line, voice, locale, rate=SLOW_RATE)
            if slow
            else engine.synthesize(line, voice, locale)
        )
    except TtsFailed:
        return None, 0
    clips.write(key, spoken.audio, engine.clock())
    return key, billed_chars(line)
