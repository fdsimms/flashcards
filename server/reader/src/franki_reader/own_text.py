"""The learner's own texts: something they found (an article, a chapter, song lyrics), pasted in to
read in Read & Listen like the texts written for them.

Nothing here writes the text: it's split into lines and parts as it is, so coverage is whatever it
is, and the preview says so before it's added (`preview`). Each line is translated (one Claude call
per part, `claude_translation`), and then the text goes through what a written one does after
writing (meanings, IPA, forms, audio), and joins the shelf's own row. It never moves the language's
difficulty: that level is about the texts written for the learner (`Engine.record_reading`).
"""

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import anthropic
from anthropic.types.beta import BetaMessageParam, BetaOutputConfigParam

from franki_reader.claude_errors import didnt_answer
from franki_reader.coverage import Checker, check, is_word, segment_line
from franki_reader.generator import CHEAP_MODEL, NATURAL_ENGLISH, Usage, usage_of
from franki_reader.languages import LANGUAGES, Code
from franki_reader.tts import azure_usd, billed_chars

# The most a pasted text may hold, in characters: a long chapter. More is refused with the count.
MAX_CHARS = 30_000
# A part holds about this many characters, split at a paragraph (or, failing that, a line): a
# text is read in sittings, and one long part would be a long wait to record.
PART_CHARS = 3_000
# A title given or made up from the text's start is at most this long.
MAX_TITLE = 60
# The new words a preview lists, most frequent first.
PREVIEW_WORDS = 40
MAX_TOKENS = 16_000

# The characters the reader's line format gives a meaning to (`coverage.parse_line`: `|` between
# words, `*` around a stretch word, `~` around a name). A pasted text means none of them, so they go.
_FORMAT_MARKS = re.compile(r"[|*~]")
# A sentence ends at . ! ? … (and their full-width forms), with any closing quote or bracket after
# them, before a space. Japanese and Chinese full stops need no space after them.
_SENTENCE_END = re.compile(
    r"(?<=[.!?…][\"'”’»)\]])\s+|(?<=[.!?…])\s+|(?<=[。！？])(?![」』）])|(?<=[。！？][」』）])"
)
# A Thai line ends at a space: Thai has no full stop, and a space is where a clause or sentence ends.
_THAI_GAP = re.compile(r"\s+")
# A Thai piece shorter than this isn't a line of its own: a space also sets off a short phrase or a name.
_THAI_SHORTEST = 12


@dataclass(frozen=True)
class OwnLine:
    text: str
    # The first line of a paragraph, as a story's line is (`generator.Line.paragraph`).
    paragraph: bool = False


class OwnTextRefused(ValueError):
    """The text can't be added, and why, written for the learner."""


def clean(text: str) -> str:
    """The text with Windows and old Mac line ends made plain, the line format's marks taken out,
    and each line's spaces at its ends trimmed."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _FORMAT_MARKS.sub(" ", text)
    return "\n".join(" ".join(line.split()) for line in text.split("\n")).strip()


def _sentences(paragraph: str, language: Code) -> list[str]:
    if language == "th":
        # A short piece ends the line before it (ครับ, a name); one that opens the paragraph is
        # joined by what follows.
        joined: list[str] = []
        for piece in (p for p in _THAI_GAP.split(paragraph) if p):
            if joined and (len(piece) < _THAI_SHORTEST or len(joined[-1]) < _THAI_SHORTEST):
                joined[-1] = f"{joined[-1]} {piece}"
            else:
                joined.append(piece)
        return joined
    return [s.strip() for s in _SENTENCE_END.split(paragraph) if s.strip()]


def split_lines(text: str, language: Code) -> list[OwnLine]:
    """The text's lines: a paragraph is a run of lines with no blank line between them (a lone line
    break, as in a poem or lyrics, starts a line of its own), and each is split into its sentences."""
    lines: list[OwnLine] = []
    for block in re.split(r"\n\s*\n", clean(text)):
        first = True
        for row in block.split("\n"):
            for sentence in _sentences(row, language):
                lines.append(OwnLine(sentence, paragraph=first))
                first = False
    return lines


def chunks(lines: list[str], size: int = PART_CHARS) -> list[list[str]]:
    """Lines in runs of about `size` characters, for translating a long text a run at a time (a
    video's subtitles are one text however long, unlike a pasted text's parts)."""
    runs: list[list[str]] = [[]]
    count = 0
    for line in lines:
        if runs[-1] and count + len(line) > size:
            runs.append([])
            count = 0
        runs[-1].append(line)
        count += len(line)
    return [r for r in runs if r]


def split_parts(lines: list[OwnLine], size: int = PART_CHARS) -> list[list[OwnLine]]:
    """The lines in parts of about `size` characters, each starting at a paragraph where one is
    near: a part ends at the last paragraph start past half its size, else where it's full."""
    parts: list[list[OwnLine]] = []
    current: list[OwnLine] = []
    length = 0
    for line in lines:
        if current and length + len(line.text) > size:
            cut = next(
                (
                    i
                    for i in range(len(current) - 1, 0, -1)
                    if current[i].paragraph and sum(len(x.text) for x in current[:i]) >= size / 2
                ),
                len(current),
            )
            parts.append(current[:cut])
            current = current[cut:]
            length = sum(len(x.text) for x in current)
        current.append(line)
        length += len(line.text)
    if current:
        parts.append(current)
    # A part that starts mid-paragraph starts a paragraph there, as the reader shows it.
    return [[OwnLine(p[0].text, True), *p[1:]] for p in parts]


def title_of(given: str, lines: list[OwnLine]) -> str:
    """The title given, or the first line's start when none is."""
    title = " ".join(given.split()) or (lines[0].text if lines else "")
    return title if len(title) <= MAX_TITLE else title[: MAX_TITLE - 1].rstrip() + "…"


def part_title(title: str, part: int, parts: int) -> str:
    return title if parts == 1 else f"{title} · Part {part} of {parts}"


def checked(text: str, language: Code) -> list[OwnLine]:
    """The text's lines, or `OwnTextRefused` saying what's wrong with it."""
    cleaned = clean(text)
    if not cleaned:
        raise OwnTextRefused("There's no text to add. Paste the text you want to read.")
    if len(cleaned) > MAX_CHARS:
        raise OwnTextRefused(
            f"The text is {len(cleaned):,} characters, and up to {MAX_CHARS:,} can be added at once. "
            "Add it in two or more goes."
        )
    lines = split_lines(cleaned, language)
    if not lines:
        raise OwnTextRefused("There's no text to add. Paste the text you want to read.")
    return lines


@dataclass(frozen=True)
class Preview:
    title: str
    coverage: float  # the share of its words the deck knows, as a written text's is counted
    words: int  # how many words were counted
    new_words: tuple[str, ...]  # words not known, most frequent first, at most PREVIEW_WORDS
    new_count: int  # how many different words aren't known
    lines: int
    parts: int
    characters: int
    seconds: int  # about how long it takes to hear read aloud
    cost_usd: float  # translating and recording it, as an estimate

    def json(self) -> dict[str, Any]:
        return self.__dict__ | {"new_words": list(self.new_words)}


# About how many characters a voice reads a second, for the preview's "about 4 minutes". Thai and
# Japanese pack more into a character.
_CHARS_PER_SECOND = {"th": 7.0, "ja": 6.0}
_DEFAULT_CHARS_PER_SECOND = 14.0
# About how many characters make a token, for the translation's cost estimate.
_CHARS_PER_TOKEN = {"th": 1.5, "ja": 1.2}


def estimate_cost(lines: list[OwnLine], language: Code, recorded: bool = True) -> float:
    """Recording every line (unless `recorded` is False: a video's lines are its own sound), and
    translating it (the prompt, the lines in, about as much English out)."""
    chars = sum(len(line.text) for line in lines)
    tokens = int(chars / _CHARS_PER_TOKEN.get(language, 3.5))
    translating = Usage(input_tokens=tokens + 400, output_tokens=tokens, model=CHEAP_MODEL)
    audio = azure_usd(sum(billed_chars(line.text) for line in lines)) if recorded else 0.0
    return round(translating.cost_usd() + audio, 3)


def preview(text: str, given_title: str, language: Code, lexicon: Checker) -> Preview:
    """What adding the text would give: its coverage against the deck as it is now, its new words,
    and its size and cost. Raises `OwnTextRefused` for a text that can't be added."""
    return preview_lines(checked(text, language), given_title, language, lexicon)


def preview_lines(
    lines: list[OwnLine],
    given_title: str,
    language: Code,
    lexicon: Checker,
    seconds: int | None = None,
) -> Preview:
    """`preview` for lines already split: a video's (video.py), whose `seconds` is its length and
    whose lines aren't recorded, since the video is their sound."""
    coverage = check((line.text for line in lines), lexicon)
    counts: dict[str, int] = {}
    shown: dict[str, str] = {}
    for line in lines:
        for piece, is_name in segment_line(line.text, lexicon):
            if is_name or not is_word(piece) or lexicon.status(piece) == "known":
                continue
            k = piece.casefold()
            counts[k] = counts.get(k, 0) + 1
            shown.setdefault(k, piece)
    ranked = sorted(counts, key=lambda k: -counts[k])
    chars = sum(len(line.text) for line in lines)
    rate = _CHARS_PER_SECOND.get(language, _DEFAULT_CHARS_PER_SECOND)
    return Preview(
        title=title_of(given_title, lines),
        coverage=round(coverage.ratio, 3),
        words=coverage.counted,
        new_words=tuple(shown[k] for k in ranked[:PREVIEW_WORDS]),
        new_count=len(counts),
        lines=len(lines),
        parts=len(split_parts(lines)),
        characters=chars,
        seconds=round(chars / rate) if seconds is None else seconds,
        cost_usd=estimate_cost(lines, language, recorded=seconds is None),
    )


class TranslationFailed(Exception):
    def __init__(self, message: str, usage: Usage | None = None) -> None:
        super().__init__(message)
        self.usage = usage or Usage()


# Translates a part's lines into English, one for each in order, and what that cost.
WriteTranslation = Callable[[Code, list[str]], Awaitable[tuple[list[str], Usage]]]

SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": {"type": "string"}}},
    "required": ["lines"],
    "additionalProperties": False,
}

_SYSTEM = (
    """\
You translate a {language} text into natural English for a learner reading it line by line. The \
learner sees each line's English under it, so each translation stays with its own line: never move \
words between lines, merge two lines or split one. """
    + NATURAL_ENGLISH
)


def request_message(lines: list[str]) -> str:
    numbered = "\n".join(f"{i}. {line}" for i, line in enumerate(lines, 1))
    return (
        f"Translate each of these {len(lines)} numbered lines into English, in order, one "
        "translation for each line, as the `lines` list. Translate what the line means in the "
        "text, in plain English; keep names as they are.\n\n" + numbered
    )


def parse_translation(raw: Any, count: int) -> list[str]:
    """The English for each line, or `TranslationFailed` when the answer doesn't have one per line."""
    lines = raw.get("lines") if isinstance(raw, dict) else None
    if not isinstance(lines, list) or len(lines) != count:
        got = len(lines) if isinstance(lines, list) else 0
        raise TranslationFailed(f"Expected {count} translated lines, got {got}")
    return [" ".join(str(x).split()) for x in lines]


def claude_translation(client: anthropic.AsyncAnthropic) -> WriteTranslation:
    output_config: BetaOutputConfigParam = {
        "effort": "low",
        "format": {"type": "json_schema", "schema": SCHEMA},
    }

    async def write(language: Code, lines: list[str]) -> tuple[list[str], Usage]:
        messages = [{"role": "user", "content": request_message(lines)}]
        try:
            response = await client.beta.messages.create(
                model=CHEAP_MODEL,
                max_tokens=MAX_TOKENS,
                system=_SYSTEM.format(language=LANGUAGES[language].name),
                messages=cast(list[BetaMessageParam], messages),
                output_config=output_config,
            )
        except anthropic.APIError as e:
            raise TranslationFailed(didnt_answer(e)) from e
        used = usage_of(response)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if response.stop_reason in ("refusal", "max_tokens") or text is None:
            raise TranslationFailed(f"No translation ({response.stop_reason})", used)
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as e:
            raise TranslationFailed("The answer wasn't valid JSON", used) from e
        try:
            return parse_translation(raw, len(lines)), used
        except TranslationFailed as e:
            raise TranslationFailed(str(e), used) from e

    return write
