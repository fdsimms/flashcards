"""
A noun's article, from its Gender, and a Norwegian verb's å, for the audio the MCP records.

Franki's cards show the article from the Gender field (the Entry is the bare noun), and say it with
the word. That includes Polish's and Russian's gender words (ten / ta / to, этот / эта / это, and te / ci
for a plural), which do an article's job. A recording of the Entry alone would leave it out, so
`add_tts_audio` puts it back in front of the text. This mirrors `src/core/gender.ts` (`GENDER_PREFIXES`,
`PLURAL_PREFIXES`, `SPOKEN_ARTICLE`, `genderArticle`, `withArticle`); `tests/test_articles.py` fails if
the tables drift apart.
"""

from __future__ import annotations

import re

# The first two letters of the language's speech tag, by the names the Language field uses (`LANG_TAGS`
# in src/core/cards.ts), for the languages whose article is said with the word.
LANGUAGE_CODES = {
    "spanish": "es", "español": "es", "espanol": "es",
    "norwegian": "nb", "norsk": "nb",
    "german": "de", "deutsch": "de",
    "french": "fr", "français": "fr", "francais": "fr",
    "greek": "el", "ελληνικά": "el",
    "polish": "pl", "polski": "pl",
    "russian": "ru", "русский": "ru",
}  # fmt: skip

ARTICLES: dict[str, dict[str, str]] = {
    "es": {"m": "el", "f": "la"},
    "nb": {"m": "en", "f": "ei", "n": "et"},
    "de": {"m": "der", "f": "die", "n": "das"},
    "fr": {"m": "le", "f": "la"},
    "el": {"m": "ο", "f": "η", "n": "το"},
    "pl": {"m": "ten", "f": "ta", "n": "to"},
    "ru": {"m": "этот", "f": "эта", "n": "это"},
}

# A plural-only noun's word, by the Gender field's value (`PLURAL_PREFIXES` in src/core/gender.ts).
PLURAL_WORDS: dict[str, dict[str, str]] = {"pl": {"pl": "te", "mpl": "ci"}}

# Words an Entry may already start with: then it holds its own article (el agua, l'homme, los modales) and
# gets no second one. The same set as `ARTICLES` in src/core/gender.ts.
_LEADING = frozenset(
    "der die das el la lo le il ο η το en ei et ett los las les οι τα".split()
)
_ELISION = re.compile(r"^l['’]", re.IGNORECASE)
_VOWEL = re.compile(r"^[aeiouàâäéèêëìíîïòóôöùúûüœæ]", re.IGNORECASE)


def article_for(language: str, gender: str, entry: str) -> str | None:
    """The article to say before a bare Entry, or None: no gender, a language that doesn't say one, or an
    Entry that already starts with an article."""
    code = LANGUAGE_CODES.get(language.strip().lower())
    key = gender.strip().lower()
    word = ARTICLES.get(code or "", {}).get(key) or PLURAL_WORDS.get(code or "", {}).get(key)
    entry = entry.strip()
    if not word or not entry:
        return None
    first = entry.split(None, 1)[0].lower()
    own = (*ARTICLES.get(code or "", {}).values(), *PLURAL_WORDS.get(code or "", {}).values())
    if _ELISION.match(entry) or (" " in entry and first in _LEADING) or entry.lower().startswith(tuple(f"{w} " for w in own)):
        return None
    return "l'" if code == "fr" and _VOWEL.match(entry) else word


# The word a verb is named with (å huske): the Entry is the bare verb and the card puts this before it.
# The same table as `VERB_MARKERS` in src/core/gender.ts.
VERB_MARKERS: dict[str, str] = {"nb": "å"}


def marker_for(language: str, part_of_speech: str, entry: str) -> str | None:
    """The marker to say before a bare verb, or None: not a verb, a language with none, or an Entry that
    already starts with it."""
    word = VERB_MARKERS.get(LANGUAGE_CODES.get(language.strip().lower(), ""))
    if not word or part_of_speech.strip().lower() != "verb" or entry.strip().lower().startswith(f"{word} "):
        return None
    return word


def with_article(article: str, text: str) -> str:
    """l'amertume, but el blindaje."""
    return f"{article}{text}" if article[-1] in "'’" else f"{article} {text}"
