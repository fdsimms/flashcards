"""Builds data/<code>_common.txt: a language's 10,000 most common word families, most common first
(docs/read-and-listen/architecture.md, Languages).

Each of wordfreq's 50,000 most common forms is lemmatized with simplemma and its frequency added to
its lemma's, so a verb whose use is spread over many forms (sentamos, sentaron) still counts as
sentar. Ranking single forms instead missed llover, sentar and disculpar.

Japanese is grouped the same way by Sudachi's normalized form (japanese.lemma_key), which also
settles spelling variants (できる and 出来る), and each family is written as its most frequent
dictionary form. wordfreq's Japanese forms are MeCab's pieces (し, なっ, まし), so a verb's
conjugated stems count toward it too.

Run with the simplemma and Sudachi the server runs (pyproject.toml) and wordfreq 3.1.1, which is
outside the server's own dependencies:

    uv run --with wordfreq==3.1.1 python scripts/build_common.py de fr ru el pl nb ja

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
}
_LATIN = re.compile(r"[A-Za-z]")


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


def build(code: str) -> list[str]:
    if code == "ja":
        return build_japanese()
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
