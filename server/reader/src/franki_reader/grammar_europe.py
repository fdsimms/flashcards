"""Grammar points for German, French, Russian, Greek, Polish and Norwegian
(docs/read-and-listen/architecture.md, Grammar). Added on 12 November 2026, with the languages.

Each finder takes a line's words, lowercased (grammar.words), and returns the spans that use the
point, as Spanish's do: auxiliaries and particles are matched as words, and verb forms by their
endings with simplemma confirming the word is a form of a verb (its lemma is an infinitive). That's
close but not perfect, on purpose, as for Spanish:

- A form shared by two points counts as neither where the words can't tell them apart (Russian
  говорите is "you speak" and "speak!", so after вы it isn't an imperative).
- Only forms the words show are found: French regular subjunctives look like the present
  (qu'il parle), so only irregular ones (soit, fasse, puisse) count; German separable verbs and
  word order beyond the subordinating words aren't checked.
- A participle after an auxiliary is found within a few words, since the line's punctuation is gone
  by then: German puts it at the end of the clause (hat ihn gestern gesehen).

`FINDERS` is each point's finder by id, for grammar.py to join to the point's name and note in
grammar_points.json; this module doesn't import grammar.py, so the two don't import each other.
"""

import re
import unicodedata
from collections.abc import Callable
from typing import Literal

Span = tuple[int, int]
Finder = Callable[[list[str]], list[Span]]


def _lemma(word: str, code: str) -> str:
    from franki_reader.spaced import lemma  # loads simplemma, only when a draft is checked

    return lemma(word, code)


def _raw_lemma(word: str, code: str) -> str:
    """simplemma's lemma as it gives it, capitals and all."""
    import simplemma

    return str(simplemma.lemmatize(word, lang=code, low_memory=True))


def _known(word: str, code: str) -> bool:
    import simplemma

    return bool(simplemma.is_known(word, lang=code, low_memory=True))


def _each(test: Callable[[list[str], int], bool]) -> Finder:
    return lambda ws: [(i, i + 1) for i in range(len(ws)) if test(ws, i)]


def _either(*finders: Finder) -> Finder:
    return lambda ws: sorted({span for f in finders for span in f(ws)})


def _words(*groups: str) -> frozenset[str]:
    return frozenset(w for g in groups for w in g.split())


def _marker(markers: frozenset[str]) -> Finder:
    return _each(lambda ws, i: ws[i] in markers)


def _aux_then(
    aux: frozenset[str],
    target: Callable[[str], bool],
    window: int,
    skip: frozenset[str] = frozenset(),
    mark: Literal["both", "aux", "target"] = "both",
    stop: frozenset[str] = frozenset(),
    strict: bool = False,
) -> Finder:
    """An auxiliary followed within `window` words by a word `target` accepts. With "both", the
    span runs from the auxiliary to that word when only `skip` words come between, or is that word
    alone. "aux" marks the auxiliary only, and "target" the word only: German puts a participle at
    the end of the clause, often far from its auxiliary. The search ends at a `stop` word (a
    conjunction starts another clause, a determiner means the word after it is a noun), and with
    `strict` at any word that isn't in `skip`."""

    def find(ws: list[str]) -> list[Span]:
        out: list[Span] = []
        for i, w in enumerate(ws):
            if w not in aux:
                continue
            for j in range(i + 1, min(len(ws), i + 1 + window)):
                if ws[j] in stop:
                    break
                if target(ws[j]):
                    if mark == "aux":
                        out.append((i, i + 1))
                    elif mark == "both" and all(b in skip for b in ws[i + 1 : j]):
                        out.append((i, j + 1))
                    else:
                        out.append((j, j + 1))
                    break
                if ws[j] in aux or (strict and ws[j] not in skip):
                    break
        return out

    return find


# ==== German ====


def _de_verb(word: str) -> str | None:
    """The infinitive this word is a form of, or None."""
    lem = _lemma(word, "de")
    return lem if lem != word and lem.endswith("n") else None


def _de_noun(word: str) -> bool:
    """The words are lowercased, so a German noun has lost its capital: this is one simplemma
    knows as a noun when it's capitalized (Garten). Only checked where nothing else says it's a
    verb: after an auxiliary, gefahren is "driven", not Gefahren, "dangers"."""
    return _raw_lemma(word.capitalize(), "de")[0].isupper()


_DE_PREFIXES = ("be", "ver", "er", "ent", "zer", "emp", "miss", "über", "unter", "hinter", "wider")
_DE_GE_PARTICIPLE = re.compile(
    r"^(?:ab|an|auf|aus|bei|ein|mit|nach|vor|zu|zurück|weg|her|hin|los|fest|fort|um|wieder"
    r"|zusammen|vorbei|weiter|heraus|hinaus|herein|hinein|heim|statt|teil|frei|dar)?ge"
)
# Strong participles simplemma can't give a verb for (gefahren is also the noun Gefahren), with
# their infinitives.
_DE_PARTICIPLE_UNLEMMATIZED = {
    "gefahren": "fahren",
    "gefangen": "fangen",
    "gebacken": "backen",
    "gefallen": "fallen",
    "geschehen": "geschehen",
    "erschienen": "erscheinen",
}


def _de_participle(word: str) -> bool:
    """A past participle after an auxiliary. Not geht, gehört or gewinnt: ge- starts the verb there
    (gehen, gehören), so the word is the present tense. A participle that is the same word as a
    prefixed verb's present tense (besucht, studiert, beginnt) can't be told apart, and counts."""
    if not word.endswith(("t", "en")):
        return False
    if word in _DE_PARTICIPLE_UNLEMMATIZED:
        return True
    lem = _de_verb(word)
    if lem is None:
        return False
    if _DE_GE_PARTICIPLE.match(word):
        return word not in (lem[:-2] + "t", lem[:-2] + "et", lem[:-1] + "t")
    return word.endswith("iert") or word.startswith(_DE_PREFIXES)


def _de_infinitive(word: str) -> bool:
    return word.endswith("en") and len(word) > 3 and _lemma(word, "de") == word


_DE_HABEN = _words("habe hast hat haben habt")
_DE_SEIN = _words("bin bist ist sind seid")
_DE_HATTE = _words("hatte hattest hatten hattet")
_DE_WAR = _words("war warst waren wart")

# Verbs that form the perfect with sein, by infinitive, alone or after a separable prefix
# (ankommen, abfahren). ist verkauft and ist geöffnet are a state, not a perfect.
_DE_SEIN_BASES = _words(
    "sein werden bleiben gehen kommen fahren fliegen laufen rennen reisen wandern schwimmen",
    "springen fallen steigen sinken sterben wachsen folgen landen reiten klettern fließen",
    "rutschen stürzen schmelzen gleiten ziehen eilen marschieren biegen treten kehren",
)
_DE_SEIN_VERBS = _words(
    "geschehen passieren gelingen misslingen aufstehen aufwachen erwachen einschlafen",
    "verschwinden erscheinen entstehen entkommen entfliehen vergehen verreisen begegnen gelangen",
    "geraten scheitern platzen ertrinken starten erschrecken genesen",
)
_DE_SEPARABLE = (
    "ab an auf aus bei ein mit nach vor zu zurück weg her hin los fest fort um wieder zusammen",
    "vorbei weiter heraus hinaus herein hinein heim hoch herunter hinunter hinauf herauf",
)


def _de_sein_participle(word: str) -> bool:
    """A participle of a verb that takes sein (gegangen, angekommen, passiert)."""
    if not _de_participle(word):
        return False
    lem = _de_verb(word) or _DE_PARTICIPLE_UNLEMMATIZED.get(word)
    if lem is None:
        return False
    if lem in _DE_SEIN_VERBS or lem in _DE_SEIN_BASES:
        return True
    return any(
        lem.startswith(prefix) and lem[len(prefix) :] in _DE_SEIN_BASES
        for group in _DE_SEPARABLE
        for prefix in group.split()
    )


_DE_WERDEN = _words("werde wirst wird werden werdet")
_DE_PASSIVE = _DE_WERDEN | _words("wurde wurdest wurden wurdet worden")
_DE_PAST_IRREGULAR = _words(
    "war warst waren wart hatte hattest hatten hattet ging gingen kam kamen sah sahen gab gaben",
    "fand fanden stand standen sprach sprachen nahm nahmen saß saßen lag lagen blieb blieben",
    "schrieb schrieben las lasen trank tranken aß aßen fuhr fuhren lief liefen rief riefen",
    "schlief schliefen fiel fielen hielt hielten ließ ließen wusste wussten dachte dachten",
    "brachte brachten kannte kannten konnte konnten musste mussten wollte wollten durfte",
    "durften sollte sollten mochte mochten wurde wurden trug flog zog bot verlor vergaß",
    "verstand bekam begann gewann traf schwieg stieg wuchs starb half warf",
)


def _de_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _DE_PAST_IRREGULAR:
        return True
    lem = _de_verb(w)
    if lem is None or _de_noun(w):
        return False
    stem = lem[:-2] if lem.endswith("en") else lem[:-1]
    return any(w == stem + e for e in ("te", "test", "ten", "tet", "ete", "etest", "eten", "etet"))


_DE_SUBJUNCTIVE = _words(
    "würde würdest würden würdet hätte hättest hätten hättet wäre wärst wären wärt",
    "könnte könntest könnten müsste müssten dürfte dürften möchte möchtest möchten käme gäbe",
    "wüsste",
)
_DE_MODALS = frozenset({"können", "müssen", "dürfen", "sollen", "wollen", "mögen"})
_DE_CONJUNCTIONS = _words("weil dass obwohl ob nachdem bevor")
# Words that start another clause, so a participle or infinitive after one isn't the auxiliary's:
# "Es wird dunkel, und wir gehen" is a present tense.
_DE_NEW_CLAUSE = _DE_CONJUNCTIONS | _words("und aber oder denn sondern wenn als während damit")

_GERMAN: dict[str, Finder] = {
    "de.perfect": _either(
        _aux_then(_DE_HABEN, _de_participle, 8, mark="target", stop=_DE_NEW_CLAUSE),
        _aux_then(_DE_SEIN, _de_sein_participle, 8, mark="target", stop=_DE_NEW_CLAUSE),
    ),
    "de.past": _each(_de_past),
    "de.pluperfect": _either(
        _aux_then(_DE_HATTE, _de_participle, 8, mark="target", stop=_DE_NEW_CLAUSE),
        _aux_then(_DE_WAR, _de_sein_participle, 8, mark="target", stop=_DE_NEW_CLAUSE),
    ),
    "de.future": _aux_then(_DE_WERDEN, _de_infinitive, 8, mark="aux", stop=_DE_NEW_CLAUSE),
    "de.subjunctive": _marker(_DE_SUBJUNCTIVE),
    "de.passive": _aux_then(_DE_PASSIVE, _de_participle, 8, mark="target", stop=_DE_NEW_CLAUSE),
    "de.modals": _each(lambda ws, i: _lemma(ws[i], "de") in _DE_MODALS),
    "de.subordinate": _marker(_DE_CONJUNCTIONS),
}


# ==== French ====


def _fr_verb(word: str) -> str | None:
    lem = _lemma(word, "fr")
    return lem if lem != word and lem.endswith(("er", "ir", "re", "oir")) else None


_FR_PARTICIPLE_IRREGULAR = _words(
    "été eu fait dit pris mis vu su pu voulu dû venu né mort ouvert écrit lu bu cru reçu connu",
    "vécu appris compris permis promis offert découvert souffert devenu revenu parti sorti",
    "tenu attendu entendu perdu rendu vendu répondu descendu",
)
_FR_PARTICIPLE = re.compile(r"(é|ée|és|ées|i|ie|is|ies|u|ue|us|ues)$")


def _fr_participle(word: str) -> bool:
    """A past participle: listed, or a regular ending on a verb simplemma knows (parlé from parler,
    fini from finir, vendu from vendre). Not vrai or jolie, which only end like one."""
    if word in _FR_PARTICIPLE_IRREGULAR:
        return True
    match = _FR_PARTICIPLE.search(word)
    if match is None or len(word) < 4:
        return False
    stem = word[: match.start()]
    infinitives = {"é": ("er",), "i": ("ir",), "u": ("re", "oir", "ir")}[match.group()[0]]
    return any(_known(stem + ending, "fr") for ending in infinitives)


_FR_AVOIR = _words("ai as a avons avez ont")
_FR_ETRE = _words("suis es est sommes êtes sont")
# Participles of the verbs that take être (aller, venir, arriver, partir...), as the lemmatizer
# leaves some of them (parti, mort, revenu). est fatigué and est fini are a state, not a perfect.
_FR_ETRE_PARTICIPLES = _words(
    "allé venu arrivé parti sorti entré rentré resté retourné tombé monté descendu né mort",
    "devenu revenu parvenu survenu intervenu décédé passé apparu reparti ressorti retombé",
    "remonté redescendu redevenu arrivé",
)
# se lever, s'est levée: a reflexive verb takes être, so any participle counts after one.
_FR_REFLEXIVE = _words("se s' me m' te t'")
_FR_ADVERBS = _words("pas jamais déjà bien encore toujours plus rien tout beaucoup trop vraiment")
# A noun comes after one of these (J'ai une pensée, I have a thought), so what follows isn't a
# participle.
_FR_DETERMINERS = _words(
    "le la les l' un une des du de d' mon ma mes ton ta tes son sa ses notre nos votre vos leur",
    "leurs ce cet cette ces quelques plusieurs chaque",
)
_FR_IMPERFECT_ENDINGS = ("aient", "ions", "iez", "ais", "ait")
_FR_FUTURE_ENDINGS = ("ons", "ont", "ez", "ai", "as", "a")
_FR_IRREGULAR_STEMS = _words(
    "ser aur ir fer pourr voudr viendr tiendr devr saur verr faudr enverr recevr courr mourr",
    "pleuvr vaudr assiér assoir",
)
# Prefixed verbs keep the irregular stem: devenir → deviendr, concevoir → concevr.
_FR_IRREGULAR_ENDS = ("tiendr", "viendr", "cevr", "courr", "mourr", "verr", "querr", "cueiller")


def _fr_spelling(stem: str) -> str:
    """A stem with its spelling changes undone: achèter-ai is acheter, appeller-ai appeler,
    appuier-ai appuyer."""
    plain = unicodedata.normalize("NFD", stem.replace("y", "i"))
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return re.sub(r"(.)\1", r"\1", plain)


def _fr_on_stem(word: str, endings: tuple[str, ...]) -> bool:
    """A future or conditional form: the infinitive, or an irregular stem, plus the ending."""
    for ending in endings:
        if word.endswith(ending):
            stem = word[: -len(ending)]
            lem = _fr_verb(word)
            if lem is None or not stem.endswith("r"):
                return False
            return (
                stem in _FR_IRREGULAR_STEMS
                or stem.endswith(_FR_IRREGULAR_ENDS)
                or stem in (lem, lem[:-1])
                or _fr_spelling(stem) in (_fr_spelling(lem), _fr_spelling(lem[:-1]))
            )
    return False


def _fr_future(ws: list[str], i: int) -> bool:
    return _fr_on_stem(ws[i], _FR_FUTURE_ENDINGS)


def _fr_conditional(ws: list[str], i: int) -> bool:
    return _fr_on_stem(ws[i], _FR_IMPERFECT_ENDINGS)


def _fr_imperfect(ws: list[str], i: int) -> bool:
    w = ws[i]
    ending = next((e for e in _FR_IMPERFECT_ENDINGS if w.endswith(e)), None)
    # At least two letters of stem: fait is "does", not an imperfect.
    if ending is None or len(w) - len(ending) < 2 or _fr_conditional(ws, i):
        return False
    lem = _fr_verb(w)
    if lem is None:
        return False
    # connais, plais and apparaît are present tenses of -aître and -aire verbs; their imperfects
    # have the s of connaissais, faisais.
    if lem.endswith(("aître", "aitre", "oître", "aire")) and ending in ("ais", "ait"):
        return w[: -len(ending)].endswith(("iss", "is", "ay"))
    return True


def _fr_etre_participle(word: str) -> bool:
    """A participle of an être verb, with its agreement (allée, venus, nées)."""
    return any(
        word.endswith(agreement) and word[: len(word) - len(agreement)] in _FR_ETRE_PARTICIPLES
        for agreement in ("", "e", "s", "es")
    )


def _fr_etre_perfect(ws: list[str]) -> list[Span]:
    """être and then a participle: only of an être verb (il est parti), or after a reflexive
    pronoun (elle s'est levée, nous nous sommes lavés)."""
    out: list[Span] = []
    for i, w in enumerate(ws):
        if w not in _FR_ETRE:
            continue
        reflexive = i > 0 and (
            ws[i - 1] in _FR_REFLEXIVE
            or (ws[i - 1] in ("nous", "vous") and i > 1 and ws[i - 2] in ("nous", "vous"))
        )
        for j in range(i + 1, min(len(ws), i + 4)):
            if ws[j] in _FR_DETERMINERS or ws[j] in _FR_AVOIR | _FR_ETRE:
                break
            if _fr_participle(ws[j]) and (reflexive or _fr_etre_participle(ws[j])):
                direct = all(b in _FR_ADVERBS for b in ws[i + 1 : j])
                out.append((i, j + 1) if direct else (j, j + 1))
                break
    return out


def _fr_infinitive(word: str) -> bool:
    return word.endswith(("er", "ir", "re", "oir")) and _lemma(word, "fr") == word


_FR_ALLER = _words("vais vas va allons allez vont")
_FR_OBJECT_PRONOUNS = _words("me te se le la les lui leur nous vous y en m' t' s' l'")
_FR_SUBJUNCTIVE = _words(
    "sois soit soyons soyez soient aie aies ait ayons ayez aient fasse fasses fassions fassiez",
    "fassent puisse puisses puissions puissiez puissent aille ailles aillent sache saches",
    "sachions sachiez sachent veuille veuilles veuillent",
)


def _fr_subjunctive(ws: list[str]) -> list[Span]:
    out = []
    for i, w in enumerate(ws):
        if w in _FR_SUBJUNCTIVE and any(p in ("que", "qu'") for p in ws[max(0, i - 3) : i]):
            out.append((i, i + 1))
    return out


_FRENCH: dict[str, Finder] = {
    "fr.passe_compose": _either(
        _aux_then(_FR_AVOIR, _fr_participle, 3, _FR_ADVERBS, stop=_FR_DETERMINERS),
        _fr_etre_perfect,
    ),
    "fr.imperfect": _each(_fr_imperfect),
    "fr.future": _each(_fr_future),
    # Only pronouns and adverbs come between: va à la mer, va chez sa mère are a place, not a verb.
    # Not en: it's a pronoun in "va en prendre" but a preposition in "va en voiture", and a noun
    # in -re (voiture, octobre) looks like an infinitive, so the pronoun's use is the one dropped.
    "fr.near_future": _aux_then(
        _FR_ALLER,
        _fr_infinitive,
        3,
        (_FR_OBJECT_PRONOUNS - {"en"}) | _FR_ADVERBS | _words("enfin vite bientôt"),
        strict=True,
    ),
    "fr.conditional": _each(_fr_conditional),
    "fr.subjunctive": _fr_subjunctive,
}


# ==== Russian ====


# Nouns and numerals that end like an infinitive (ночь, пять, радость), which would make
# "будет возможность" a compound future.
_RU_NOT_INFINITIVES = _words(
    "гость мать дочь ночь речь часть власть честь весть страсть память путь пять шесть девять десять"
)


def _ru_noun_like(word: str) -> bool:
    return word in _RU_NOT_INFINITIVES or word.endswith("ость")


def _ru_verb(word: str) -> str | None:
    lem = _lemma(word, "ru")
    endings = ("ть", "ти", "чь", "ться", "тись", "чься")
    if lem == word.replace("ё", "е") or not lem.endswith(endings) or _ru_noun_like(lem):
        return None
    return lem


_RU_PAST = re.compile(r"(л|ла|ло|ли|лся|лась|лось|лись)$")
_RU_PAST_IRREGULAR = _words("мог смог помог пёк нёс вёз лёг умер")


def _ru_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    return w in _RU_PAST_IRREGULAR or (bool(_RU_PAST.search(w)) and _ru_verb(w) is not None)


def _ru_infinitive(word: str) -> bool:
    return (
        word.endswith(("ть", "ти", "чь", "ться", "тись"))
        and not _ru_noun_like(word)
        and _lemma(word, "ru") == word.replace("ё", "е")
    )


_RU_BUDU = _words("буду будешь будет будем будете будут")
_RU_IMPERATIVE_IRREGULAR = _words(
    "будь будьте ешь ешьте пей пейте пиши пишите встань встаньте сядь сядьте ляг лягте",
    "помоги помогите скажи скажите покажи покажите садись садитесь",
)


def _ru_imperative(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _RU_IMPERATIVE_IRREGULAR:
        return True
    lem = _ru_verb(w)
    if lem is None or (i > 0 and ws[i - 1] == "вы"):
        return False  # вы говорите is "you speak"
    base, verb = w, lem.replace("ё", "е")
    for reflexive in ("ся", "сь"):
        if verb.endswith(reflexive):
            verb = verb[:-2]
            base = base.removesuffix(reflexive)
    base = base.removesuffix("те")
    forms = {verb[:-2] + "й", verb[:-3] + "и", verb[:-3] + "ь"}
    if verb.endswith("ти"):
        forms.add(verb[:-2] + "и")  # идти, иди
    return base in forms


_RU_GERUND = re.compile(r"(я|в|вши)$")
_RU_GERUND_REFLEXIVE = re.compile(r"(ясь|вшись)$")


def _ru_gerund(ws: list[str], i: int) -> bool:
    w = ws[i]
    lem = _ru_verb(w)
    if lem is None or _RU_PAST.search(w):
        return False
    # A reflexive verb's verbal adverb ends in -сь (улыбаясь). Its present forms end in -тся
    # (слышится, ведётся, учатся), which the plain -я ending would take for one; simplemma's
    # lemma drops the -ся from some of them, so it's the word that's checked.
    if w.endswith("сь"):
        return bool(_RU_GERUND_REFLEXIVE.search(w))
    # A bare -ся is a gerund only of a verb that isn't reflexive (неся, from нести); возвращайся
    # and ведётся are an imperative and a present tense.
    if w.endswith("ся") and (w.endswith("тся") or lem.endswith(("ся", "сь"))):
        return False
    if not _RU_GERUND.search(w):
        return False
    # Feminine participles end in -ая and -яя too (взятая, читающая). A gerund in -ая is the
    # infinitive's stem and я: читать → читая.
    if w.endswith(("ая", "яя")):
        return lem.endswith(("ать", "ять")) and w == lem[:-2] + "я"
    return True


_RU_COMPARATIVE_IRREGULAR = _words(
    "более менее лучше хуже больше меньше дальше дороже дешевле проще легче выше ниже старше",
    "моложе позже",
)


def _ru_comparative(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _RU_COMPARATIVE_IRREGULAR:
        return True
    lem = _lemma(w, "ru")
    # Not -ий adjectives: for them -ее and -ей are the neuter and the feminine (хорошее, синей).
    return w.endswith(("ее", "ей")) and lem.endswith(("ый", "ой")) and w[:-2] == lem[:-2]


_RUSSIAN: dict[str, Finder] = {
    "ru.past": _each(_ru_past),
    "ru.future": _aux_then(_RU_BUDU, _ru_infinitive, 3),
    "ru.conditional": _marker(_words("бы б")),
    "ru.imperative": _each(_ru_imperative),
    "ru.gerund": _each(_ru_gerund),
    "ru.comparative": _each(_ru_comparative),
}


# ==== Greek ====


def _el_verb(word: str) -> str | None:
    lem = _lemma(word, "el")
    return lem if lem != word and lem.endswith(("ω", "ώ", "μαι")) else None


_EL_PAST = re.compile(r"(α|ες|ε|αμε|ατε|αν|ανε|ηκα|ηκες|ηκε|ήκαμε|ήκατε|ηκαν)$")
_EL_PAST_IRREGULAR = _words("ήμουν ήσουν ήταν ήμασταν ήσασταν")
_EL_NOT_VERBS = _words("θα να όταν μα αλλά ότι")
# Present middle-voice endings that end like a past form: καθόμαστε, έρχεστε.
_EL_PRESENT_MIDDLE = ("μαστε", "εστε", "σαστε")
# Commands that end like a past form's -ε or -ες: πες, δες, έλα, κάνε.
_EL_IMPERATIVES = _words("πες δες έλα κάνε φάε πάρε βάλε δώσε φέρε δείξε κοίτα σταμάτα πρόσεχε")


def _el_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _EL_PAST_IRREGULAR:
        return True
    if w in _EL_NOT_VERBS or w in _EL_IMPERATIVES or w.endswith(_EL_PRESENT_MIDDLE):
        return False
    # Each person's present ends differently from its past: you-plural -τε (θέλετε) against -ατε,
    # we -ουμε and -άμε (γράφουμε, μιλάμε) against -αμε, and they, colloquially, -ουνε (γράφουνε)
    # against -ανε. A command ends in -τε too (πατήστε).
    for present, past in (("τε", "ατε"), ("με", "αμε"), ("νε", "ανε")):
        if w.endswith(present) and not w.endswith(past):
            return False
    return bool(_EL_PAST.search(w)) and _el_verb(w) is not None


def _el_perfect_form(word: str) -> bool:
    """The form after έχω or είχα: γράψει, πάει, φάει."""
    return word.endswith(("ει", "εί")) and _el_verb(word) is not None


_EL_PRONOUNS = _words("το τα τον την τους μου σου του της μας σας")
_EL_BETWEEN = _EL_PRONOUNS | _words("ήδη μόλις ακόμα πια")
_EL_NEW_CLAUSE = _words("και αλλά ή ότι που αν όταν επειδή")

_GREEK: dict[str, Finder] = {
    "el.tha": _marker(_words("θα")),
    "el.na": _marker(_words("να")),
    "el.past": _each(_el_past),
    # Only pronouns come between: έχει σπίτι και μένει is "has a house and lives", not a perfect.
    "el.perfect": _aux_then(
        _words("έχω έχεις έχει έχουμε έχετε έχουν έχουνε"),
        _el_perfect_form,
        3,
        _EL_BETWEEN,
        stop=_EL_NEW_CLAUSE,
        strict=True,
    ),
    "el.pluperfect": _aux_then(
        _words("είχα είχες είχε είχαμε είχατε είχαν είχανε"),
        _el_perfect_form,
        3,
        _EL_BETWEEN,
        stop=_EL_NEW_CLAUSE,
        strict=True,
    ),
}


# ==== Polish ====


# Infinitives end in -ć, or in -c for a few verbs; any other word in -c is a noun (noc, owoc, koc).
_PL_C_INFINITIVES = ("móc", "piec", "biec", "ciec", "lec", "rzec", "strzec", "tłuc", "wlec")


def _pl_infinitive_shape(word: str) -> bool:
    return word.endswith(("ć",) + _PL_C_INFINITIVES)


def _pl_verb(word: str) -> str | None:
    lem = _lemma(word, "pl")
    return lem if lem != word and _pl_infinitive_shape(lem) else None


_PL_PAST = re.compile(r"(łem|łam|łeś|łaś|ł|ła|ło|liśmy|łyśmy|liście|łyście|li|ły)$")


def _pl_past(ws: list[str], i: int) -> bool:
    return bool(_PL_PAST.search(ws[i])) and _pl_verb(ws[i]) is not None


_PL_CONDITIONAL = re.compile(r"(ł[aoy]?|li)(bym|byś|by|byśmy|byście)$")
_PL_MODALS = frozenset({"chcieć", "musieć", "móc", "umieć", "lubić", "woleć", "potrafić"})


def _pl_conditional(ws: list[str], i: int) -> bool:
    return ws[i] in ("by", "gdyby") or bool(_PL_CONDITIONAL.search(ws[i]))


def _pl_infinitive(word: str) -> bool:
    return _pl_infinitive_shape(word) and _lemma(word, "pl") == word


def _pl_modals(ws: list[str]) -> list[Span]:
    """Any form of a modal verb, followed within two words by an infinitive."""
    out: list[Span] = []
    for i, w in enumerate(ws):
        if _lemma(w, "pl") not in _PL_MODALS:
            continue
        for j in range(i + 1, min(len(ws), i + 3)):
            if _pl_infinitive(ws[j]):
                out.append((i, j + 1))
                break
    return out


_POLISH: dict[str, Finder] = {
    "pl.past": _each(_pl_past),
    "pl.future": _marker(_words("będę będziesz będzie będziemy będziecie będą")),
    "pl.conditional": _each(_pl_conditional),
    "pl.czy": _marker(_words("czy")),
    "pl.modals": _pl_modals,
}


# ==== Norwegian ====


def _nb_verb(word: str) -> str | None:
    lem = _lemma(word, "nb")
    return lem if lem != word else None


_NB_PAST_IRREGULAR = _words(
    "var hadde gikk kom fikk sa tok ble gjorde visste ville kunne skulle måtte sto satt lå drakk",
    "skrev fant ga gav sov løp fløy dro holdt lo slo sang traff vant solgte fortalte spurte la",
)
_NB_SUBJECTS = _words("jeg du han hun vi dere de den det man")


def _nb_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _NB_PAST_IRREGULAR:
        return True
    lem = _nb_verb(w)
    # A verb's infinitive ends in a vowel; huset and barnet are nouns with their article.
    if lem is None or lem[-1] not in "aeiouyæøå":
        return False
    stem = lem.removesuffix("e")
    if w in (stem + "te", stem + "de", lem + "dde"):
        return True
    # -et is also a neuter noun's ending (eplet), so only straight after a subject: jeg snakket.
    return w == stem + "et" and i > 0 and ws[i - 1] in _NB_SUBJECTS


_NB_PARTICIPLE_IRREGULAR = _words(
    "vært hatt gått kommet sett fått sagt tatt blitt gjort visst villet kunnet skullet måttet",
    "stått sittet ligget drukket spist skrevet funnet gitt sovet løpt flydd fløyet dratt holdt ledd",
    "sunget truffet vunnet solgt fortalt spurt lagt bodd lest",
)


def _nb_participle(word: str) -> bool:
    """A past participle: listed, or built on its verb's infinitive (snakket from snakke, kjøpt from
    kjøpe, bodd from bo). Not huset, a noun with its article."""
    if word in _NB_PARTICIPLE_IRREGULAR:
        return True
    lem = _nb_verb(word)
    if lem is None or lem[-1] not in "aeiouyæøå":
        return False
    stem = lem.removesuffix("e")
    # gått, stått and sett are the verb's own +tt; nytt and fritt are adjectives.
    return word in (stem + "et", stem + "t", stem + "d", lem + "dd") or (
        lem in _NB_TT and word == lem + "tt"
    )


_NB_ADVERBS = _words("ikke aldri allerede alltid også bare nettopp nesten")
_NB_TT = _words("gå stå slå få se le flå")


def _nb_future(ws: list[str]) -> list[Span]:
    out: list[Span] = []
    for i, w in enumerate(ws):
        if ws[i : i + 3] == ["kommer", "til", "å"]:
            out.append((i, i + 3))
        elif w == "skal" and any(_lemma(x, "nb") == x for x in ws[i + 1 : i + 3]):
            out.append((i, i + 1))
    return out


def _nb_s_passive(ws: list[str], i: int) -> bool:
    w = ws[i]
    lem = _lemma(w, "nb")
    return len(w) > 4 and lem.endswith("e") and w == lem + "s"


def _nb_passive(ws: list[str]) -> list[Span]:
    found = _aux_then(_words("blir ble bli blitt"), _nb_participle, 3, _NB_ADVERBS)(ws)
    return sorted(set(found) | set(_each(_nb_s_passive)(ws)))


_NORWEGIAN: dict[str, Finder] = {
    "nb.past": _each(_nb_past),
    "nb.perfect": _aux_then(_words("har"), _nb_participle, 3, _NB_ADVERBS),
    "nb.pluperfect": _aux_then(_words("hadde"), _nb_participle, 3, _NB_ADVERBS),
    "nb.future": _nb_future,
    "nb.passive": _nb_passive,
}


FINDERS: dict[str, Finder] = {**_GERMAN, **_FRENCH, **_RUSSIAN, **_GREEK, **_POLISH, **_NORWEGIAN}
