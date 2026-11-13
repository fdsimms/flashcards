"""Coverage for languages written with spaces: which words in a text are known
(docs/read-and-listen/architecture.md, Languages). Every language but Thai.

Most of the owner's decks hold advanced words (el blindaje, das Verhältnis), not everyday ones, so
the deck alone can't be the dictionary the way it is for Thai. A word counts as known when it, or
its lemma, is a studied deck entry or one of the language's most common word families
(data/<code>_common.txt), as many of them as the language's `common` setting says (none, for a
beginner's deck counted alone). Spanish was first (26 October 2026); the rest followed on
12 November 2026.

- Lemmas come from simplemma, so hablé, hablaríamos and hablaste all match hablar. Its dictionaries
  are loaded in their low-memory form the first time a language is used: Polish takes 54 MB that
  way rather than 408 MB, with the same lemmas (checked against every listed word and two
  inflections of each), at about the same speed.
- An entry's article, infinitive marker or reflexive pronoun is matched without it (el blindaje,
  en butikk, å vente, sich verlieben, bać się), and counts as known in its own right, since the
  learner studied it with the entry. Alternatives split on "/" are each an entry
  (jeść / zjeść, ποιος/ποια/ποιο, der/die Mitwirkende), and a note in parentheses is ignored
  (zweifeln (an)).
- simplemma takes a French past participle for an adjective (craché), so a French word that ends
  like a regular verb form is also tried as that verb's infinitive, against deck entries only.
  Polish irregular forms it gets wrong (je for jeść, zjadła) aren't guessed: they're unknown, and
  the model is sent back to say it another way, like any unknown word.
- Spanish pronouns joined to a verb (dámelo, sentarse) are taken off and the verb checked without
  its written accent, and a reflexive entry (cerciorarse) matches its forms without "se".
- French elisions (l', j', qu') are words of their own: l'homme is le + homme.
- Russian ё and е are the same letter here, since texts, the word list and simplemma's lemmas each
  write one or the other.
- A word joined by hyphens (что-то, peut-être) is known when it's listed, or when every part is.
- A deck phrase (mantener a raya) is found by its lemmas, so mantuvimos a raya is one token, known,
  and counts as one word, like a Thai compound.
- Partial, as for Thai: a word that's neither common nor an entry but appears inside a deck phrase
  (quemarropa, from a quemarropa) counts as unknown, and its gloss can point at the phrase.
"""

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cache, cached_property
from pathlib import Path

from franki_reader.coverage import Status

_DATA = Path(__file__).parent / "data"
_TOKEN = re.compile(r"\w+(?:['’-]\w+)*|\s+|[^\w\s]", re.UNICODE)
_NUMBER = re.compile(r"^\d+([.,]\d+)*$")
_PHRASE_MAX = 6


@dataclass(frozen=True)
class Rules:
    """How a language's entries are written and its words are joined."""

    # Words an entry starts with that aren't the word itself: articles, the infinitive marker,
    # a reflexive pronoun (el blindaje, å vente, sich verlieben).
    prefixes: frozenset[str] = frozenset()
    # Words an entry ends with that aren't the word itself (bać się, å skynde seg).
    suffixes: frozenset[str] = frozenset()
    # Pronouns that join onto the end of a verb, longest first, so "los" is tried before "lo".
    clitics: tuple[str, ...] = ()
    # An entry ending this way is a reflexive verb, which also matches its forms without it.
    reflexive: str = ""
    # Elided words (l', qu') and the word each stands for, split off as words of their own.
    elisions: dict[str, str] | None = None
    # Endings of verb forms simplemma doesn't take back to the infinitive, and the infinitive's
    # ending, longest first. Tried only against deck entries, so a guess never makes a rare word
    # known: craché is cracher when the deck has cracher.
    guesses: tuple[tuple[str, str], ...] = ()


_FRENCH_ELISIONS = {
    "l": "le",
    "j": "je",
    "d": "de",
    "n": "ne",
    "s": "se",
    "m": "me",
    "t": "te",
    "c": "ce",
    "qu": "que",
    "jusqu": "jusque",
    "lorsqu": "lorsque",
    "puisqu": "puisque",
    "quoiqu": "quoique",
}


def _es_subjunctive() -> tuple[tuple[str, str], ...]:
    guesses = []
    for person in ("emos", "éis", "en", "es", "e"):  # -ar verbs
        for stem, spelled, infinitive in (("qu", "c", "ar"), ("c", "z", "ar"), ("gu", "g", "ar")):
            guesses.append((stem + person, spelled + infinitive))
        guesses.append((person, "ar"))
    for person in ("amos", "áis", "an", "as", "a"):  # -er and -ir verbs
        for stem, spelled in (("j", "g"),):
            guesses += [(stem + person, spelled + "er"), (stem + person, spelled + "ir")]
        guesses += [(person, "er"), (person, "ir")]
    return tuple(sorted(guesses, key=lambda g: -len(g[0])))


_ES_SUBJUNCTIVE_GUESSES = _es_subjunctive()

RULES: dict[str, Rules] = {
    "es": Rules(
        prefixes=frozenset({"el", "la", "los", "las", "un", "una", "unos", "unas", "lo"}),
        clitics=("nos", "les", "los", "las", "me", "te", "se", "le", "lo", "la", "os"),
        reflexive="se",
        # simplemma takes the present subjunctive to the noun or the first-person form (abras,
        # saque, alcance, escriba), not the infinitive. -ar verbs take -e, -er and -ir verbs take -a,
        # and the stem's spelling follows its sound (sacar saque, alcanzar alcance).
        guesses=_ES_SUBJUNCTIVE_GUESSES,
    ),
    "de": Rules(
        prefixes=frozenset(
            {"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer"}
            | {"eines", "sich"}
        ),
    ),
    "fr": Rules(
        prefixes=frozenset({"le", "la", "les", "l'", "un", "une", "des", "du", "se", "s'"}),
        elisions=_FRENCH_ELISIONS,
        # simplemma reads a past participle as an adjective (craché, guéri) and some present forms
        # as nouns (balade).
        guesses=(
            ("ées", "er"),
            ("ies", "ir"),
            ("ent", "er"),
            ("és", "er"),
            ("ée", "er"),
            ("is", "ir"),
            ("ie", "ir"),
            ("it", "ir"),
            ("es", "er"),
            ("é", "er"),
            ("i", "ir"),
            ("e", "er"),
        ),
    ),
    "ru": Rules(),
    "el": Rules(
        prefixes=frozenset(
            {"ο", "η", "το", "οι", "τα", "τον", "την", "του", "της", "των", "ένας", "μια", "μία"}
            | {"ένα"}
        ),
    ),
    # The deck marks a noun's gender with ten, ta, to or te (ta kobieta).
    "pl": Rules(prefixes=frozenset({"ten", "ta", "to", "te"}), suffixes=frozenset({"się"})),
    "nb": Rules(prefixes=frozenset({"en", "ei", "et", "å"}), suffixes=frozenset({"seg"})),
    # The deck's entries are bare words (velleity, abnegate), with no article or "to". simplemma
    # knows the common ones' forms but not a rare word's (velleities, kenoses), so a form is also
    # tried as its entry by its ending, against deck entries only, never the common words.
    "en": Rules(
        guesses=(
            ("ies", "y"),
            ("ied", "y"),
            ("ing", "e"),
            ("ing", ""),
            ("ed", "e"),
            ("ed", ""),
            ("es", "is"),  # Greek plurals: kenoses, anacruses
            ("es", "e"),
            ("es", ""),
            ("s", ""),
            ("i", "us"),
            ("ae", "a"),
        ),
    ),
}


@cache
def common_lemmas(code: str) -> tuple[str, ...]:
    """The language's most common word families, most common first, as written (Russian keeps its
    ё), for showing a word to the learner."""
    lines = (_DATA / f"{code}_common.txt").read_text(encoding="utf-8").splitlines()
    return tuple(w for w in lines if w and not w.startswith("#"))


@cache
def common_words(code: str) -> tuple[str, ...]:
    """The same list as it's compared."""
    return tuple(fold(w, code) for w in common_lemmas(code))


@cache
def _common(code: str, count: int) -> frozenset[str]:
    return frozenset(common_words(code)[:count])


# Forms simplemma takes back to the wrong verb. It reads vengo and the present subjunctive of venir
# as forms of vengar (to avenge), so "Ya vengo" showed up as a deck word glossed "to avenge". Only
# forms that belong to one verb are listed: a form two verbs share (creas, di, fuera) can't be
# settled without the sentence.
_LEMMA_FIXES: dict[str, dict[str, str]] = {
    "es": {
        w: verb
        for verb, forms in {
            "venir": "vengo venga vengas vengamos vengáis vengan vendría",
            "salir": "salgo salga salgas salgamos salgáis salgan",
            "entrar": "entraba entrabas entrábamos entrabais entraban",
            "empezar": "empecemos empeces empecéis",
            "recibir": "recibís",
            "morir": "muera mueras mueran muramos",
            "correr": "correría correrías",
        }.items()
        for w in forms.split()
    },
}


@cache
def lemma(word: str, code: str) -> str:
    import simplemma  # loaded on first use; see the module docstring

    word = fold(word, code)
    if fixed := _LEMMA_FIXES.get(code, {}).get(word):
        return fixed
    found = fold(str(simplemma.lemmatize(word, lang=code, low_memory=True)), code)
    if code == "es" and found.endswith("rse") and not word.endswith("se"):
        # volverías and utilizaréis come back as volverse and utilizarse
        return found[:-2]
    return found


def fold(word: str, code: str) -> str:
    """A word as it's compared: lowercased, Russian ё as е, a typographic apostrophe as '."""
    word = word.lower().replace("’", "'")
    return word.replace("ё", "е") if code == "ru" else word


def _plain(word: str) -> str:
    """Without written accents: dá → da. Keeps ñ and ü."""
    out = []
    for ch in unicodedata.normalize("NFD", word):
        if unicodedata.category(ch) == "Mn" and ch != "̃" and ch != "̈":
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def _is_word(token: str) -> bool:
    return any(ch.isalnum() for ch in token)


class SpacedLexicon:
    spaced = True

    def __init__(self, code: str, known: Iterable[str], common: int = 0) -> None:
        self.code = code
        self.rules = RULES[code]
        self.known = frozenset(e.strip() for e in known if e.strip())
        self.common = _common(code, common) if common else frozenset()
        # key (word, or space-joined phrase) -> the deck entry as written
        self._entries: dict[str, str] = {}
        self._phrases: dict[tuple[str, ...], str] = {}
        self._phrase_words: set[str] = set()  # the words of deck phrases, as written
        self._markers: set[str] = set()  # articles and the like, taken off studied entries
        for entry in sorted(self.known):
            for key in self._keys(entry):
                if len(key) > 1:
                    self._phrases[tuple(self._lemma(w) for w in key)] = entry
                    self._phrases.setdefault(key, entry)
                    self._phrase_words.update(key)
                    continue
                word = key[0]
                self._entries.setdefault(word, entry)
                self._entries.setdefault(self._lemma(word), entry)
                if self.rules.reflexive and re.search(rf"[aei]r{self.rules.reflexive}$", word):
                    # A reflexive verb (cerciorarse) also matches its forms without "se".
                    self._entries.setdefault(word[: -len(self.rules.reflexive)], entry)

    def _keys(self, entry: str) -> list[tuple[str, ...]]:
        """The ways an entry is matched, each as its words: one per alternative, without the
        article or marker it's written with."""
        text = re.sub(r"\([^)]*\)", " ", entry)
        alternatives = [self._words(alt) for alt in text.split("/")]
        alternatives = [a for a in alternatives if a]
        keys = []
        for words in alternatives:
            core = list(words)
            while len(core) > 1 and core[0] in self.rules.prefixes:
                self._markers.add(core.pop(0))
            while len(core) > 1 and core[-1] in self.rules.suffixes:
                self._markers.add(core.pop())
            if len(alternatives) > 1 and len(core) == 1 and core[0] in self.rules.prefixes:
                # "der" in der/die Mitwirkende: an article, not an entry of its own.
                self._markers.add(core[0])
                continue
            keys.append(tuple(core))
        return keys

    def _words(self, text: str) -> list[str]:
        return [fold(p, self.code) for p in self._pieces(text) if _is_word(p)]

    def _pieces(self, text: str) -> list[str]:
        """Words, spaces and punctuation, with French elisions split off (l'homme to l', homme)."""
        pieces = _TOKEN.findall(text)
        elisions = self.rules.elisions
        if not elisions:
            return pieces
        out = []
        for piece in pieces:
            head, sep, rest = piece.replace("’", "'").partition("'")
            if sep and rest and head.lower() in elisions:
                out += [piece[: len(head) + 1], piece[len(head) + 1 :]]
            else:
                out.append(piece)
        return out

    def _lemma(self, word: str) -> str:
        return lemma(word, self.code)

    @cached_property
    def partial(self) -> frozenset[str]:
        """Words inside a deck phrase that aren't known on their own."""
        return frozenset(w for w in self._phrase_words if not self._is_known(w))

    # ==== Segmenting ====

    def segment(self, text: str) -> list[str]:
        """Words, spaces and punctuation, with a deck phrase's words joined into one token."""
        pieces = self._pieces(text)
        out: list[str] = []
        i = 0
        while i < len(pieces):
            match = self._phrase_at(pieces, i) if _is_word(pieces[i]) else None
            if match is not None:
                out.append("".join(pieces[i:match]))
                i = match
            else:
                out.append(pieces[i])
                i += 1
        return out

    def _phrase_at(self, pieces: list[str], start: int) -> int | None:
        """The end index of the longest deck phrase starting at `start`, if there is one."""
        words: list[str] = []
        ends: list[int] = []
        i = start
        while i < len(pieces) and len(words) < _PHRASE_MAX:
            piece = pieces[i]
            if _is_word(piece):
                words.append(fold(piece, self.code))
                ends.append(i + 1)
            elif not piece.isspace():
                break  # punctuation ends a phrase
            i += 1
        for n in range(len(words), 1, -1):
            if self._phrase_entry(tuple(words[:n])) is not None:
                return ends[n - 1]
        return None

    def _phrase_entry(self, words: tuple[str, ...]) -> str | None:
        """The deck phrase these words are, as written or by their lemmas; the first word may also
        be a guessed form of the phrase's verb (craché le morceau)."""
        lemmas = tuple(self._lemma(w) for w in words)
        found = self._phrases.get(words) or self._phrases.get(lemmas)
        for guess in self._guesses(words[0]) if found is None else ():
            found = self._phrases.get((guess, *lemmas[1:]))
            if found is not None:
                break
        return found

    # ==== Status ====

    def entry_of(self, token: str) -> str | None:
        words = tuple(self._words(token))
        if len(words) > 1:
            return self._phrase_entry(words)
        word = words[0] if words else ""
        for form in self._forms(word) + self._guesses(word):
            if form in self._entries:
                return self._entries[form]
        return None

    def status(self, token: str) -> Status:
        words = self._words(token)
        if len(words) > 1:
            return "known" if self.entry_of(token) else "unknown"
        return self._word_status(words[0] if words else fold(token, self.code))

    def _word_status(self, word: str) -> Status:
        if self._is_known(word):
            return "known"
        if word in self.partial or self._lemma(word) in self.partial:
            return "partial"
        return "unknown"

    def _is_known(self, word: str) -> bool:
        if _NUMBER.match(word):
            return True
        forms = self._forms(word)
        if any(f in self.common or f in self._entries or f in self._markers for f in forms):
            return True
        if any(f in self._entries for f in self._guesses(word)):
            return True
        # A hyphenated word not listed whole (что-то, peut-être): known if every part is.
        parts = [p for p in word.split("-") if p]
        return len(parts) > 1 and all(self._is_known(p) for p in parts)

    def _forms(self, word: str) -> list[str]:
        """The word, its lemma, and the same for the verb under any joined pronouns."""
        if self.rules.elisions and word.rstrip("'") in self.rules.elisions:
            word = self.rules.elisions[word.rstrip("'")]  # l' is le
        forms = [word, self._lemma(word)]
        stem = word
        for _ in range(2):
            # At least two letters of verb must be left: dá from dámelo, but not from "le".
            clitic = next(
                (c for c in self.rules.clitics if stem.endswith(c) and len(stem) - len(c) >= 2),
                None,
            )
            if clitic is None:
                break
            stem = stem[: -len(clitic)]
            bare = _plain(stem)
            forms += [bare, self._lemma(bare)]
        return forms

    def _guesses(self, word: str) -> list[str]:
        """Infinitives the word might be a form of, by its ending (Rules.guesses)."""
        return [
            word[: -len(ending)] + infinitive
            for ending, infinitive in self.rules.guesses
            if word.endswith(ending) and len(word) - len(ending) >= 2
        ]

    def known_pieces(self, token: str) -> list[str] | None:
        return None  # no compounds to break down, as Thai has
