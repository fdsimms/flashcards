"""Case and aspect in Russian and Polish (docs/grammar.md, "Case and aspect"), found with a
morphological analyzer rather than from endings: pymorphy3 for Russian, Morfeusz for Polish. Added
on 28 November 2026 at the owner's request, so Sentences can name these points too.

An analyzer lists every reading a word can have, out of context. A word is claimed only when every
reading agrees, so a false "you used the genitive" can't happen from the analysis alone:

- Case: every reading is a noun, adjective, pronoun, numeral or participle, and all are in the same
  case (книгу is accusative; собакой instrumental), or a preposition just before it allows only one
  of them (о сестре: prepositional, not dative; w szkole: locative). книги (genitive or nominative
  plural), mam (mama's genitive plural, or "I have") and an indeclinable кофе are left alone. The
  nominative and vocative aren't points.
- Aspect: every reading is a form of a verb, of one aspect, and not of быть / być (an auxiliary
  more than a choice). Imperfective counts only where the speaker chose it: a present tense (and a
  present participle or adverbial participle) is imperfective in every verb, so it isn't marked.
  A two-aspect verb (использовать) has readings of both and is left alone.

Each analyzer is loaded the first time a line in its language is checked (about 27 MB for Russian,
47 MB for Polish), so a server that never checks one doesn't pay for it. Morfeusz has no ARM Linux
build: where it isn't installed, Polish case and aspect find nothing, rather than stop the server.

`FINDERS` is each point's finder by id, joined to the catalog by grammar.py, as grammar_europe.py's.
"""

from collections.abc import Callable
from functools import cache
from typing import Any

Span = tuple[int, int]
Finder = Callable[[list[str]], list[Span]]


def _each(test: Callable[[str], bool]) -> Finder:
    return lambda ws: [(i, i + 1) for i, w in enumerate(ws) if test(w)]


# ==== Russian ====


@cache
def _ru_analyzer() -> Any:
    import pymorphy3  # type: ignore[import-untyped]  # loaded on the first Russian line

    return pymorphy3.MorphAnalyzer()


_RU_NOMINAL = frozenset({"NOUN", "ADJF", "NPRO", "NUMR", "PRTF"})
_RU_VERBAL = frozenset({"VERB", "INFN", "PRTF", "PRTS", "GRND"})
# pymorphy's second genitive (чаю), second locative (в лесу) and second accusative count as theirs.
_RU_CASES = {
    "nomn": "nominative",
    "voct": "vocative",
    "gent": "genitive",
    "gen1": "genitive",
    "gen2": "genitive",
    "datv": "dative",
    "accs": "accusative",
    "acc2": "accusative",
    "ablt": "instrumental",
    "loct": "prepositional",
    "loc1": "prepositional",
    "loc2": "prepositional",
}


@cache
def ru_cases(word: str) -> frozenset[str] | None:
    """Every case the word's readings are in, or None when a reading isn't a declined word."""
    cases = set()
    for p in _ru_analyzer().parse(word):
        if not p.is_known or p.tag.POS not in _RU_NOMINAL or "Fixd" in p.tag:
            return None
        case = _RU_CASES.get(str(p.tag.case))
        if case is None:
            return None
        cases.add(case)
    return frozenset(cases) or None


@cache
def ru_modifier(word: str) -> bool:
    """An adjective or participle in every reading (моём, большом), which can stand between a
    preposition and its noun."""
    parses = _ru_analyzer().parse(word)
    return bool(parses) and all(p.is_known and p.tag.POS in ("ADJF", "PRTF") for p in parses)


@cache
def ru_aspect(word: str) -> str | None:
    """ "perfective" or "imperfective" when every reading is a verb form of that aspect, the
    imperfective only outside the present tense; else None."""
    parses = _ru_analyzer().parse(word)
    aspects = set()
    for p in parses:
        if not p.is_known or p.tag.POS not in _RU_VERBAL or p.normal_form == "быть":
            return None
        if p.tag.aspect not in ("perf", "impf"):
            return None
        if p.tag.aspect == "impf" and p.tag.tense == "pres":
            return None
        aspects.add("perfective" if p.tag.aspect == "perf" else "imperfective")
    return aspects.pop() if len(aspects) == 1 else None


# ==== Polish ====


@cache
def _pl_analyzer() -> Any:
    try:
        import morfeusz2  # type: ignore[import-not-found,import-untyped,unused-ignore]  # not on ARM Linux
    except ImportError:
        return None
    return morfeusz2.Morfeusz()


_PL_NOMINAL = frozenset(
    {"subst", "depr", "adj", "ppron12", "ppron3", "siebie", "num", "numcol", "pact", "ppas"}
)
_PL_CASES = {
    "nom": "nominative",
    "voc": "vocative",
    "gen": "genitive",
    "dat": "dative",
    "acc": "accusative",
    "inst": "instrumental",
    "loc": "locative",
}
# Verb forms that carry an aspect. Not ger (czytanie, a noun) or the aglt of przeczytał-em.
_PL_VERBAL = frozenset(
    {"fin", "bedzie", "praet", "impt", "imps", "inf", "pcon", "pant", "pact", "ppas", "winien"}
)
# Imperfective in every verb that has them: the present (fin of an imperfective verb), its
# participle and its adverbial participle.
_PL_PRESENT = frozenset({"fin", "pact", "pcon"})
# Pieces Morfeusz splits off a word that say nothing about its case or aspect: the person ending
# of przeczytał-em and the by of zrobił-by-m.
_PL_CLITICS = frozenset({"aglt"})


def _pl_readings(word: str) -> list[tuple[str, list[str]]] | None:
    """Each reading of the word as (lemma, tag fields), the clitics left out; None when Morfeusz
    isn't installed or doesn't know the word."""
    analyzer = _pl_analyzer()
    if analyzer is None:
        return None
    out: list[tuple[str, list[str]]] = []
    for start, _end, (_orth, lemma, tag, *_rest) in analyzer.analyse(word):
        fields = str(tag).split(":")
        if fields[0] == "ign":
            return None
        if fields[0] in _PL_CLITICS or (start > 0 and str(lemma).split(":")[0] == "by"):
            continue
        out.append((str(lemma).split(":")[0], fields))
    return out or None


@cache
def pl_cases(word: str) -> frozenset[str] | None:
    """Every case the word's readings are in, or None when a reading isn't a declined word."""
    readings = _pl_readings(word)
    if readings is None:
        return None
    cases: set[str] = set()
    for _lemma, fields in readings:
        if fields[0] not in _PL_NOMINAL:
            return None
        found = [c for f in fields[1:] for c in f.split(".") if c in _PL_CASES]
        if not found:
            return None
        cases.update(_PL_CASES[c] for c in found)
    return frozenset(cases) or None


@cache
def pl_modifier(word: str) -> bool:
    """An adjective or participle in every reading (moim, dużym), which can stand between a
    preposition and its noun."""
    readings = _pl_readings(word)
    return readings is not None and all(f[0] in ("adj", "pact", "ppas") for _l, f in readings)


@cache
def pl_aspect(word: str) -> str | None:
    """ "perfective" or "imperfective" when every reading is a verb form of that aspect, the
    imperfective only outside the present tense; else None."""
    readings = _pl_readings(word)
    if readings is None:
        return None
    aspects = set()
    for lemma, fields in readings:
        if fields[0] not in _PL_VERBAL or lemma == "być":
            return None
        found = {a for f in fields[1:] for a in f.split(".") if a in ("perf", "imperf")}
        if len(found) != 1:
            return None
        if found == {"imperf"} and fields[0] in _PL_PRESENT:
            return None
        aspects.add("perfective" if found == {"perf"} else "imperfective")
    return aspects.pop() if len(aspects) == 1 else None


# ==== The points ====

_GEN, _DAT, _ACC, _INS, _LOC = "genitive", "dative", "accusative", "instrumental", "locative"
_PREP = "prepositional"

# The cases each preposition can take, so a word after one that could be several (сестре, dative
# or prepositional; szkole, dative or locative) is read as the one the preposition allows.
_RU_AFTER: dict[str, frozenset[str]] = {
    **dict.fromkeys(("о", "об", "обо", "в", "во", "на"), frozenset({_ACC, _PREP})),
    "при": frozenset({_PREP}),
    **dict.fromkeys(("к", "ко"), frozenset({_DAT})),
    "по": frozenset({_DAT, _ACC, _PREP}),
    **dict.fromkeys(
        ("у", "без", "для", "из", "изо", "от", "ото", "до", "около", "после", "кроме"),
        frozenset({_GEN}),
    ),
    **dict.fromkeys(("с", "со"), frozenset({_GEN, _INS, _ACC})),
    **dict.fromkeys(("за", "под", "подо"), frozenset({_ACC, _INS})),
    **dict.fromkeys(("над", "надо", "перед", "передо"), frozenset({_INS})),
    "между": frozenset({_INS, _GEN}),
    **dict.fromkeys(("через", "про", "сквозь"), frozenset({_ACC})),
}
_PL_AFTER: dict[str, frozenset[str]] = {
    **dict.fromkeys(("o", "w", "we", "na"), frozenset({_ACC, _LOC})),
    "przy": frozenset({_LOC}),
    "po": frozenset({_LOC, _ACC, _DAT}),
    **dict.fromkeys(
        ("do", "od", "ode", "bez", "beze", "dla", "u", "obok", "koło", "podczas", "zamiast"),
        frozenset({_GEN}),
    ),
    **dict.fromkeys(("z", "ze"), frozenset({_GEN, _INS, _ACC})),
    **dict.fromkeys(("ku", "dzięki", "przeciw", "przeciwko"), frozenset({_DAT})),
    "za": frozenset({_ACC, _INS, _GEN}),
    **dict.fromkeys(
        ("pod", "nad", "przed", "między", "pode", "nade", "przede"), frozenset({_ACC, _INS})
    ),
    **dict.fromkeys(("przez", "przeze"), frozenset({_ACC})),
}


def _case_of(
    ws: list[str],
    i: int,
    cases_of: Callable[[str], frozenset[str] | None],
    modifier: Callable[[str], bool],
    after: dict[str, frozenset[str]],
) -> str | None:
    """The word's case: the one its readings share, or, after a preposition (right before it, or
    before one adjective, as in в моём доме), the one of them the preposition allows. A line's
    punctuation is gone by now, so only an adjective may come between: a noun there may end a
    sentence (в парке. Дом...)."""
    cases = cases_of(ws[i])
    if cases is None:
        return None
    if i >= 1 and ws[i - 1] in after:
        cases = cases & after[ws[i - 1]]
    elif i >= 2 and ws[i - 2] in after and modifier(ws[i - 1]):
        cases = cases & after[ws[i - 2]]
    return next(iter(cases)) if len(cases) == 1 else None


def _case(
    cases_of: Callable[[str], frozenset[str] | None],
    modifier: Callable[[str], bool],
    after: dict[str, frozenset[str]],
    case: str,
) -> Finder:
    return lambda ws: [
        (i, i + 1) for i in range(len(ws)) if _case_of(ws, i, cases_of, modifier, after) == case
    ]


def _aspect(of: Callable[[str], str | None], aspect: str) -> Finder:
    return _each(lambda w: of(w) == aspect)


FINDERS: dict[str, Finder] = {
    "ru.genitive": _case(ru_cases, ru_modifier, _RU_AFTER, _GEN),
    "ru.dative": _case(ru_cases, ru_modifier, _RU_AFTER, _DAT),
    "ru.accusative": _case(ru_cases, ru_modifier, _RU_AFTER, _ACC),
    "ru.instrumental": _case(ru_cases, ru_modifier, _RU_AFTER, _INS),
    "ru.prepositional": _case(ru_cases, ru_modifier, _RU_AFTER, _PREP),
    "ru.perfective": _aspect(ru_aspect, "perfective"),
    "ru.imperfective": _aspect(ru_aspect, "imperfective"),
    "pl.genitive": _case(pl_cases, pl_modifier, _PL_AFTER, _GEN),
    "pl.dative": _case(pl_cases, pl_modifier, _PL_AFTER, _DAT),
    "pl.accusative": _case(pl_cases, pl_modifier, _PL_AFTER, _ACC),
    "pl.instrumental": _case(pl_cases, pl_modifier, _PL_AFTER, _INS),
    "pl.locative": _case(pl_cases, pl_modifier, _PL_AFTER, _LOC),
    "pl.perfective": _aspect(pl_aspect, "perfective"),
    "pl.imperfective": _aspect(pl_aspect, "imperfective"),
}
