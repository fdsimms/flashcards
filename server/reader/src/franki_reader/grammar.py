"""Grammar points the owner can practice or avoid (docs/read-and-listen/architecture.md, Grammar). A practiced point
is asked for 2 or 3 times in each text; an avoided one is asked to be left out. Like coverage, the
server checks the draft rather than trusting the model, and a miss goes back for revision.

The points themselves (id, language, name, note, and the Forms groups the app links them to) are
in grammar_points.json, which the app bundles too (docs/grammar.md). Each point has a finder here:
given a line's words, it returns the spans that use the point.

- Thai points are words (เคย, กำลัง, ที่สุด), matched on the checker's segmentation. The segmenter
  sometimes joins one onto the next word (กำลังกิน), so a word starting with the point counts too,
  except listed look-alikes: ต้องการ (want) isn't ต้อง (must).
- Spanish points are verb forms, found from their endings with simplemma confirming the word is
  a form of a verb, plus lists of irregular forms. This is close but not perfect: forms shared
  with another tense aren't counted (hablamos is "we speak" and "we spoke", so it counts as
  neither), and a rare irregular form can be missed.
- German, French, Russian, Greek, Polish and Norwegian are found the same way, in
  grammar_europe.py.
- Japanese points are found from Sudachi's morphemes (the auxiliary ます, the volitional form), in
  grammar_japanese.py.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast, get_args

from franki_reader import grammar_europe, grammar_japanese
from franki_reader.coverage import Checker, is_word, parse_line
from franki_reader.languages import Code

Span = tuple[int, int]  # word indices, end exclusive
Finder = Callable[[list[str]], list[Span]]

PRACTICE_USES = 2  # a practiced point appears at least this many times
MAX_PRACTICE = 2  # points practiced at once, so texts stay natural
UNSET_USES = 2  # uses of points the owner hasn't marked, in all, before a draft goes back


@dataclass(frozen=True)
class Point:
    id: str
    language: Code
    name: str
    note: str  # what it means, with examples
    find: Finder
    related: tuple[str, ...] = ()  # points to compare it with, from the catalog (drills.py)
    # Read as Know it until the owner chooses (the catalog's `known`): grammar in nearly every line,
    # like Japanese's ます and past, which the cap on points not set would keep out of texts.
    known: bool = False


def words(plain: str, lexicon: Checker) -> list[str]:
    """A parsed line's words, in order, as the finders see them: Thai as segmented; a spaced
    language as the checker splits it (French l'homme as l', homme), lowercased, with a deck
    phrase's words separate here."""
    tokens = [t for t in lexicon.segment(plain) if is_word(t)]
    if lexicon.spaced:
        return [w.lower() for t in tokens for w in t.split()]
    return tokens


def count_words(token: str, spaced: bool) -> int:
    """How many of `words`' words a rendered token covers: a deck phrase covers several."""
    return len(token.split()) if spaced else 1


def find_in_lines(
    lines: list[str], lexicon: Checker, point_ids: tuple[str, ...]
) -> dict[str, list[str]]:
    """For each point, what it matched across the lines (model lines with `|` and asterisks), as
    the words of each match joined: {"es.pluperfect": ["había comido", "habían visto"]}."""
    found: dict[str, list[str]] = {pid: [] for pid in point_ids}
    for line in lines:
        plain, _ = parse_line(line, lexicon.spaced)
        ws = words(plain, lexicon)
        joiner = " " if lexicon.spaced else ""
        for pid in point_ids:
            found[pid] += [joiner.join(ws[a:b]) for a, b in POINTS[pid].find(ws)]
    return found


def points_in(line: str, lexicon: Checker, language: Code) -> list[Point]:
    """The language's points a model line (`|` and asterisks) uses, in the catalog's order, for
    Explain's "Grammar in this line" (docs/grammar.md, step 3)."""
    found = find_in_lines([line], lexicon, tuple(p.id for p in points_for(language)))
    return [POINTS[pid] for pid, matches in found.items() if matches]


def marks(plain: str, lexicon: Checker, point_ids: tuple[str, ...]) -> dict[int, str]:
    """Which words of a line (by index in `words`) belong to which point, for the reader."""
    out: dict[int, str] = {}
    ws = words(plain, lexicon)
    for pid in point_ids:
        if pid not in POINTS:
            continue  # a point a text was written with that has since been removed
        for a, b in POINTS[pid].find(ws):
            for i in range(a, b):
                out.setdefault(i, pid)
    return out


# ==== Thai ====


def _thai(marker: str, *not_these: str) -> Finder:
    def find(ws: list[str]) -> list[Span]:
        return [
            (i, i + 1)
            for i, w in enumerate(ws)
            if w == marker or (w.startswith(marker) and not w.startswith(not_these or ("\0",)))
        ]

    return find


def _thai_any(*markers: str) -> Finder:
    finders = [_thai(m) for m in markers]
    return lambda ws: sorted({span for f in finders for span in f(ws)})


# ==== Spanish ====


def _lemma(word: str) -> str:
    from franki_reader.spaced import lemma  # loads simplemma, so only when Spanish is checked

    return lemma(word, "es")


def _verb_lemma(word: str) -> str | None:
    """The infinitive this word is a conjugated form of, or None."""
    lem = _lemma(word)
    return lem if lem != word and lem.endswith(("ar", "er", "ir")) else None


def _each(test: Callable[[list[str], int], bool]) -> Finder:
    return lambda ws: [(i, i + 1) for i in range(len(ws)) if test(ws, i)]


_PARTICIPLE_IRREGULAR = frozenset(
    [
        "escrito",
        "visto",
        "hecho",
        "dicho",
        "puesto",
        "vuelto",
        "roto",
        "abierto",
        "muerto",
        "cubierto",
        "descubierto",
        "devuelto",
        "resuelto",
        "impreso",
        "satisfecho",
        "deshecho",
        "frito",
    ]
)


def _participle(word: str) -> bool:
    return word.endswith(("ado", "ido", "ído")) or word in _PARTICIPLE_IRREGULAR


def _after_aux(aux: frozenset[str]) -> Finder:
    def find(ws: list[str]) -> list[Span]:
        return [(i, i + 2) for i in range(len(ws) - 1) if ws[i] in aux and _participle(ws[i + 1])]

    return find


_HABER_PRESENT = frozenset({"he", "has", "ha", "hemos", "habéis", "han"})
_HABER_IMPERFECT = frozenset({"había", "habías", "habíamos", "habíais", "habían"})

_GERUND = re.compile(r"(ando|iendo|yendo|ándo\w+|iéndo\w+|yéndo\w+)$")


def _progressive(ws: list[str]) -> list[Span]:
    return [
        (i, i + 2)
        for i in range(len(ws) - 1)
        if _GERUND.search(ws[i + 1]) and _lemma(ws[i]) == "estar"
    ]


# Future and conditional are built on the infinitive (hablar-é) or one of these stems.
_IRREGULAR_STEMS = frozenset(
    [
        "tendr",
        "pondr",
        "saldr",
        "vendr",
        "valdr",
        "podr",
        "querr",
        "sabr",
        "cabr",
        "habr",
        "har",
        "dir",
        "ir",
    ]
)
_FUTURE_ENDINGS = ("emos", "éis", "ás", "án", "é", "á")
_CONDITIONAL_ENDINGS = ("íamos", "íais", "ías", "ían", "ía")


def _built_on_stem(word: str, endings: tuple[str, ...]) -> bool:
    for ending in endings:
        if word.endswith(ending):
            stem = word[: -len(ending)]
            return stem in _IRREGULAR_STEMS or (len(stem) > 2 and stem == _lemma(word))
    return False


def _future(ws: list[str], i: int) -> bool:
    return _built_on_stem(ws[i], _FUTURE_ENDINGS)


def _conditional(ws: list[str], i: int) -> bool:
    return _built_on_stem(ws[i], _CONDITIONAL_ENDINGS)


def _in_pluperfect(ws: list[str], i: int) -> bool:
    return ws[i] in _HABER_IMPERFECT and i + 1 < len(ws) and _participle(ws[i + 1])


_IMPERFECT_IRREGULAR = frozenset(
    [
        "era",
        "eras",
        "éramos",
        "erais",
        "eran",
        "iba",
        "ibas",
        "íbamos",
        "ibais",
        "iban",
        "veía",
        "veías",
        "veíamos",
        "veían",
    ]
)


def _imperfect(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _IMPERFECT_IRREGULAR:
        return True
    if _in_pluperfect(ws, i) or _conditional(ws, i):
        return False
    lem = _verb_lemma(w)
    if lem is None:
        return False
    if lem.endswith("ar"):
        return w.endswith(("ábamos", "abais", "abas", "aban", "aba"))
    return w.endswith(_CONDITIONAL_ENDINGS)


_PRETERITE_IRREGULAR = frozenset(
    [
        "fui",
        "fuiste",
        "fue",
        "fuimos",
        "fuisteis",
        "fueron",
        "di",
        "diste",
        "dio",
        "dimos",
        "disteis",
        "dieron",
        "vi",
        "viste",
        "vio",
        "vimos",
        "vieron",
        "hubo",
        "dijeron",
        "trajeron",
        "condujeron",
        "produjeron",
    ]
)
# Strong preterites: tuv-e, hic-imos, quis-ieron. Not vin-o, which is also "wine".
_PRETERITE_STRONG = re.compile(
    r"^(tuv|estuv|anduv|pud|pus|quis|sup|vin|hic|hiz|dij|traj|conduj|produj|hub)"
    r"(e|o|imos|isteis|iste|ieron|eron)$"
)
_PRETERITE_ENDINGS = ("asteis", "aste", "aron", "isteis", "iste", "ieron", "ió", "ó", "é", "í")
_NOT_PRETERITE = frozenset({"esté", "dé", "sé", "vino"})


def _preterite(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _NOT_PRETERITE:
        return False
    if w in _PRETERITE_IRREGULAR or _PRETERITE_STRONG.match(w):
        return True
    if _future(ws, i):
        return False
    return w.endswith(_PRETERITE_ENDINGS) and _verb_lemma(w) is not None


_SUBJUNCTIVE_IRREGULAR = frozenset(
    [
        "sea",
        "seas",
        "seamos",
        "sean",
        "vaya",
        "vayas",
        "vayamos",
        "vayan",
        "haya",
        "hayas",
        "hayamos",
        "hayan",
        "esté",
        "estés",
        "estemos",
        "estén",
        "dé",
        "des",
        "demos",
        "den",
        "sepa",
        "sepas",
        "sepamos",
        "sepan",
        "quepa",
        "quepas",
        "quepan",
    ]
)
# Indicative forms with subjunctive-looking endings: ir and haber.
_NOT_SUBJUNCTIVE = frozenset({"va", "vas", "van", "vamos", "ha", "has", "han"})
_IMPERFECT_SUBJUNCTIVE = re.compile(
    r"(áramos|arais|aras|aran|ara|ásemos|aseis|ases|asen|ase|"
    r"iéramos|ierais|ieras|ieran|iera|iésemos|ieseis|ieses|iesen|iese)$"
)
_IMPERFECT_SUBJUNCTIVE_IRREGULAR = re.compile(
    r"^(fu|dij|traj|conduj|produj)(eras|éramos|erais|eran|era|ese|eses|ésemos|esen)$"
)
# "fuera" alone is usually "outside"; "para" is a preposition.
_NOT_IMPERFECT_SUBJUNCTIVE = frozenset({"fuera", "para"})


def _imperfect_subjunctive(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _NOT_IMPERFECT_SUBJUNCTIVE:
        return False
    if _IMPERFECT_SUBJUNCTIVE_IRREGULAR.match(w):
        return True
    return bool(_IMPERFECT_SUBJUNCTIVE.search(w)) and _verb_lemma(w) is not None


def _present_subjunctive(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _SUBJUNCTIVE_IRREGULAR:
        return True
    if w in _NOT_SUBJUNCTIVE or w in _NOT_IMPERFECT_SUBJUNCTIVE or w in _HABER_IMPERFECT:
        return False
    if w.endswith(("ida", "idas", "ada", "adas") + _CONDITIONAL_ENDINGS):
        return False
    if _imperfect(ws, i) or _conditional(ws, i) or _imperfect_subjunctive(ws, i):
        return False
    lem = _verb_lemma(w)
    if lem is None:
        return False
    # The vowel swaps: -ar verbs take e (hable), -er and -ir verbs take a (coma, viva).
    if lem.endswith("ar"):
        return w.endswith(("emos", "éis", "es", "en", "e"))
    return w.endswith(("amos", "áis", "as", "an", "a"))


# ==== The points ====

# Each point's finder, by id. Its name, note and the rest are in grammar_points.json.

_FINDERS: dict[str, Finder] = {
    "es.preterite": _each(_preterite),
    "es.imperfect": _each(_imperfect),
    "es.present_perfect": _after_aux(_HABER_PRESENT),
    "es.pluperfect": _after_aux(_HABER_IMPERFECT),
    "es.future": _each(_future),
    "es.conditional": _each(_conditional),
    "es.progressive": _progressive,
    "es.present_subjunctive": _each(_present_subjunctive),
    "es.imperfect_subjunctive": _each(_imperfect_subjunctive),
    "th.ever": _thai("เคย"),
    "th.ongoing": _thai("กำลัง"),
    "th.future": _thai("จะ"),
    "th.already": _thai("แล้ว"),
    "th.must": _thai("ต้อง", "ต้องการ"),
    "th.comparison": _thai("กว่า"),
    "th.superlative": _thai("ที่สุด"),
    "th.if": _thai("ถ้า"),
    "th.because": _thai("เพราะ"),
    "th.yes_no": _thai_any("ไหม", "มั้ย", "หรือเปล่า"),
}

# German, French, Russian, Greek, Polish and Norwegian (grammar_europe.py).
_FINDERS.update(grammar_europe.FINDERS)
_FINDERS.update(grammar_japanese.FINDERS)

CATALOG = Path(__file__).with_name("grammar_points.json")


def _load(catalog: Path, finders: dict[str, Finder]) -> tuple[Point, ...]:
    """The catalog's points, in its order, each with its finder. A point without a finder, a finder
    without a point, or a language Read & Listen doesn't have stops the server at startup rather
    than leaving a point that can be chosen and then never found."""
    entries = json.loads(catalog.read_text(encoding="utf-8"))["points"]
    ids = [e["id"] for e in entries]
    problems = [f"{pid} is listed twice" for pid in sorted({i for i in ids if ids.count(i) > 1})]
    problems += [f"{pid} has no finder" for pid in ids if pid not in finders]
    problems += [
        f"{pid} has a finder but isn't in the catalog" for pid in finders if pid not in ids
    ]
    problems += [
        f"{e['id']} is in {e['language']}, which isn't a language here"
        for e in entries
        if e["language"] not in get_args(Code)
    ]
    if problems:
        raise ValueError(f"{catalog.name}: " + "; ".join(problems))
    return tuple(
        Point(
            e["id"],
            cast(Code, e["language"]),
            e["name"],
            e["note"],
            finders[e["id"]],
            tuple(e.get("related", ())),
            bool(e.get("known", False)),
        )
        for e in entries
    )


_ALL = _load(CATALOG, _FINDERS)

POINTS: dict[str, Point] = {p.id: p for p in _ALL}


def points_for(language: Code) -> list[Point]:
    return [p for p in _ALL if p.language == language]
