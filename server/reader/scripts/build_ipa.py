"""Builds data/ipa/<code>.tsv.gz: each word of a language with the IPA Wiktionary gives it, for the
reader's word popup (franki_reader/ipa.py).

The source is kaikki.org's extract of English Wiktionary, one JSON line per entry, which carries
the pronunciation sections as `sounds`. Inflected forms are entries of their own in the
Russian, Polish and Thai extracts; in the others most forms have no IPA here, and the word is looked
up by its dictionary form instead (ipa.py).

Per word, the first entry that has IPA wins, and within it the first pronunciation that isn't
limited to a region or dialect (`tags`), else the first. Only single words are kept, since the
reader taps words. Wiktionary's own marks stay: /phonemic/ and [phonetic] brackets, stress and
syllable dots. A word with no IPA is left out.

The data is Wiktionary's, under CC BY-SA 4.0 (ipa.ATTRIBUTION says so in the app).

Japanese has no table: its words are read as kana by Sudachi, which ipa.py turns into IPA by rule.

Run from server/reader (it downloads each language's extract, 50 MB to 1 GB, into --cache, and
keeps it there):

    uv run python scripts/build_ipa.py --cache /tmp/kaikki ru pl de es fr el nb th en

Rebuild when the extracts have moved on a lot; a build is the only thing that changes the tables.
"""

import argparse
import gzip
import json
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "src" / "franki_reader" / "data" / "ipa"

# The language's name in kaikki's URLs.
NAMES = {
    "ru": "Russian",
    "pl": "Polish",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "el": "Greek",
    "nb": "Norwegian Bokmål",
    "th": "Thai",
    "en": "English",
}


def download(code: str, cache: Path) -> Path:
    name = NAMES[code]
    path = cache / f"{code}.jsonl"
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        slug = urllib.parse.quote(name)
        url = f"https://kaikki.org/dictionary/{slug}/kaikki.org-dictionary-{name.replace(' ', '')}.jsonl"
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, path.with_suffix(".part"))
        path.with_suffix(".part").rename(path)
    return path


def pick(sounds: list[dict[str, object]]) -> str | None:
    """The pronunciation to keep from an entry's `sounds`: the first with no region or dialect tag, else the first."""
    ipas = [s for s in sounds if isinstance(s.get("ipa"), str) and s["ipa"].strip()]
    if not ipas:
        return None
    plain = [s for s in ipas if not s.get("tags")]
    return str((plain or ipas)[0]["ipa"]).strip()


def build(code: str, source: Path) -> dict[str, str]:
    table: dict[str, str] = {}
    for line in source.open(encoding="utf-8"):
        entry = json.loads(line)
        word = unicodedata.normalize("NFC", entry["word"]).strip()
        if not word or " " in word or word in table:
            continue
        ipa = pick(entry.get("sounds", []))
        if ipa and "\t" not in ipa and "\n" not in ipa:
            table[word] = ipa
    return table


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True, help="where the extracts are kept")
    parser.add_argument("languages", nargs="+", choices=sorted(NAMES))
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    for code in args.languages:
        table = build(code, download(code, args.cache))
        out = DATA / f"{code}.tsv.gz"
        with gzip.GzipFile(out, "wb", mtime=0) as f:  # mtime 0: the same table is the same bytes
            for word in sorted(table):
                f.write(f"{word}\t{table[word]}\n".encode())
        print(f"{code}: {len(table)} words, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
