"""Audio lessons (docs/read-and-listen/architecture.md, Audio lessons): a short guided course in the
manner of a prompt-and-answer audio course, made from a scene the owner picks. A narrator speaks
English, a native voice speaks the language, and silences are left for the learner to say each
phrase aloud. The whole lesson is rendered into one MP3, so it plays with the screen locked.

Claude chooses the content only: a short dialogue, and 3 to 5 phrases to teach, each split into
parts. Everything about how it runs is code (`build_script`), never the model's, so the spacing is
exact and the same every time:

1. The dialogue is played once, to listen to.
2. Each phrase is taught: said by the native voice, its meaning given, then built up from its last
   part to the whole (backward build-up), the learner repeating each step in a silence.
3. Each phrase is then asked for in English, after a silence, and answered by the native voice.
4. Earlier phrases come back at widening gaps (`RECALL_GAPS`: after 1, then 3, then 6 more phrases
   have been taught), each asked in English with a silence to answer.
5. The dialogue is played again to close, which is now mostly understood.

Only languages written with spaces between words, since a phrase's parts are joined with spaces.

Generate, then verify: a phrase is kept only if its parts, put back together, are the phrase, and
none is empty. A lesson with fewer than `MIN_PHRASES` kept phrases isn't made. Nothing here grades
a card or writes a note: what the learner says aloud is never heard by the phone.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal

MIN_PHRASES, MAX_PHRASES = 3, 5
MIN_PARTS, MAX_PARTS = 1, 4
MAX_DIALOGUE = 6
MAX_CHARS = 200

# How many more phrases have been taught when an earlier phrase is asked for again.
RECALL_GAPS = (1, 3, 6)

# Silences, in milliseconds: time to start answering plus time per word, kept between a floor and a
# ceiling. Said slowly by a learner who has just heard the phrase, so it's generous.
PAUSE_BASE_MS = 2000
PAUSE_PER_WORD_MS = 700
PAUSE_MIN_MS = 3000
PAUSE_MAX_MS = 15000
# The breath between one thing said and the next.
BEAT_MS = 700

Voice = Literal["narrator", "male", "female"]


@dataclass(frozen=True)
class Say:
    """A clip to speak: the narrator's English, or a native voice's line in the language."""

    voice: Voice
    text: str


@dataclass(frozen=True)
class Silence:
    ms: int


Step = Say | Silence


@dataclass(frozen=True)
class Phrase:
    text: str  # the phrase in the language
    english: str
    parts: tuple[str, ...]  # in order; put back together they are `text`


@dataclass(frozen=True)
class Line:
    speaker: Literal["A", "B"]
    text: str
    english: str


@dataclass(frozen=True)
class Plan:
    """What Claude chose for a lesson."""

    title: str
    scene: str
    dialogue: tuple[Line, ...]
    phrases: tuple[Phrase, ...]


_WORD = re.compile(r"[\w']+", re.UNICODE)
_SPACES = re.compile(r"\s+")


def word_count(text: str) -> int:
    return len(_WORD.findall(text))


def pause_ms(words: int) -> int:
    """The silence for saying `words` words, to a tenth of a second."""
    raw = min(PAUSE_MAX_MS, max(PAUSE_MIN_MS, PAUSE_BASE_MS + PAUSE_PER_WORD_MS * words))
    return round(raw / 100) * 100


def _squash(text: str) -> str:
    return _SPACES.sub(" ", text).strip()


def _plain(text: str) -> str:
    """Text with the spaces and punctuation that don't matter when parts are put back together."""
    return "".join(_WORD.findall(text.casefold()))


def clean_phrase(raw: object) -> Phrase | None:
    """A phrase Claude wrote, or None if the code doesn't accept it: words and parts present, and
    the parts, put back together, the phrase."""
    if not isinstance(raw, dict):
        return None
    text, english, parts = raw.get("text"), raw.get("english"), raw.get("parts")
    if not isinstance(text, str) or not isinstance(english, str) or not isinstance(parts, list):
        return None
    text, english = _squash(text), _squash(english)
    if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
        return None
    if not all(isinstance(p, str) and _squash(p) for p in parts):
        return None
    chunks = tuple(_squash(p) for p in parts)
    if not MIN_PARTS <= len(chunks) <= MAX_PARTS:
        return None
    if _plain("".join(chunks)) != _plain(text):
        return None
    return Phrase(text, english, chunks)


def clean_plan(raw: object, scene: str) -> Plan | None:
    """The plan Claude wrote, or None when fewer than `MIN_PHRASES` phrases pass `clean_phrase`
    (a repeated phrase counts once) or the dialogue can't be used."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    title = _squash(title) if isinstance(title, str) else ""
    dialogue: list[Line] = []
    for item in raw.get("dialogue", []) if isinstance(raw.get("dialogue"), list) else []:
        if not isinstance(item, dict):
            continue
        speaker, text, english = item.get("speaker"), item.get("text"), item.get("english")
        if speaker in ("A", "B") and isinstance(text, str) and isinstance(english, str):
            text, english = _squash(text), _squash(english)
            if text and english and len(text) <= MAX_CHARS:
                dialogue.append(Line(speaker, text, english))
    phrases: list[Phrase] = []
    seen: set[str] = set()
    for item in raw.get("phrases", []) if isinstance(raw.get("phrases"), list) else []:
        phrase = clean_phrase(item)
        if phrase is not None and _plain(phrase.text) not in seen:
            seen.add(_plain(phrase.text))
            phrases.append(phrase)
    if len(phrases) < MIN_PHRASES or not dialogue:
        return None
    return Plan(
        title=title[:80] or scene[:80],
        scene=scene,
        dialogue=tuple(dialogue[:MAX_DIALOGUE]),
        phrases=tuple(phrases[:MAX_PHRASES]),
    )


def build_up(phrase: Phrase) -> list[str]:
    """What the learner repeats, last part first, growing to the whole phrase (backward build-up):
    "un café s'il vous plaît" in parts un café | s'il vous plaît is "s'il vous plaît", then the
    whole. A phrase of one part has only itself."""
    parts = phrase.parts
    steps = [" ".join(parts[i:]) for i in range(len(parts) - 1, -1, -1)]
    return steps[:-1] + [phrase.text] if len(parts) > 1 else [phrase.text]


def _ask(phrase: Phrase) -> list[Step]:
    """The narrator asks for the phrase in English, the learner has a silence to say it, and the
    native voice answers."""
    return [
        Say("narrator", f"How do you say: {phrase.english}"),
        Silence(pause_ms(word_count(phrase.text))),
        Say("male", phrase.text),
        Silence(BEAT_MS),
    ]


def _teach(phrase: Phrase) -> list[Step]:
    steps: list[Step] = [
        Say("narrator", "Listen."),
        Say("male", phrase.text),
        Silence(BEAT_MS),
        Say("narrator", f"That means: {phrase.english}"),
        Silence(BEAT_MS),
    ]
    built = build_up(phrase)
    if len(built) > 1:
        steps.append(Say("narrator", "Say it a piece at a time. Repeat after me."))
    else:
        steps.append(Say("narrator", "Repeat after me."))
    for chunk in built:
        steps += [
            Say("male", chunk),
            Silence(pause_ms(word_count(chunk))),
        ]
    return steps


def _dialogue(lines: tuple[Line, ...], intro: str) -> list[Step]:
    steps: list[Step] = [Say("narrator", intro), Silence(BEAT_MS)]
    for line in lines:
        steps += [Say("male" if line.speaker == "A" else "female", line.text), Silence(BEAT_MS)]
    return steps


def build_script(plan: Plan) -> list[Step]:
    """The lesson, step by step (see the module's docstring for its shape)."""
    steps = _dialogue(plan.dialogue, f"{plan.title}. Listen to this conversation.")
    # Recalls waiting: (phrase index, taught count at which it's asked).
    due: list[tuple[int, int]] = []
    steps.append(Say("narrator", "Now let's learn how to say some of it."))
    for taught, phrase in enumerate(plan.phrases, start=1):
        steps += _teach(phrase)
        steps += _ask(phrase)
        due += [(taught - 1, taught + gap) for gap in RECALL_GAPS]
        steps += [s for index, at in due if at == taught for s in _ask(plan.phrases[index])]
        due = [d for d in due if d[1] > taught]
    # What the gaps didn't reach before the phrases ran out: each of those phrases once more, in order.
    for index in sorted({i for i, _ in due}):
        steps += _ask(plan.phrases[index])
    steps += _dialogue(plan.dialogue, "Now listen to the conversation again.")
    steps.append(Say("narrator", "That's the end of the lesson."))
    return steps


def clips(steps: list[Step]) -> list[Say]:
    """Each distinct thing spoken, in order of first use, so it's recorded once however often it's
    heard."""
    seen: dict[Say, None] = {}
    for step in steps:
        if isinstance(step, Say):
            seen.setdefault(step)
    return list(seen)


def duration_ms(steps: list[Step], lengths: dict[Say, int]) -> int:
    """How long the lesson runs, given each clip's length in milliseconds."""
    return sum(s.ms if isinstance(s, Silence) else lengths.get(s, 0) for s in steps)


def characters(steps: list[Step]) -> int:
    """Characters Azure bills for, counting each distinct clip once."""
    return sum(len(c.text) for c in clips(steps))


def describe(plan: Plan) -> dict[str, Any]:
    """The plan as the app shows it: the title, the phrases taught, and the dialogue."""
    return {
        "title": plan.title,
        "scene": plan.scene,
        "phrases": [{"text": p.text, "english": p.english} for p in plan.phrases],
        "dialogue": [
            {"speaker": line.speaker, "text": line.text, "english": line.english}
            for line in plan.dialogue
        ],
    }
