"""The voices of a story's characters (docs/read-and-listen/architecture.md, Audio: Story voices).

A story is told by a narrator, but its characters speak in quotation marks inside the narrator's
lines. The model says who each quotation belongs to (`quotes` on a line) and, once for each
character, whether they're a man or a woman and a child, an adult or elder (`Speaker`). Code does
the rest, so a story's cast never depends on the model's judgment of what sounds different:

- `quote_spans` finds the quotations in a line's text, by the language's quotation marks.
- `assign` gives each new character a voice and pitch no one else in the story has, from the
  language's voices for their gender. It's stored with the story (`stories.voices`), and a
  character's voice is never changed once given, so they sound the same in every episode.
- `line_parts` cuts a line into what the narrator says and what each character says, for one
  recording in several voices (`franki_speech.Part`).
- `quote_problems` is what's wrong with the model's attributions, for the revision message.
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from franki_speech import Part

from franki_reader.gender import GENDERS
from franki_reader.languages import Gender

Age = Literal["child", "adult", "elder"]
AGES: tuple[Age, ...] = ("child", "adult", "elder")

# How a character's age changes the voice's pitch, in percent. A child is the same voice a little
# higher and an elder a little lower: a change that reads as another kind of person without
# turning into a cartoon. It doesn't tell two adults of one gender apart (`assign` uses another
# voice for that, and a pitch step only once the voices are used up).
AGE_PITCH: dict[Age, int] = {"child": 18, "adult": 0, "elder": -8}
# What `assign` adds to the age's pitch, in the order it tries, once every voice has a character.
PITCH_STEPS = (0, 10, -10, 20, -20)
PITCH_RANGE = (-30, 35)

# A revision message names this many lines; the rest are counted.
MAX_PROBLEMS = 4

# Each opening quotation mark and the one that closes it: Russian, French and Spanish « », English
# and Thai “ ”, German and Polish „ “ or „ ”, Japanese 「 」 and 『 』, and the straight " that closes itself.
_CLOSING = {"«": "»", "“": "”", "„": "“”", "「": "」", "『": "』", '"': '"'}


# The kinds of character the voices are chosen for (Read & Listen's settings, Story characters),
# each a gender and an age.
CAST_TYPES: dict[str, tuple[Gender, Age]] = {
    "man": ("male", "adult"),
    "woman": ("female", "adult"),
    "boy": ("male", "child"),
    "girl": ("female", "child"),
    "elder_man": ("male", "elder"),
    "elder_woman": ("female", "elder"),
}


def cast_type(gender: Gender, age: Age) -> str:
    return next(t for t, kind in CAST_TYPES.items() if kind == (gender, age))


@dataclass(frozen=True)
class Preset:
    """The voice and pitch the first character of a type is given, when nobody in the story has it."""

    voice: str
    pitch: int


@dataclass(frozen=True)
class Speaker:
    """A character who speaks, as the model describes them."""

    name: str
    gender: Gender
    age: Age = "adult"


@dataclass(frozen=True)
class CastVoice:
    """A character's voice for good: what they were described as, and the voice and pitch they were
    given. Stored as it is, so a later change to the voices chosen in the app (or to the rules
    here) doesn't change how a character in an earlier episode sounds."""

    gender: Gender
    age: Age
    voice: str
    pitch: int


def quote_spans(text: str) -> list[tuple[int, int]]:
    """Where each quotation in `text` starts and ends (the marks included), in order. A quotation
    inside another is part of it, and a mark that is never closed starts nothing."""
    spans = []
    i = 0
    while i < len(text):
        closing = _CLOSING.get(text[i], "")
        ends = [e for c in closing if (e := text.find(c, i + 1)) > i]
        if ends:
            end = min(ends)
            spans.append((i, end + 1))
            i = end + 1
        else:
            i += 1
    return spans


def find(cast: Mapping[str, Any], name: str) -> str | None:
    """The key `name` is in `cast` under: exactly, else ignoring case and spaces at the ends."""
    name = name.strip()
    if name in cast:
        return name
    return next((k for k in cast if k.strip().casefold() == name.casefold()), None)


def parse_speakers(raw: Any) -> tuple[Speaker, ...]:
    """The characters the model listed, each once. One with no name, or a gender that isn't a
    man's or a woman's, is left out (a quotation by them is then reported); an age that isn't one
    of `AGES` is an adult's."""
    found: dict[str, Speaker] = {}
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        gender = item.get("gender")
        age = item.get("age")
        if name and gender in GENDERS and find(found, name) is None:
            found[name] = Speaker(name, gender, age if age in AGES else "adult")
    return tuple(found.values())


def clean_presets(raw: Any) -> dict[str, dict[str, Any]]:
    """The presets saved in the settings, keeping only a known type with a voice name and a pitch in
    range, so a setting removed or damaged later doesn't break loading."""
    low, high = PITCH_RANGE
    out: dict[str, dict[str, Any]] = {}
    for kind, chosen in (raw if isinstance(raw, dict) else {}).items():
        if not (kind in CAST_TYPES and isinstance(chosen, dict)):
            continue
        voice, pitch = chosen.get("voice"), chosen.get("pitch")
        if isinstance(voice, str) and voice and isinstance(pitch, int) and low <= pitch <= high:
            out[kind] = {"voice": voice, "pitch": pitch}
    return out


def presets(voices: Mapping[str, str], chosen: Mapping[str, Any]) -> dict[str, Preset]:
    """The voice and pitch for the first character of each type: the one chosen in the app, else
    what `assign` would give them (a narrator and nobody else in the story)."""
    out = {}
    for kind, (gender, age) in CAST_TYPES.items():
        saved = chosen.get(kind)
        if saved:
            out[kind] = Preset(saved["voice"], saved["pitch"])
        else:
            first = assign([Speaker("x", gender, age)], {}, voices)["x"]
            out[kind] = Preset(first.voice, first.pitch)
    return out


def assign(
    speakers: Sequence[Speaker],
    known: Mapping[str, CastVoice],
    voices: Mapping[str, str],
    chosen: Mapping[str, Preset] | None = None,
) -> dict[str, CastVoice]:
    """A voice for each speaker the story doesn't have yet. `voices` has every slot of the
    language (`gender.full_voices`). The narrator reads in the man's voice, so that voice at its
    own pitch is taken from the start.

    A character gets, in this order, the voice chosen for their type in the app (`chosen`, from
    `presets`), if no one in the story has it; else a voice of their gender at the pitch their age
    asks for that no one in the story has; then the same voices a step higher or lower; and once every combination is
    used, the least used one. So two women in a story with two women's voices sound different, and a
    third is the first one's voice at another pitch."""
    used: Counter[tuple[str, int]] = Counter({(voices["male"], 0): 1})
    for given in known.values():
        used[(given.voice, given.pitch)] += 1
    out: dict[str, CastVoice] = {}
    for speaker in speakers:
        if find(known, speaker.name) is not None or find(out, speaker.name) is not None:
            continue
        pool = list(dict.fromkeys([voices[speaker.gender], voices[f"{speaker.gender}2"]]))
        base = AGE_PITCH[speaker.age]
        low, high = PITCH_RANGE
        options = [
            (voice, base + step)
            for step in PITCH_STEPS
            for voice in pool
            if low <= base + step <= high
        ]
        picked = (chosen or {}).get(cast_type(speaker.gender, speaker.age))
        if picked is not None:
            options.insert(0, (picked.voice, picked.pitch))
        options = list(dict.fromkeys(options))
        voice, pitch = min(options, key=lambda o: (used[o], options.index(o)))
        used[(voice, pitch)] += 1
        out[speaker.name] = CastVoice(speaker.gender, speaker.age, voice, pitch)
    return out


def line_parts(
    plain: str, quotes: Sequence[str], cast: Mapping[str, CastVoice], narrator: str
) -> list[Part]:
    """A line's spoken text as the voices that speak it: the narrator's, and each quotation in the
    voice of the character `quotes` names for it. A quotation with no one named, or one the story
    has no voice for, stays the narrator's. `quotes` is in the order of the line's quotations, and
    the parts always join back to `plain`, so the words keep their timing."""
    parts: list[Part] = []
    at = 0
    for (start, end), name in zip(quote_spans(plain), quotes, strict=False):
        given = cast.get(find(cast, name) or "")
        if given is None:
            continue
        parts.append(Part(plain[at:start], narrator))
        parts.append(Part(plain[start:end], given.voice, given.pitch))
        at = end
    if not parts:
        return [Part(plain, narrator)]
    parts.append(Part(plain[at:], narrator))
    return _join_unspoken([p for p in parts if p.text])


def _join_unspoken(parts: list[Part]) -> list[Part]:
    """Parts with no word in them (the "." after a quotation's closing mark: `„Daj mi ją”.`) are
    joined to the part before, or the one after for the first. Azure reads a request that is only
    punctuation aloud ("kropka"), and the join keeps the parts adding up to the line."""
    merged: list[Part] = []
    carry = ""
    for part in parts:
        if not any(c.isalnum() for c in part.text):
            if merged:
                last = merged[-1]
                merged[-1] = Part(last.text + part.text, last.voice, last.pitch)
            else:
                carry += part.text
            continue
        merged.append(Part(carry + part.text, part.voice, part.pitch))
        carry = ""
    if not merged and parts:  # nothing but punctuation: left as it was
        return parts
    return merged


def quote_problems(
    lines: Sequence[tuple[str, Sequence[str]]], speakers: Mapping[str, object]
) -> list[str]:
    """What's wrong with who says each quotation, as sentences for the revision message. `lines`
    are each line's text as the model wrote it and its `quotes`; `speakers` is every character the
    story has or this draft listed. Each quotation needs a name, in order, and each name has to be
    one of the characters, so every character has a voice."""
    problems = []
    for n, (text, quotes) in enumerate(lines, 1):
        spans = quote_spans(text)
        if len(spans) != len(quotes):
            problems.append(
                f'Line {n} has {len(spans)} quotation{"" if len(spans) == 1 else "s"} but "quotes" '
                f"names {len(quotes)} speaker{'' if len(quotes) == 1 else 's'}. Name who says "
                'each quotation, in order, as written in "speakers" (words only in thoughts '
                "have no quotation marks)."
            )
            continue
        for name in quotes:
            if find(speakers, name) is None:
                problems.append(
                    f'Line {n}: "{name}" says a quotation but isn\'t in "speakers". Add them with '
                    "their gender and age, or use the name of a character who is."
                )
    if len(problems) > MAX_PROBLEMS:
        extra = len(problems) - MAX_PROBLEMS
        problems = [*problems[:MAX_PROBLEMS], f"{extra} more lines have the same problem."]
    return problems


def quotation_texts(text: str, quotes: Sequence[str]) -> list[tuple[str, str]]:
    """Each quotation in a line as the model wrote it, with the name given for it, for checks
    that read a speaker's words (a Thai man's ค่ะ). A line whose quotations and names don't
    match gives none: `quote_problems` already sends it back."""
    spans = quote_spans(text)
    if len(spans) != len(quotes):
        return []
    return [(name, text[start:end]) for (start, end), name in zip(spans, quotes, strict=True)]
