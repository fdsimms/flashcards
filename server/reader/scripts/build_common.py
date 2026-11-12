"""Builds data/<code>_common.txt: a language's 10,000 most common word families, most common first
(docs/read-and-listen/architecture.md, Languages).

Each of wordfreq's 50,000 most common forms is lemmatized with simplemma and its frequency added to
its lemma's, so a verb whose use is spread over many forms (sentamos, sentaron) still counts as
sentar. Ranking single forms instead missed llover, sentar and disculpar.

Run with the simplemma the server runs (pyproject.toml) and wordfreq 3.1.1, both outside the
server's own dependencies:

    uv run --with wordfreq==3.1.1 python scripts/build_common.py de fr ru el pl nb

Rebuild every list after upgrading simplemma, so the lemmas here match the ones it gives at runtime.
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
}


def build(code: str) -> list[str]:
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
