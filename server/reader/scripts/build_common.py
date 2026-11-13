"""Builds data/<code>_common.txt: a language's 10,000 most common word families, most common first
(docs/read-and-listen/architecture.md, Languages).

Each of wordfreq's 50,000 most common forms is lemmatized with simplemma and its frequency added to
its lemma's, so a verb whose use is spread over many forms (sentamos, sentaron) still counts as
sentar. Ranking single forms instead missed llover, sentar and disculpar.

Japanese is grouped the same way by Sudachi's normalized form (japanese.lemma_key), which also
settles spelling variants (できる and 出来る), and each family is written as its most frequent
dictionary form. wordfreq's Japanese forms are MeCab's pieces (し, なっ, まし), so a verb's
conjugated stems count toward it too.

Thai is the exception: wordfreq has no Thai, so its list blends two sources (build_thai): PyThaiNLP's
copy of the Thai National Corpus word counts, which is mostly written Thai, and OpenSubtitles' Thai
subtitles (OPUS, downloaded the first time and kept in the temp folder), which are speech. Each word
ranks by the average of its frequency in the two, so casual words (ป่ะ, ชิล) land where they're said
and a word only the news uses doesn't outrank them. The subtitles are cut into words with the
corpus's own words as the dictionary, so a casual word it lists isn't split. It only ranks words for
the reader's popup; Thai has no inflection to group and no common-words setting.

Run with the simplemma and Sudachi the server runs (pyproject.toml) and wordfreq 3.1.1, which is
outside the server's own dependencies:

    uv run --with wordfreq==3.1.1 python scripts/build_common.py en de fr ru el pl nb ja th

Rebuild every list after upgrading simplemma, and Japanese's after upgrading Sudachi or its
dictionary, so the lemmas here match the ones they give at runtime.
"""

import gzip
import re
import sys
import tempfile
import urllib.request
from collections import Counter
from importlib.metadata import version
from multiprocessing import Pool
from pathlib import Path

import simplemma
import wordfreq
from pythainlp.util import Trie

FORMS = 50_000
KEEP = 10_000
DATA = Path(__file__).parent.parent / "src" / "franki_reader" / "data"
NAMES = {
    "en": "English",
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
# A Thai word: at least two letters, vowels and tone marks (no digits, ๆ, or the corpus's Latin and
# noise), and no letter three times running (งงงงง).
_THAI_WORD = re.compile(r"[\u0e01-\u0e39\u0e40-\u0e45\u0e47-\u0e4e]{2,}")
_REPEATED = re.compile(r"(.)\1\1")
# A leading vowel and one letter (เธ), what an OCR or a split leaves of a word.
_BROKEN = re.compile(r"[\u0e40-\u0e44].")


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


SUBTITLES_URL = "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/mono/th.txt.gz"
SUBTITLE_STRIDE = (
    3  # every third line: about 3 million, enough to rank 10,000 words, in a minute or two
)
_segmenter: Trie | None = None


def _thai_word(word: str) -> bool:
    return (
        bool(_THAI_WORD.fullmatch(word))
        and not _REPEATED.search(word)
        and not _BROKEN.fullmatch(word)
    )


def _init_segmenter(words: frozenset[str]) -> None:
    from pythainlp.corpus import thai_words

    global _segmenter
    _segmenter = Trie(set(thai_words()) | words)


def _count_lines(lines: list[str]) -> Counter[str]:
    from pythainlp.tokenize import word_tokenize

    counts: Counter[str] = Counter()
    for line in lines:
        counts.update(
            w
            for w in word_tokenize(
                line, custom_dict=_segmenter, engine="newmm", keep_whitespace=False
            )
            if _thai_word(w)
        )
    return counts


def subtitle_counts(known: frozenset[str]) -> Counter[str]:
    """Word counts of every SUBTITLE_STRIDE-th line of OpenSubtitles' Thai, cut into words with
    `known` (the corpus's words) added to PyThaiNLP's dictionary."""
    path = Path(tempfile.gettempdir()) / "opensubtitles-th.txt.gz"
    if not path.exists():
        print(f"downloading {SUBTITLES_URL}", file=sys.stderr)
        urllib.request.urlretrieve(SUBTITLES_URL, path)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        lines = [line for i, line in enumerate(f) if i % SUBTITLE_STRIDE == 0]
    chunks = [lines[i : i + 20_000] for i in range(0, len(lines), 20_000)]
    total: Counter[str] = Counter()
    with Pool(initializer=_init_segmenter, initargs=(known,)) as pool:
        for part in pool.imap_unordered(_count_lines, chunks):
            total.update(part)
    return total


def build_thai() -> list[str]:
    from pythainlp.corpus import thai_words, tnc

    written = Counter({w: c for w, c in tnc.word_freqs() if _thai_word(w)})
    known = frozenset(w for w, c in written.items() if c >= 5)
    # Only words the segmenter knew: the subtitles' leftovers (ยนะ, มไม่) are pieces of words it
    # didn't recognize, and the corpus has a long tail of one-off typos.
    dictionary = known | {w for w in thai_words() if _thai_word(w)}
    spoken = Counter({w: c for w, c in subtitle_counts(known).items() if w in dictionary})
    written = Counter({w: c for w, c in written.items() if w in dictionary})
    written_total, spoken_total = sum(written.values()), sum(spoken.values())
    score = {
        word: written[word] / written_total + spoken[word] / spoken_total
        for word in written.keys() | spoken.keys()
    }
    # Ties are common in the tail, so order them by word to make a rebuild give the same file.
    return sorted(score, key=lambda w: (-score[w], w))[:KEEP]


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
            "# Built by scripts/build_common.py from two sources, each word ranked by the average of"
            " its frequency in them:\n"
            "# the word counts of the Thai National Corpus as PyThaiNLP"
            f" {version('pythainlp')} ships them (written Thai: news, books),\n"
            "# and every third line of OpenSubtitles' Thai subtitles (speech), cut into words with"
            " the corpus's words as\n"
            "# the dictionary. Thai counts only its deck as known (architecture.md, Languages):"
            " nothing here makes a word known.\n"
            "# OpenSubtitles via OPUS: https://opus.nlpl.eu/OpenSubtitles.php\n"
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
