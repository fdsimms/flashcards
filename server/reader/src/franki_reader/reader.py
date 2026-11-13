"""A stored text as the app shows it: each line split into the pieces the server segmented, so a
tap always lands on something the lexicon or the gloss list knows about (docs/read-and-listen/architecture.md,
Generation and coverage)."""

from typing import Any

from franki_reader import grammar
from franki_reader.coverage import Checker, is_word, parse_line, segment_line
from franki_reader.spaced import fold, lemma
from franki_reader.store import StoredText


def gloss_for(
    word: str, glosses: dict[str, str], lexicon: Checker, meanings: dict[str, str]
) -> str | None:
    """The text's own gloss, else the deck's meaning (of the entry it's a form of, so hablé gets
    hablar's), else the meaning kept for the word in lower case (meanings.py: a common word has none
    from the deck or the text), else the meanings of the deck entries a known compound splits into (a
    word known that way has no entry of its own to gloss it)."""
    entry = lexicon.entry_of(word)
    if gloss := (
        glosses.get(word)
        or meanings.get(word)
        or (meanings.get(entry) if entry else None)
        or meanings.get(word.casefold())
    ):
        return gloss
    pieces = lexicon.known_pieces(word)
    parts = [meanings[p] for p in pieces or [] if p in meanings]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


def lemma_for(word: str, lexicon: Checker) -> str | None:
    """The dictionary form of a word (rozumiem to rozumieć): the deck entry it's a form of, else
    simplemma's lemma. None for Thai, which has no inflection, and when the word is its own lemma."""
    if not lexicon.spaced or not is_word(word):
        return None
    code: str = getattr(lexicon, "code", "")
    entry = lexicon.entry_of(word)
    if entry is None and (not code or " " in word.strip()):
        return None
    found = entry or lemma(word, code)
    # The entry as written may carry an article (la ojiva): the word on its own is its form already.
    return None if fold(word, code) in fold(found, code).split() else found


def translit_for(
    word: str, translits: dict[str, str], lexicon: Checker, deck: dict[str, str]
) -> str | None:
    """The deck note's transliteration (of the entry the word is a form of), else the one the model
    wrote for the text, else the deck entries' joined when a known compound splits into them. None
    when there's nothing to show, so the app offers no reveal rather than an empty one."""
    entry = lexicon.entry_of(word)
    if found := deck.get(word) or (deck.get(entry) if entry else None) or translits.get(word):
        return found
    pieces = lexicon.known_pieces(word)
    parts = [deck[p] for p in pieces or [] if p in deck]
    return " + ".join(parts) if pieces and len(parts) == len(pieces) else None


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
        words = []
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
                    "grammar": point,
                }
            )
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
