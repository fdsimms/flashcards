"""Builds data/<code>_common.txt: a language's 10,000 most common word families, most common first
(docs/read-and-listen/architecture.md, Languages).

Each of wordfreq's 50,000 most common forms is lemmatized with simplemma and its frequency added to
its lemma's, so a verb whose use is spread over many forms (sentamos, sentaron) still counts as
sentar. Ranking single forms instead missed llover, sentar and disculpar.

Japanese is grouped the same way by Sudachi's normalized form (japanese.lemma_key), which also
settles spelling variants (できる and 出来る), and each family is written as its most frequent
dictionary form. wordfreq's Japanese forms are MeCab's pieces (し, なっ, まし), so a verb's
conjugated stems count toward it too.

Thai is the exception: wordfreq has no Thai, so its list is ranked from PyThaiNLP's copy of the Thai
National Corpus word counts (build_thai), words as the corpus segments them. It only ranks words
for the reader's popup; Thai has no inflection to group and no common-words setting.

Run with the simplemma and Sudachi the server runs (pyproject.toml) and wordfreq 3.1.1, which is
outside the server's own dependencies:

    uv run --with wordfreq==3.1.1 python scripts/build_common.py de fr ru el pl nb ja th

Rebuild every list after upgrading simplemma, and Japanese's after upgrading Sudachi or its
dictionary, so the lemmas here match the ones they give at runtime.
"""

import re
import sys
from importlib.metadata import version
from pathlib import Path

import simplemma
import wordfreq

FORMS = 50_000
KEEP = 10_000
DATA = Path(__file__).parent.parent / "src" / "franki_reader" / "data"
NAMES = {
    "es": "Spanish",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "el": "Greek",
    "pl": "Polish",
    "nb": "Norwegian (Bokmål)",
    "ja": "Japanese",
    "th": "Thai",
}
_LATIN = re.compile(r"[A-Za-z]")
# A Thai word: letters, vowels and tone marks only (no digits, ๆ, or the corpus's Latin and noise),
# and no letter three times running (งงงงง).
_THAI_WORD = re.compile(r"[\u0e01-\u0e39\u0e40-\u0e4e]+")
_REPEATED = re.compile(r"(.)\1\1")


def build_japanese() -> list[str]:
    from franki_reader.japanese import morphemes

    frequency = wordfreq.get_frequency_dict("ja")  # top_n_list's order, without tokenizing
    totals: dict[str, float] = {}
    shown: dict[str, dict[str, float]] = {}  # family -> each dictionary form's frequency
    for form in wordfreq.top_n_list("ja", FORMS):
        if not any(ch.isalpha() for ch in form) or _LATIN.search(form):
            continue
        words = [m for m in morphemes(form) if m.is_word]
        if len(words) != 1 or words[0].pos2 == "数詞":
            continue
        family = words[0].normalized
        totals[family] = totals.get(family, 0.0) + frequency[form]
        forms = shown.setdefault(family, {})
        forms[words[0].dictionary] = forms.get(words[0].dictionary, 0.0) + frequency[form]
    ranked = sorted(totals, key=lambda w: -totals[w])[:KEEP]
    return [max(shown[family], key=lambda f: shown[family][f]) for family in ranked]


def build_thai() -> list[str]:
    from pythainlp.corpus import tnc

    counts = [
        (word, count)
        for word, count in tnc.word_freqs()
        if _THAI_WORD.fullmatch(word) and not _REPEATED.search(word)
    ]
    # Ties are common in the tail (122 is where the top 10,000 ends), so order them by word to
    # make a rebuild give the same file.
    counts.sort(key=lambda item: (-item[1], item[0]))
    return [word for word, _ in counts[:KEEP]]


def build(code: str) -> list[str]:
    if code == "ja":
        return build_japanese()
    if code == "th":
        return build_thai()
    totals: dict[str, float] = {}
    for form in wordfreq.top_n_list(code, FORMS):
        if not any(ch.isalpha() for ch in form):
            continue
        if code == "el":
            # wordfreq writes Greek's final sigma as σ (της as τησ); text and simplemma use ς.
            form = re.sub(r"σ\b", "ς", form)
        lemma = str(simplemma.lemmatize(form, lang=code)).lower()
        totals[lemma] = totals.get(lemma, 0.0) + wordfreq.word_frequency(form, code)
    return sorted(totals, key=lambda w: -totals[w])[:KEEP]


def header(code: str) -> str:
    if code == "th":
        return (
            f"# The {KEEP:,} most common Thai words, most common first, for showing how common a word"
            " is in the reader.\n"
            "# Built by scripts/build_common.py from the word counts of the Thai National Corpus as"
            " PyThaiNLP\n"
            f"# {version('pythainlp')} ships them (pythainlp.corpus.tnc.word_freqs()), words as the"
            " corpus segments them.\n"
            "# The corpus is mostly written Thai (news, books), so everyday spoken words rank lower"
            " than in speech.\n"
            "# Thai counts only its deck as known (architecture.md, Languages): nothing here makes"
            " a word known.\n"
        )
    wordfreq_version, simplemma_version = version("wordfreq"), version("simplemma")
    if code == "ja":
        sudachi = (
            f"SudachiPy {version('sudachipy')} (sudachidict-core {version('sudachidict-core')})"
        )
        return (
            f"# The {KEEP:,} most common Japanese word families, most common first, each as its"
            " most frequent\n"
            f"# dictionary form. Built by scripts/build_common.py from wordfreq {wordfreq_version}:"
            f" each of the {FORMS:,}\n"
            f'# most common forms (top_n_list("ja", {FORMS})) was read with {sudachi}\n'
            "# and its frequency added to its normalized form's. A word counts as known for"
            " coverage when its\n"
            "# normalized form is listed within the common-words setting (docs/read-and-listen/"
            "architecture.md,\n"
            "# Languages). Rebuild this if Sudachi or its dictionary is upgraded. wordfreq's data"
            " is CC BY-SA 4.0:\n"
            "# https://github.com/rspeer/wordfreq\n"
        )
    return (
        f"# The {KEEP:,} most common {NAMES[code]} word families, most common first. Built by\n"
        f"# scripts/build_common.py from wordfreq {wordfreq_version}: each of the {FORMS:,} most"
        f" common forms\n"
        f'# (top_n_list("{code}", {FORMS})) was lemmatized with simplemma {simplemma_version}'
        " and its frequency added to\n"
        "# its lemma's. A word counts as known for coverage when its lemma is listed within the\n"
        "# language's common-words setting (docs/read-and-listen/architecture.md, Languages).\n"
        "# Rebuild this if simplemma is upgraded, so the lemmas here match the ones it gives at\n"
        "# runtime. wordfreq's data is CC BY-SA 4.0: https://github.com/rspeer/wordfreq\n"
    )


if __name__ == "__main__":
    for code in sys.argv[1:]:
        words = build(code)
        (DATA / f"{code}_common.txt").write_text(header(code) + "\n".join(words) + "\n", "utf-8")
        print(code, len(words), words[:10])
