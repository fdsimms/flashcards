"""Whether a voice chosen in the settings or asked to speak is one the language can use."""

from fastapi import HTTPException
from franki_speech import SpeechError, is_multilingual, locale_of

from franki_reader.languages import (
    LANGUAGES,
    Code,
)


def check_voice(name: str, code: Code) -> None:
    """Refuses a voice that isn't Azure's shape or doesn't speak the language it's chosen for."""
    try:
        locale = locale_of(name)
    except SpeechError as e:
        raise HTTPException(400, str(e)) from e
    if is_multilingual(name):  # it reads any language, so it's offered for every one
        return
    if locale.split("-")[0].lower() != code:
        raise HTTPException(
            400,
            f"{name} speaks {locale}, not {LANGUAGES[code].name}. Choose a {LANGUAGES[code].name} voice.",
        )
