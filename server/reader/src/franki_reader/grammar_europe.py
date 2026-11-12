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

`POINTS` is (id, language, name, note, finder) for grammar.py to make into its points; this module
doesn't import grammar.py, so the two don't import each other.
"""

import re
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
) -> Finder:
    """An auxiliary followed within `window` words by a word `target` accepts. With "both", the
    span runs from the auxiliary to that word when only `skip` words come between, or is that word
    alone. "aux" marks the auxiliary only, and "target" the word only: German puts a participle at
    the end of the clause, often far from its auxiliary."""

    def find(ws: list[str]) -> list[Span]:
        out: list[Span] = []
        for i, w in enumerate(ws):
            if w not in aux:
                continue
            for j in range(i + 1, min(len(ws), i + 1 + window)):
                if target(ws[j]):
                    if mark == "aux":
                        out.append((i, i + 1))
                    elif mark == "both" and all(b in skip for b in ws[i + 1 : j]):
                        out.append((i, j + 1))
                    else:
                        out.append((j, j + 1))
                    break
                if ws[j] in aux:
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


def _de_participle(word: str) -> bool:
    if not word.endswith(("t", "en")):
        return False
    if _de_verb(word) is None:
        # simplemma leaves some as they are (gefahren): ge plus a known infinitive is one too.
        rest = word[2:] if word.startswith("ge") else ""
        infinitive = rest if rest.endswith("en") else rest[:-1] + "en"
        return len(rest) > 3 and _known(infinitive, "de") and _lemma(infinitive, "de") == infinitive
    return "ge" in word[:7] or word.endswith("iert") or word.startswith(_DE_PREFIXES)


def _de_infinitive(word: str) -> bool:
    return word.endswith("en") and len(word) > 3 and _lemma(word, "de") == word


_DE_HABEN_SEIN = _words("habe hast hat haben habt bin bist ist sind seid")
_DE_HATTE_WAR = _words("hatte hattest hatten hattet war warst waren wart")
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

_GERMAN = (
    (
        "de.perfect",
        "Perfect",
        "Has done: ich habe gesagt, sie ist gegangen",
        _aux_then(_DE_HABEN_SEIN, _de_participle, 8, mark="target"),
    ),
    ("de.past", "Simple past", "Did: ich war, er ging, wir machten", _each(_de_past)),
    (
        "de.pluperfect",
        "Pluperfect",
        "Had done: ich hatte gesagt, sie war gegangen",
        _aux_then(_DE_HATTE_WAR, _de_participle, 8, mark="target"),
    ),
    (
        "de.future",
        "Future",
        "Will do: ich werde gehen, es wird regnen",
        _aux_then(_DE_WERDEN, _de_infinitive, 8, mark="aux"),
    ),
    (
        "de.subjunctive",
        "Subjunctive II",
        "Would, could: ich würde gehen, wenn ich Zeit hätte",
        _marker(_DE_SUBJUNCTIVE),
    ),
    (
        "de.passive",
        "Passive",
        "Is done: das Haus wird gebaut, er wurde gefragt",
        _aux_then(_DE_PASSIVE, _de_participle, 8, mark="target"),
    ),
    (
        "de.modals",
        "Modal verbs",
        "kann, muss, darf, soll, will, möchte + infinitive",
        _each(lambda ws, i: _lemma(ws[i], "de") in _DE_MODALS),
    ),
    (
        "de.subordinate",
        "Verb last after weil, dass, obwohl",
        "Subordinate clauses: weil ich müde bin, dass er kommt",
        _marker(_DE_CONJUNCTIONS),
    ),
)


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


_FR_AUX = _words("ai as a avons avez ont suis es est sommes êtes sont")
_FR_ADVERBS = _words("pas jamais déjà bien encore toujours plus rien tout beaucoup trop vraiment")
_FR_IMPERFECT_ENDINGS = ("aient", "ions", "iez", "ais", "ait")
_FR_FUTURE_ENDINGS = ("ons", "ont", "ez", "ai", "as", "a")
_FR_IRREGULAR_STEMS = _words(
    "ser aur ir fer pourr voudr viendr tiendr devr saur verr faudr enverr recevr courr mourr",
    "pleuvr vaudr",
)


def _fr_on_stem(word: str, endings: tuple[str, ...]) -> bool:
    """A future or conditional form: the infinitive, or an irregular stem, plus the ending."""
    for ending in endings:
        if word.endswith(ending):
            stem = word[: -len(ending)]
            lem = _fr_verb(word)
            if lem is None or not stem.endswith("r"):
                return False
            return stem in _FR_IRREGULAR_STEMS or stem in (lem, lem[:-1])
    return False


def _fr_future(ws: list[str], i: int) -> bool:
    return _fr_on_stem(ws[i], _FR_FUTURE_ENDINGS)


def _fr_conditional(ws: list[str], i: int) -> bool:
    return _fr_on_stem(ws[i], _FR_IMPERFECT_ENDINGS)


def _fr_imperfect(ws: list[str], i: int) -> bool:
    w = ws[i]
    ending = next((e for e in _FR_IMPERFECT_ENDINGS if w.endswith(e)), None)
    # At least two letters of stem: fait is "does", not an imperfect.
    return (
        ending is not None
        and len(w) - len(ending) >= 2
        and _fr_verb(w) is not None
        and not _fr_conditional(ws, i)
    )


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


_FRENCH = (
    (
        "fr.passe_compose",
        "Passé composé",
        "Did, has done: j'ai parlé, elle est partie",
        _aux_then(_FR_AUX, _fr_participle, 3, _FR_ADVERBS),
    ),
    ("fr.imperfect", "Imperfect", "Was doing, used to: je parlais, il était", _each(_fr_imperfect)),
    ("fr.future", "Future", "Will do: je parlerai, il sera, nous irons", _each(_fr_future)),
    (
        "fr.near_future",
        "Near future",
        "Going to: je vais partir, on va manger",
        _aux_then(_FR_ALLER, _fr_infinitive, 3, _FR_OBJECT_PRONOUNS),
    ),
    (
        "fr.conditional",
        "Conditional",
        "Would do: je parlerais, il serait, nous pourrions",
        _each(_fr_conditional),
    ),
    (
        "fr.subjunctive",
        "Subjunctive",
        "After que: il faut que je sois, qu'il fasse",
        _fr_subjunctive,
    ),
)


# ==== Russian ====


def _ru_verb(word: str) -> str | None:
    lem = _lemma(word, "ru")
    endings = ("ть", "ти", "чь", "ться", "тись", "чься")
    return lem if lem != word.replace("ё", "е") and lem.endswith(endings) else None


_RU_PAST = re.compile(r"(л|ла|ло|ли|лся|лась|лось|лись)$")
_RU_PAST_IRREGULAR = _words("мог смог помог пёк нёс вёз лёг умер")


def _ru_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    return w in _RU_PAST_IRREGULAR or (bool(_RU_PAST.search(w)) and _ru_verb(w) is not None)


def _ru_infinitive(word: str) -> bool:
    return word.endswith(("ть", "ти", "чь", "ться", "тись")) and _lemma(word, "ru") == word.replace(
        "ё", "е"
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


_RU_GERUND = re.compile(r"(я|ясь|в|вши|вшись)$")


def _ru_gerund(ws: list[str], i: int) -> bool:
    w = ws[i]
    return bool(_RU_GERUND.search(w)) and not _RU_PAST.search(w) and _ru_verb(w) is not None


_RU_COMPARATIVE_IRREGULAR = _words(
    "более менее лучше хуже больше меньше дальше дороже дешевле проще легче выше ниже старше",
    "моложе позже",
)


def _ru_comparative(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _RU_COMPARATIVE_IRREGULAR:
        return True
    lem = _lemma(w, "ru")
    return w.endswith(("ее", "ей")) and lem.endswith(("ый", "ий", "ой")) and w[:-2] == lem[:-2]


_RUSSIAN = (
    ("ru.past", "Past tense", "Did, was doing: он читал, она пошла", _each(_ru_past)),
    (
        "ru.future",
        "Future with буду",
        "Will be doing: я буду читать, он будет работать",
        _aux_then(_RU_BUDU, _ru_infinitive, 3),
    ),
    (
        "ru.conditional",
        "Conditional (бы)",
        "Would: я бы пошёл, если бы знал",
        _marker(_words("бы б")),
    ),
    ("ru.imperative", "Imperative", "Commands: читай, скажите, идите", _each(_ru_imperative)),
    (
        "ru.gerund",
        "Verbal adverbs",
        "While or after doing: читая, прочитав, улыбаясь",
        _each(_ru_gerund),
    ),
    (
        "ru.comparative",
        "Comparatives",
        "Than: быстрее, лучше, более интересный",
        _each(_ru_comparative),
    ),
)


# ==== Greek ====


def _el_verb(word: str) -> str | None:
    lem = _lemma(word, "el")
    return lem if lem != word and lem.endswith(("ω", "ώ", "μαι")) else None


_EL_PAST = re.compile(r"(α|ες|ε|αμε|ατε|αν|ανε|ηκα|ηκες|ηκε|ήκαμε|ήκατε|ηκαν)$")
_EL_PAST_IRREGULAR = _words("ήμουν ήσουν ήταν ήμασταν ήσασταν")
_EL_NOT_VERBS = _words("θα να όταν μα αλλά ότι")
# Present middle-voice endings that end like a past form: καθόμαστε, έρχεστε.
_EL_PRESENT_MIDDLE = ("μαστε", "εστε", "σαστε")


def _el_past(ws: list[str], i: int) -> bool:
    w = ws[i]
    if w in _EL_PAST_IRREGULAR:
        return True
    if w in _EL_NOT_VERBS or w.endswith(_EL_PRESENT_MIDDLE):
        return False
    return bool(_EL_PAST.search(w)) and _el_verb(w) is not None


def _el_perfect_form(word: str) -> bool:
    """The form after έχω or είχα: γράψει, πάει, φάει."""
    return word.endswith(("ει", "εί")) and _el_verb(word) is not None


_EL_PRONOUNS = _words("το τα τον την τους μου σου του της μας σας")

_GREEK = (
    ("el.tha", "θα (will, would)", "θα πάω, I'll go; θα ήθελα, I'd like", _marker(_words("θα"))),
    ("el.na", "να (to, so that)", "θέλω να πάω, πρέπει να φύγω", _marker(_words("να"))),
    ("el.past", "Past tense", "Did, was doing: έγραψα, πήγαμε, ήταν", _each(_el_past)),
    (
        "el.perfect",
        "Perfect",
        "Have done: έχω γράψει, έχει πάει",
        _aux_then(
            _words("έχω έχεις έχει έχουμε έχετε έχουν έχουνε"), _el_perfect_form, 3, _EL_PRONOUNS
        ),
    ),
    (
        "el.pluperfect",
        "Pluperfect",
        "Had done: είχα γράψει, είχαν φύγει",
        _aux_then(
            _words("είχα είχες είχε είχαμε είχατε είχαν είχανε"), _el_perfect_form, 3, _EL_PRONOUNS
        ),
    ),
)


# ==== Polish ====


def _pl_verb(word: str) -> str | None:
    lem = _lemma(word, "pl")
    return lem if lem != word and lem.endswith(("ć", "c")) else None


_PL_PAST = re.compile(r"(łem|łam|łeś|łaś|ł|ła|ło|liśmy|łyśmy|liście|łyście|li|ły)$")


def _pl_past(ws: list[str], i: int) -> bool:
    return bool(_PL_PAST.search(ws[i])) and _pl_verb(ws[i]) is not None


_PL_CONDITIONAL = re.compile(r"(ł[aoy]?|li)(bym|byś|by|byśmy|byście)$")
_PL_MODALS = frozenset({"chcieć", "musieć", "móc", "umieć", "lubić", "woleć", "potrafić"})


def _pl_conditional(ws: list[str], i: int) -> bool:
    return ws[i] in ("by", "gdyby") or bool(_PL_CONDITIONAL.search(ws[i]))


def _pl_infinitive(word: str) -> bool:
    return word.endswith(("ć", "c")) and _lemma(word, "pl") == word


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


_POLISH = (
    ("pl.past", "Past tense", "Did: byłem, poszła, czytaliśmy", _each(_pl_past)),
    (
        "pl.future",
        "Future with będę",
        "Will be doing: będę czytać, będzie padać",
        _marker(_words("będę będziesz będzie będziemy będziecie będą")),
    ),
    ("pl.conditional", "Conditional (by)", "Would: chciałbym, gdyby", _each(_pl_conditional)),
    ("pl.czy", "Questions with czy", "Yes or no questions: czy masz czas?", _marker(_words("czy"))),
    (
        "pl.modals",
        "Want, must, can + infinitive",
        "chcę iść, muszę pracować, mogę pomóc",
        _pl_modals,
    ),
)


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
    if lem is None:
        return False
    stem = lem.removesuffix("e")
    if w in (stem + "te", stem + "de", lem + "dde"):
        return True
    # -et is also a neuter noun's ending (eplet), so only straight after a subject: jeg snakket.
    return w == stem + "et" and i > 0 and ws[i - 1] in _NB_SUBJECTS


_NB_PARTICIPLE_IRREGULAR = _words(
    "vært hatt gått kommet sett fått sagt tatt blitt gjort visst villet kunnet skullet måttet",
    "stått sittet ligget drukket spist skrevet funnet gitt sovet løpt flydd dratt holdt ledd",
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
    return word in (stem + "et", stem + "t", stem + "d", lem + "dd", lem + "tt")


_NB_ADVERBS = _words("ikke aldri allerede alltid også bare nettopp nesten")


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


_NORWEGIAN = (
    ("nb.past", "Past tense", "Did: var, gikk, spiste, bodde", _each(_nb_past)),
    (
        "nb.perfect",
        "Present perfect",
        "Has done: har vært, har spist",
        _aux_then(_words("har"), _nb_participle, 3, _NB_ADVERBS),
    ),
    (
        "nb.pluperfect",
        "Past perfect",
        "Had done: hadde vært, hadde spist",
        _aux_then(_words("hadde"), _nb_participle, 3, _NB_ADVERBS),
    ),
    ("nb.future", "Future", "skal reise, kommer til å regne", _nb_future),
    ("nb.passive", "Passive", "Is done: blir solgt, selges", _nb_passive),
)


POINTS: tuple[tuple[str, str, str, str, Finder], ...] = tuple(
    (pid, pid.split(".")[0], name, note, find)
    for pid, name, note, find in (*_GERMAN, *_FRENCH, *_RUSSIAN, *_GREEK, *_POLISH, *_NORWEGIAN)
)
