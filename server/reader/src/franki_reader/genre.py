"""The kind of text the learner asks for on the New text sheet (a mystery, a comedy, a news
report), apart from what it is about (the topic) and how formal it sounds (`register.py`).

"any" asks for nothing extra, so a text written without a genre is exactly what it was before.
A prompt takes the genre as a sentence from `instruction`, put in the user message, never in a
cached system prompt, which has to stay byte-identical between calls. The words still come from
the learner's deck, so a genre shapes the plot and tone, never the vocabulary."""

from typing import Literal

Genre = Literal[
    "any",
    "everyday",
    "comedy",
    "mystery",
    "romance",
    "adventure",
    "scifi",
    "fantasy",
    "horror",
    "drama",
    "news",
]
GENRES: tuple[Genre, ...] = (
    "any",
    "everyday",
    "comedy",
    "mystery",
    "romance",
    "adventure",
    "scifi",
    "fantasy",
    "horror",
    "drama",
    "news",
)
DEFAULT: Genre = "any"

_INSTRUCTIONS: dict[Genre, str] = {
    "any": "",
    "everyday": "an everyday slice of life: ordinary people in an ordinary situation, with nothing dramatic.",
    "comedy": "a comedy: a funny situation or misunderstanding, light in tone.",
    "mystery": "a mystery: something is missing or unexplained, and a clue leads to the answer by the end.",
    "romance": "a romance: two people who like each other, kept gentle and clean.",
    "adventure": "an adventure: a journey or a challenge with something at stake, moving from place to place.",
    "scifi": "science fiction: a near or far future with technology that doesn't exist yet.",
    "fantasy": "a fantasy: magic, creatures or an invented world, told plainly.",
    "horror": "a mild horror story: an eerie, tense mood with something strange happening, never gory.",
    "drama": "a drama: a serious situation between people, with a real disagreement or a hard choice.",
    "news": "a news report: it reads like a short broadcast or article about an event, with who, what, where and when.",
}


def instruction(genre: Genre) -> str:
    """The sentence that asks for `genre`; empty for "any"."""
    return _INSTRUCTIONS[genre]
