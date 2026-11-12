"""Who is a man and who is a woman in a text (docs/read-and-listen/architecture.md, Audio).

The model says which of A and B is a man or a woman (`genders`), and each is read in a voice of
that gender (`voice_for`). The model is asked to write every line to fit its speaker, and in Thai,
where the speaker's gender shows in a word on nearly every line (ครับ, ค่ะ), code checks it
(`gender_problems`) and a text that doesn't fit is sent back. The other languages mark gender in
verb endings and adjectives, which can't be checked reliably here, so they rest on the prompt.
"""

import re
from collections.abc import Mapping, Sequence

from franki_reader.languages import VOICE_SLOTS, Code, Gender

GENDERS: tuple[Gender, ...] = ("male", "female")

# A revision message names this many lines; the rest are counted.
MAX_PROBLEMS = 4


def full_voices(voices: Mapping[str, str]) -> dict[str, str]:
    """Every voice slot filled: a second voice a language doesn't have is the first of its gender,
    so two men in Thai (which has one man's voice) are both Niwat."""
    full = {slot: voices[slot] for slot in VOICE_SLOTS if voices.get(slot)}
    full.setdefault("male2", full["male"])
    full.setdefault("female2", full["female"])
    return {slot: full[slot] for slot in VOICE_SLOTS}


def voice_for(speaker: str, genders: Mapping[str, str], voices: Mapping[str, str]) -> str:
    """The voice a speaker is read in. `voices` has every slot (`full_voices`).

    A is the first speaker and uses their gender's first voice; B does too, unless A is the same
    gender, when B uses the second. The narrator of a story is read in the man's voice. A text
    written before genders were recorded has none: A is a man and B a woman, as it was recorded.
    """
    if not genders:
        genders = {"A": "male", "B": "female"}
    gender = genders.get(speaker)
    if speaker not in ("A", "B") or gender not in GENDERS:
        return voices["male"]
    same_as_a = speaker == "B" and genders.get("A") == gender
    return voices[f"{gender}2" if same_as_a else gender]


# The words that give a Thai speaker's gender away. ฉัน isn't here: men say it too. A man's ผม is a
# whole word only, since ผม is also "hair" and starts other words. คะ is matched as the end of a
# word, as it follows a question's last word (ไหมคะ) but also starts คะแนน, "score".
_MALE = "a man's"
_FEMALE = "a woman's"
_SPLIT = re.compile(r"[|\s]+")
_PUNCTUATION = ".,!?…;:\"'“”‘’()-"


def _thai_markers(text: str) -> dict[Gender, list[str]]:
    found: dict[Gender, list[str]] = {"male": [], "female": []}
    for token in _SPLIT.split(text.replace("*", "").replace("~", "")):
        token = token.strip(_PUNCTUATION)
        if not token:
            continue
        if "ครับ" in token:
            found["male"].append("ครับ")
        elif token == "ผม" or token == "กระผม":
            found["male"].append(token)
        if "ค่ะ" in token:
            found["female"].append("ค่ะ")
        elif token.endswith("คะ"):
            found["female"].append("คะ")
        elif "ดิฉัน" in token:
            found["female"].append("ดิฉัน")
    return found


def gender_problems(
    language: Code, lines: Sequence[tuple[str, str]], genders: Mapping[str, str]
) -> list[str]:
    """What's wrong with who says what, as sentences for the revision message. `lines` are
    (speaker, text as the model wrote it). Only Thai is checked; see the module's docstring."""
    if language != "th":
        return []
    problems = []
    for who in ("A", "B"):
        gender = genders.get(who)
        if gender not in GENDERS:
            continue
        other: Gender = "female" if gender == "male" else "male"
        for speaker, text in lines:
            if speaker != who:
                continue
            if wrong := _thai_markers(text)[other]:
                problems.append(
                    f"Speaker {who} is {'a man' if gender == 'male' else 'a woman'}, but says "
                    f"{wrong[0]}, which is {_FEMALE if other == 'female' else _MALE} word, in: "
                    f"{text}. Rewrite the line for {'a man' if gender == 'male' else 'a woman'}, "
                    f'or change who {who} is in "genders" and fix all of {who}\'s lines to match.'
                )
    if len(problems) > MAX_PROBLEMS:
        extra = len(problems) - MAX_PROBLEMS
        problems = [*problems[:MAX_PROBLEMS], f"{extra} more lines have the same problem."]
    return problems
