"""A stored text as the app shows it: each line split into the pieces the server segmented, so a
tap always lands on something the lexicon or the gloss list knows about (docs/read-and-listen/architecture.md,
Generation and coverage)."""

import re
from typing import Any

from franki_reader import grammar
from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.frequency import rank_of
from franki_reader.japanese import JapaneseLexicon
from franki_reader.spaced import fold, lemma
from franki_reader.store import StoredText


def gloss_for(
    word: str, glosses: dict[str, str], lexicon: Checker, meanings: dict[str, str]
) -> str | None:
    """The text's own gloss, else the deck's meaning (of the entry it's a form of, so hablé gets
    hablar's), else the meaning kept for the word in lower case (meanings.py: a common word has none
    from the deck or the text), else, in Japanese, its dictionary form's (a WaniKani word's meaning is
    kept by its dictionary form, and 食べました has none of its own), else the meanings of the deck
    entries a known compound splits into (a word known that way has no entry of its own to gloss it)."""
    entry = lexicon.entry_of(word)
    lemma = lexicon.lemma_of(word) if isinstance(lexicon, JapaneseLexicon) else None
    if gloss := (
        glosses.get(word)
        or meanings.get(word)
        or (meanings.get(entry) if entry else None)
        or meanings.get(word.casefold())
        or (meanings.get(lemma) if lemma else None)
    ):
        return gloss
    pieces = lexicon.known_pieces(word)
    parts = [meanings[p] for p in pieces or [] if p in meanings]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


def lemma_for(word: str, lexicon: Checker) -> str | None:
    """The dictionary form of a word (rozumiem to rozumieć): the deck entry it's a form of, else
    simplemma's lemma (Sudachi's dictionary form in Japanese: 行きました to 行く). None for Thai, which
    has no inflection, and when the word is its own lemma."""
    if isinstance(lexicon, JapaneseLexicon):
        return lexicon.lemma_of(word) if is_word(word) else None
    if not lexicon.spaced or not is_word(word):
        return None
    code: str = getattr(lexicon, "code", "")
    entry = lexicon.entry_of(word)
    if entry is None and (not code or " " in word.strip()):
        return None
    found = entry or lemma(word, code)
    # The entry as written may carry an article (la ojiva): the word on its own is its form already.
    return None if fold(word, code) in fold(found, code).split() else found


def from_wanikani(word: str, lexicon: Checker) -> bool:
    """Whether a Japanese word is known for being learned in WaniKani, not from the deck or for
    being common: the app says so rather than calling it a common word."""
    return isinstance(lexicon, JapaneseLexicon) and lexicon.from_wanikani(word)


def translit_for(
    word: str, translits: dict[str, str], lexicon: Checker, deck: dict[str, str]
) -> str | None:
    """The deck note's transliteration (of the entry the word is a form of), else the one the model
    wrote for the text, else the deck entries' joined when a known compound splits into them. None
    when there's nothing to show, so the app offers no reveal rather than an empty one.

    Japanese reads each word as it's written here: the deck's KanaReading only for the entry itself
    (a conjugated form reads differently: 破った is やぶった, not やぶる), else Sudachi's reading."""
    if isinstance(lexicon, JapaneseLexicon):
        return deck.get(word) or lexicon.reading_of(word)
    entry = lexicon.entry_of(word)
    if found := deck.get(word) or (deck.get(entry) if entry else None) or translits.get(word):
        return found
    pieces = lexicon.known_pieces(word)
    parts = [deck[p] for p in pieces or [] if p in deck]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


_REFLEXIVE_PRONOUNS = frozenset({"me", "te", "se", "nos", "os"})


def mark_reflexive_pronouns(words: list[dict[str, Any]], lexicon: Checker) -> None:
    """A practice word that's a reflexive verb (agacharse) also marks the pronoun just before its
    form ("se agacha"), since the pronoun is part of the word. A form that's joined to its pronoun
    (agacharse, agáchate) is one token already, so only a separate pronoun needs this."""
    reflexive = getattr(getattr(lexicon, "rules", None), "reflexive", "")
    if not reflexive:
        return
    for i, word in enumerate(words):
        if not word["stretch"] or not word["lemma"]:
            continue
        if not re.search(rf"[aei]r{reflexive}$", word["lemma"].lower()):
            continue
        before = i - 1
        while before >= 0 and words[before]["text"].isspace():
            before -= 1
        if before >= 0 and words[before]["text"].lower() in _REFLEXIVE_PRONOUNS:
            words[before]["stretch"] = True


def render(
    text: StoredText,
    lexicon: Checker,
    meanings: dict[str, str],
    deck_translits: dict[str, str] | None = None,
    unset: tuple[str, ...] = (),
) -> dict[str, Any]:
    """`unset` is the language's grammar points the owner hasn't marked, as of now: any that turn
    up are marked and explained like the known ones worked in for review."""
    stretch = set(text.stretch)
    practice = tuple(text.grammar.get("practice", []))
    avoid = tuple(text.grammar.get("avoid", []))
    review = tuple(p for p in text.grammar.get("review", []) if p not in practice + avoid)
    unset = tuple(p for p in unset if p not in practice + avoid + review)
    used: set[str] = set()

    def render_words(source: str, marked: dict[int, str]) -> list[dict[str, Any]]:
        at = 0
        words: list[dict[str, Any]] = []
        for piece, is_name in segment_line(source, lexicon):
            if not is_word(piece):
                words.append(
                    {
                        "text": piece,
                        "status": None,
                        "gloss": None,
                        "lemma": None,
                        "translit": None,
                        "stretch": False,
                        "deck": False,
                        "wanikani": False,
                        "rank": None,
                        "grammar": None,
                    }
                )
                continue
            covers = grammar.count_words(piece, lexicon.spaced)
            point = next((marked[i] for i in range(at, at + covers) if i in marked), None)
            at += covers
            entry = lexicon.entry_of(piece)
            words.append(
                {
                    "text": piece,
                    "status": "name" if is_name else lexicon.status(piece),
                    "gloss": gloss_for(piece, text.glosses, lexicon, meanings),
                    "lemma": lemma_for(piece, lexicon),
                    "translit": translit_for(piece, text.translits, lexicon, deck_translits or {}),
                    "stretch": (entry or piece) in stretch,
                    # A deck word, as against one known for being common (every language but Thai).
                    "deck": entry is not None,
                    "wanikani": not is_name and from_wanikani(piece, lexicon),
                    # Its place among the language's most common words; None past the list's end.
                    "rank": None if is_name else rank_of(piece, lexicon),
                    "grammar": point,
                }
            )
        mark_reflexive_pronouns(words, lexicon)
        return words

    lines = []
    for line in text.lines:
        plain, _ = parse_line(line.text, lexicon.spaced)
        # Which words use a marked point, by index among the line's words; the first role wins.
        marked = grammar.marks(plain, lexicon, practice + avoid + review + unset)
        used.update(marked.values())
        lines.append(
            {
                "speaker": line.speaker,
                "english": line.english,
                "paragraph": line.paragraph,
                "register": line.register,
                "words": render_words(line.text, marked),
            }
        )
    return {
        "id": text.id,
        "topicId": text.topic_id,
        "title": text.title,
        "coverage": text.coverage,
        "stretch": list(text.stretch),
        "roles": text.roles,
        "genders": text.genders,
        "characters": text.characters,
        "form": text.form,
        "language": text.language,
        # The grammar this text was written to practice or avoid, for the reader's notes, then the
        # known points worked in and the unmarked ones that turned up, where a word uses them.
        "grammar": [
            {
                "id": pid,
                "name": grammar.POINTS[pid].name,
                "note": grammar.POINTS[pid].note,
                "role": role,
            }
            for role, ids in (
                ("practice", practice),
                ("avoid", avoid),
                ("review", tuple(p for p in review if p in used)),
                ("unset", tuple(p for p in unset if p in used)),
            )
            for pid in ids
            if pid in grammar.POINTS
        ],
        "lines": lines,
        # What the reader can pick to happen in the next episode (a story episode only), as words
        # like a line's but with no grammar marks, and the index picked so far.
        "choices": [
            {"english": c.english, "words": render_words(c.text, {})} for c in text.choices
        ],
        "chosen": text.chosen,
    }
