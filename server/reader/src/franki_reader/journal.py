"""The writing journal (docs/read-and-listen/architecture.md, Journal): anything the owner writes in
the language, a paragraph or more, checked by Claude sentence by sentence and kept, with the mistakes
of each entry's first check counted by kind so the ones that keep coming back show.

Asked only when the owner taps Check it (or once a held entry is sent), one call each, never ahead
of time; its cost is "journal" in `call_costs`. Nothing here grades a card or writes a note: a word
the owner didn't know ([brackets]) comes back filled in, and goes to the note queue only on a tap.

Generate, then verify: the sentences Claude returns must be the entry, in order, as written (`_split`
refuses an answer that changed or left out any of it); a mistake's kind is kept only from the
language's grammar points or `GENERAL` (anything else becomes "other"), so the counts stay comparable;
a hint that names a word of its fix is replaced by the kind's name (production.py's `_hints`); and a
filled word is kept only for a bracket the entry has.
"""

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import anthropic

from franki_reader import grammar
from franki_reader.generator import Usage
from franki_reader.languages import LANGUAGES, Code
from franki_reader.production import (
    MAX_CHARS,
    VERDICTS,
    ProductionFailed,
    _hints,
    ask_structured,
)

MAX_ENTRY = 2000  # characters of an entry
MAX_PROMPT = 200
MAX_SENTENCES = 40
MAX_MISTAKES = 4  # in a sentence
MAX_TOKENS = 8000
MISTAKE_DAYS = 60  # the home's list of what keeps going wrong
IDEA_WORDS = 3

# Kinds of mistake that aren't a grammar point of the language. A point's id is a kind too.
GENERAL: dict[str, str] = {
    "case": "Case ending",
    "gender": "Gender",
    "agreement": "Agreement",
    "verb_form": "Verb form",
    "tense": "Tense",
    "aspect": "Aspect",
    "article": "Article",
    "preposition": "Preposition",
    "particle": "Particle",
    "word_order": "Word order",
    "spelling": "Spelling or accents",
    "word_choice": "Word choice",
    "missing_word": "A missing word",
    "extra_word": "A word not needed",
    "other": "Something else",
}
# The cases Which case asks about (src/tools/cases.ts, GovernedCase).
CASES = ("genitive", "dative", "accusative", "instrumental", "locative", "prepositional")

# English ideas for an entry, one a study day; never required.
IDEAS = (
    "What did you do yesterday evening?",
    "What are you doing this weekend?",
    "Describe your morning so far.",
    "What did you eat today, and was it good?",
    "Write a message to a friend about your week.",
    "What is the weather like, and what will you do in it?",
    "Describe a place you like to go.",
    "What are you reading, watching or listening to?",
    "Tell someone about your family.",
    "What would you do with a free day tomorrow?",
    "Describe your home.",
    "What was the best part of last week?",
    "Write about a trip you remember.",
    "What do you need to buy, and where will you get it?",
    "What is something you learned recently?",
    "Describe someone you saw today.",
    "What are your plans for next month?",
    "Write about your work or studies.",
)

_BRACKET = re.compile(r"\[([^\[\]]+)\]")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class CheckRequest:
    language: Code
    text: str
    prompt: str = ""


# The checked entry, and what asking for it cost.
CheckEntry = Callable[[CheckRequest], Awaitable[tuple[dict[str, Any], Usage]]]


def kinds(language: Code) -> dict[str, str]:
    """Every kind a mistake in `language` can have, by id: its grammar points, then `GENERAL`."""
    return {**{p.id: p.name for p in grammar.points_for(language)}, **GENERAL}


def kind_name(kind: str, case: str | None = None) -> str:
    """A kind as the app shows it: "Instrumental ending" for a case ending with its case known."""
    if kind == "case" and case:
        return f"{case.capitalize()} ending"
    point = grammar.POINTS.get(kind)
    return point.name if point else GENERAL.get(kind, GENERAL["other"])


def group_of(kind: str, case: str | None) -> str:
    """What a mistake is counted under: its kind, and a case ending by its case."""
    return f"case:{case}" if kind == "case" and case else kind


def _system(language: Code) -> str:
    name = LANGUAGES[language].name
    listed = "\n".join(f"- {k}: {v}" for k, v in kinds(language).items())
    return (
        f"You are a native-speaker tutor of {name}. The learner wrote a journal entry in {name}: "
        "anything they wanted to say. Check it sentence by sentence.\n\n"
        "Give `sentences`: the entry split into its sentences, in order, each with `written` copied "
        "exactly as the learner wrote it (every character, brackets included), so that together they "
        'are the whole entry. For each, give `verdict`: "right" (correct, and something a native '
        'speaker would say), "almost" (one or two small slips) or "wrong" (it doesn\'t make sense, '
        "says something else, or has more than two mistakes); `corrected`: the sentence with only "
        "its mistakes fixed, keeping the learner's words and meaning wherever they work, exactly "
        "`written` when it is right, as plain text in the language with no markup; `english`: what "
        "`corrected` means; and `mistakes`, empty for a right sentence, at most "
        f"{MAX_MISTAKES}, most important first. Each mistake has `was` (the learner's words that are "
        "wrong, copied exactly from `written`; empty for a word that is missing), `now` (what "
        "replaces them in `corrected`; empty for a word to drop), `kind` (one id from the list "
        "below: a grammar point's id when the mistake is about that point, otherwise the closest "
        "general kind), `case` (for a noun, adjective or pronoun in the wrong case, the case it "
        f"should be in, one of {', '.join(CASES)}; otherwise empty), `governor` (for a case "
        "mistake, the preposition or verb in the sentence that decides the case, as written; "
        f"otherwise empty), `note` (plain English, under {MAX_CHARS} characters: what changed and "
        "why) and `hint` (plain English: where the mistake is and what kind it is, for the learner "
        "to fix it themselves, never the fix: no word of the language that is in `corrected` and "
        "not in `written`).\n\n"
        "An English word or phrase in [square brackets] is one the learner didn't know: put the "
        "right word of the language in its place in `corrected`, list it in `filled` with the "
        "English as bracketed (`english`) and the word as used (`word`), and don't count it as a "
        "mistake. Never mark the learner down for wording that differs from what you would have "
        "written, as long as it is correct and natural. Do not use em dashes.\n\n"
        f"Kinds of mistake:\n{listed}"
    )


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "written": {"type": "string"},
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "corrected": {"type": "string"},
                    "english": {"type": "string"},
                    "mistakes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "was": {"type": "string"},
                                "now": {"type": "string"},
                                "kind": {"type": "string"},
                                "case": {"type": "string"},
                                "governor": {"type": "string"},
                                "note": {"type": "string"},
                                "hint": {"type": "string"},
                            },
                            "required": ["was", "now", "kind", "case", "governor", "note", "hint"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["written", "verdict", "corrected", "english", "mistakes"],
                "additionalProperties": False,
            },
        },
        "filled": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"english": {"type": "string"}, "word": {"type": "string"}},
                "required": ["english", "word"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["sentences", "filled"],
    "additionalProperties": False,
}


def message(request: CheckRequest) -> str:
    lines = []
    if request.prompt:
        lines.append(f"What they set out to write about: {request.prompt[:MAX_PROMPT]}")
    lines.append(f"The entry:\n{request.text[:MAX_ENTRY]}")
    return "\n".join(lines)


def flat(text: str) -> str:
    return _SPACE.sub(" ", text).strip()


def _split(text: str, sentences: list[str]) -> bool:
    """Whether `sentences`, in order, are the whole of `text` as written (spacing aside)."""
    whole, at = flat(text), 0
    for s in sentences:
        piece = flat(s)
        if not piece:
            return False
        found = whole.find(piece, at)
        if found < 0 or whole[at:found].strip():
            return False
        at = found + len(piece)
    return not whole[at:].strip()


def _text(raw: object, most: int = MAX_CHARS) -> str:
    return raw.strip()[:most] if isinstance(raw, str) else ""


def _mistake(raw: object, written: str, corrected: str, language: Code) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    allowed = kinds(language)
    kind = _text(raw.get("kind"), 80)
    kind = kind if kind in allowed else "other"
    named_case = _text(raw.get("case"), 20).casefold()
    case = named_case if named_case in CASES else None
    named_governor = _text(raw.get("governor"), 40)
    governor = (
        named_governor
        if case and named_governor and named_governor.casefold() in written.casefold()
        else None
    )
    was = _text(raw.get("was"))
    if was and was.casefold() not in written.casefold():
        was = ""  # not the learner's words: nothing on screen to mark
    now = _text(raw.get("now"))
    note = _text(raw.get("note"))
    if not (was or now or note):
        return None
    hint = _text(raw.get("hint"))
    kept = _hints([hint], 1, written, corrected, language) if hint else []
    return {
        "was": was,
        "now": now,
        "kind": kind,
        "name": kind_name(kind, case),
        "case": case,
        "governor": governor,
        "note": note,
        # A hint that names the fix gives way to the kind's name, which can't.
        "hint": kept[0] if kept else kind_name(kind, case),
    }


def clean(answer: dict[str, Any], request: CheckRequest) -> dict[str, Any] | None:
    """The check as the app gets it, or None when Claude's answer isn't the entry as written."""
    raw = answer.get("sentences")
    if not isinstance(raw, list) or not raw or len(raw) > MAX_SENTENCES:
        return None
    rows = [s for s in raw if isinstance(s, dict) and isinstance(s.get("written"), str)]
    if len(rows) != len(raw) or not _split(request.text, [s["written"] for s in rows]):
        return None
    sentences: list[dict[str, Any]] = []
    for s in rows:
        written = flat(s["written"])
        verdict = s.get("verdict")
        corrected = flat(_text(s.get("corrected"), MAX_ENTRY))
        if verdict not in VERDICTS or not corrected or "—" in corrected:
            return None
        if verdict == "right" and not _BRACKET.search(written):
            corrected = written
        mistakes = []
        if verdict != "right":
            for m in s.get("mistakes") or []:
                kept = _mistake(m, written, corrected, request.language)
                if kept:
                    mistakes.append(kept)
            mistakes = mistakes[:MAX_MISTAKES]
        if verdict != "right" and not mistakes and corrected == written:
            verdict = "right"  # nothing changed and nothing named: it stands as written
        sentences.append(
            {
                "written": written,
                "verdict": verdict,
                "corrected": corrected,
                "english": _text(s.get("english")),
                "mistakes": mistakes,
            }
        )
    asked = {b.strip().casefold() for b in _BRACKET.findall(request.text)}
    filled: list[dict[str, str]] = []
    for f in answer.get("filled") or []:
        if not isinstance(f, dict):
            continue
        english, word = _text(f.get("english"), 80), _text(f.get("word"), 80)
        if english.casefold() in asked and word and all(x["english"] != english for x in filled):
            filled.append({"english": english, "word": word})
    verdicts = [s["verdict"] for s in sentences]
    overall = (
        "right"
        if all(v == "right" for v in verdicts)
        else "wrong"
        if verdicts.count("wrong") * 2 > len(verdicts)
        else "almost"
    )
    return {"verdict": overall, "sentences": sentences, "filled": filled}


def claude_check(client: anthropic.AsyncAnthropic) -> CheckEntry:
    async def check(request: CheckRequest) -> tuple[dict[str, Any], Usage]:
        answer, used = await ask_structured(
            client, _system(request.language), message(request), SCHEMA, MAX_TOKENS
        )
        cleaned = clean(answer, request)
        if cleaned is None:
            raise ProductionFailed(
                "Claude's check didn't match what you wrote. Try again in a moment.", used
            )
        return cleaned, used

    return check


def mistakes_of(check: dict[str, Any]) -> list[dict[str, Any]]:
    """A check's mistakes, each with its sentence as written and corrected, in order."""
    return [
        {**m, "written": s["written"], "corrected": s["corrected"]}
        for s in check.get("sentences", [])
        for m in s.get("mistakes", [])
    ]


def idea(language: Code, day: str) -> str:
    """The study day's idea for an entry: the same all day, a different one most days."""
    digest = hashlib.sha256(f"{day}|{language}".encode()).digest()
    return IDEAS[int.from_bytes(digest[:4], "big") % len(IDEAS)]


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
