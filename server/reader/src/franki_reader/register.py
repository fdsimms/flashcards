"""How formal the text Claude writes should sound: the learner's register (Settings, a cram, a
Situations scene). Three levels the app shows; `generator.REGISTERS` is a different list, the label
each generated line carries (casual, neutral, formal, slang).

A request that names no register gets the Settings default. A prompt takes the level as a sentence
from `instruction`, put in the user message (or a prompt that is not cached), never in a cached
system prompt, which has to stay byte-identical between calls."""

from typing import Literal

Register = Literal["casual", "everyday", "formal"]
LEVELS: tuple[Register, ...] = ("casual", "everyday", "formal")
DEFAULT: Register = "everyday"

_INSTRUCTIONS: dict[Register, str] = {
    "casual": (
        "Write the way people talk with friends or family: casual spoken forms, the shortened "
        "words and informal wording friends use, the subject left out when it is clear, nothing "
        "stiff or written. Keep it friendly, not rude, and use slang only where the situation "
        "calls for it."
    ),
    "everyday": (
        "Write the way an ordinary person talks in everyday conversation, not the way a textbook "
        "or a written text puts it: the spoken form of a word where it differs from the written "
        "one, the subject left out when it is clear, and no formal written words or "
        "constructions. Aim for plain, natural speech that is polite enough for a shop or a "
        "tutor, not very casual speech, slang or the shortenings used only between close friends."
    ),
    "formal": (
        "Write polite, formal speech, the way a person talks to a stranger, a boss or an "
        'interviewer: the language\'s polite forms and its formal "you" where it has one, full '
        "words rather than shortenings, and no slang. Keep it spoken and natural, not stiff "
        "written prose."
    ),
}


def instruction(register: Register) -> str:
    """The sentences that ask for `register`."""
    return _INSTRUCTIONS[register]
