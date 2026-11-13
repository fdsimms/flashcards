"""Grammar points for German, French, Russian, Greek, Polish and Norwegian: each is found in a
sentence that uses it, and left alone in look-alikes."""

from typing import Any

import pytest

from franki_reader.grammar import POINTS, points_for, words
from franki_reader.languages import LANGUAGES, Code
from franki_reader.lexicon import lexicon_from


def found(text: str, language: Code) -> dict[str, list[str]]:
    lexicon = lexicon_from([], language)
    ws = words(text, lexicon)
    out = {}
    for p in points_for(language):
        if spans := p.find(ws):
            out[p.id] = [" ".join(ws[a:b]) for a, b in spans]
    return out


CASES: list[tuple[Code, str, str, list[str]]] = [
    # German
    (
        "de",
        "Ich habe ihn gestern gesehen, und sie ist gegangen.",
        "de.perfect",
        ["gesehen", "gegangen"],
    ),
    ("de", "Er hat angerufen.", "de.perfect", ["angerufen"]),
    (
        "de",
        "Ich war müde und ging nach Hause; wir machten Pause.",
        "de.past",
        ["war", "ging", "machten"],
    ),
    ("de", "Sie hatte schon gegessen.", "de.pluperfect", ["gegessen"]),
    ("de", "Ich werde morgen gehen. Es wird regnen.", "de.future", ["werde", "wird"]),
    ("de", "Ich würde kommen, wenn ich Zeit hätte.", "de.subjunctive", ["würde", "hätte"]),
    (
        "de",
        "Das Haus wird gebaut. Er wurde gefragt.",
        "de.passive",
        ["gebaut", "gefragt"],
    ),
    ("de", "Ich kann schwimmen, aber ich muss arbeiten.", "de.modals", ["kann", "muss"]),
    ("de", "Ich bleibe, weil ich müde bin.", "de.subordinate", ["weil"]),
    (
        "de",
        "Ich habe das Buch gestern gekauft und er hat es gehört.",
        "de.perfect",
        ["gekauft", "gehört"],
    ),
    ("de", "Wir sind spät aufgestanden und gegangen.", "de.perfect", ["aufgestanden"]),
    # French
    (
        "fr",
        "J'ai parlé avec elle, puis elle est partie.",
        "fr.passe_compose",
        ["ai parlé", "est partie"],
    ),
    ("fr", "Je n'ai pas fini.", "fr.passe_compose", ["ai pas fini"]),
    ("fr", "Quand j'étais petit, je parlais beaucoup.", "fr.imperfect", ["étais", "parlais"]),
    (
        "fr",
        "Demain je parlerai et il sera là; nous irons.",
        "fr.future",
        ["parlerai", "sera", "irons"],
    ),
    ("fr", "Je vais partir et on va le manger.", "fr.near_future", ["vais partir", "va le manger"]),
    (
        "fr",
        "Je parlerais si je pouvais; ce serait bien.",
        "fr.conditional",
        ["parlerais", "serait"],
    ),
    ("fr", "Il faut que je sois là et qu'il fasse beau.", "fr.subjunctive", ["sois", "fasse"]),
    (
        "fr",
        "Il reviendra demain et je deviendrai médecin.",
        "fr.future",
        ["reviendra", "deviendrai"],
    ),
    # Spelling changes: acheter, appeler.
    (
        "fr",
        "Nous appellerions et j'achèterais du pain.",
        "fr.conditional",
        ["appellerions", "achèterais"],
    ),
    ("fr", "Je connaissais Marc, mais je ne le connais plus.", "fr.imperfect", ["connaissais"]),
    (
        "fr",
        "Je vais le voir et elle va bien chercher du pain.",
        "fr.near_future",
        ["vais le voir", "va bien chercher"],
    ),
    # Russian
    ("ru", "Он читал книгу, а она пошла домой.", "ru.past", ["читал", "пошла"]),
    ("ru", "Я буду читать, а он будет работать.", "ru.future", ["буду читать", "будет работать"]),
    ("ru", "Я бы пошёл, если бы знал.", "ru.conditional", ["бы", "бы"]),
    ("ru", "Читай! Скажите, идите сюда.", "ru.imperative", ["читай", "скажите", "идите"]),
    ("ru", "Читая книгу, он улыбался; прочитав её, ушёл.", "ru.gerund", ["читая", "прочитав"]),
    (
        "ru",
        "Улыбаясь, она вернулась; вернувшись домой, неся сумку.",
        "ru.gerund",
        ["улыбаясь", "вернувшись", "неся"],
    ),
    (
        "ru",
        "Этот поезд быстрее и лучше, более удобный.",
        "ru.comparative",
        ["быстрее", "лучше", "более"],
    ),
    ("ru", "Улыбаясь, она вернулась, неся сумку.", "ru.gerund", ["улыбаясь", "неся"]),
    # Greek
    ("el", "Θα πάω αύριο.", "el.tha", ["θα"]),
    ("el", "Θέλω να φύγω.", "el.na", ["να"]),
    ("el", "Χθες έγραψα ένα γράμμα και πήγαμε σινεμά.", "el.past", ["έγραψα", "πήγαμε"]),
    ("el", "Έχω γράψει το γράμμα.", "el.perfect", ["έχω γράψει"]),
    ("el", "Χθες γράψαμε και μείναμε εκεί.", "el.past", ["γράψαμε", "μείναμε"]),
    ("el", "Είχαν φύγει νωρίς.", "el.pluperfect", ["είχαν φύγει"]),
    # Polish
    ("pl", "Byłem w domu, a ona poszła do sklepu.", "pl.past", ["byłem", "poszła"]),
    ("pl", "Jutro będę czytać.", "pl.future", ["będę"]),
    ("pl", "Chciałbym kawę, gdyby była.", "pl.conditional", ["chciałbym", "gdyby"]),
    ("pl", "Czy masz czas?", "pl.czy", ["czy"]),
    ("pl", "Chcę iść, ale muszę pracować.", "pl.modals", ["chcę iść", "muszę pracować"]),
    (
        "pl",
        "Chcę zobaczyć ten koc, ale muszę uciec.",
        "pl.modals",
        ["chcę zobaczyć", "muszę uciec"],
    ),
    # Norwegian
    ("nb", "Jeg var hjemme og spiste; vi bodde der.", "nb.past", ["var", "spiste", "bodde"]),
    ("nb", "Jeg snakket med henne.", "nb.past", ["snakket"]),
    ("nb", "Jeg har vært der og har ikke spist.", "nb.perfect", ["har vært", "har ikke spist"]),
    ("nb", "Hun hadde gått.", "nb.pluperfect", ["hadde gått"]),
    ("nb", "Vi skal reise, og det kommer til å regne.", "nb.future", ["skal", "kommer til å"]),
    ("nb", "Huset blir solgt, og bilen selges.", "nb.passive", ["blir solgt", "selges"]),
]


@pytest.mark.parametrize(("language", "text", "point", "matches"), CASES)
def test_each_point_is_found(language: Code, text: str, point: str, matches: list[str]) -> None:
    assert found(text, language).get(point) == matches


@pytest.mark.parametrize(
    ("language", "text", "point"),
    [
        ("de", "Das ist eine gute Idee, und das Essen ist warm.", "de.past"),
        ("de", "Er ist gut.", "de.perfect"),
        ("fr", "Mais jamais en français.", "fr.imperfect"),
        ("fr", "Il parle et elle chante.", "fr.subjunctive"),  # present looks like subjunctive
        ("ru", "Вы говорите по-русски.", "ru.imperative"),  # you speak
        ("ru", "У матери нет радости.", "ru.imperative"),
        ("ru", "Вдруг слышится шум. Он учится, а они находятся дома.", "ru.gerund"),  # -ся
        ("el", "Όταν έρθει η μέρα.", "el.past"),
        ("pl", "To jest mała szkoła.", "pl.past"),
        ("nb", "Eplet er rødt.", "nb.past"),  # a noun's -et
        # German: present tenses of ge- and prefixed verbs end like a participle (geht, beginnt),
        # and a plural verb after werden is a present tense, not an infinitive.
        ("de", "Das Wetter ist schön, und es geht mir gut.", "de.perfect"),
        ("de", "Wir sind müde, aber es geht.", "de.perfect"),
        ("de", "Ich habe Hunger, und der Film beginnt gleich.", "de.perfect"),
        ("de", "Er hat Geld und sie gehört zu uns.", "de.perfect"),
        ("de", "Die Bücher sind alt, und sie gehören mir.", "de.perfect"),
        ("de", "Es wird dunkel, und wir gehen nach Hause.", "de.future"),
        # French: nouns ending like a participle (une pensée), places after aller, and the
        # present of connaître, which ends like an imperfect.
        ("fr", "J'ai une pensée pour toi.", "fr.passe_compose"),
        ("fr", "Il a une dictée demain.", "fr.passe_compose"),
        ("fr", "Je vais à la mer et nous allons au théâtre.", "fr.near_future"),
        ("fr", "Il va chez sa mère. Je vais au centre.", "fr.near_future"),
        ("fr", "Elle va en Angleterre en octobre, et en voiture.", "fr.near_future"),
        ("fr", "Je connais ce quartier et tu connais Marc.", "fr.imperfect"),
        ("fr", "Elle apparaît et il disparaît: je disparais aussi.", "fr.imperfect"),
        # Russian: -ее and -ей of an -ий adjective are the neuter and the feminine, not a
        # comparative; будет before a noun isn't a compound future; -ся presents, imperatives
        # and feminine participles aren't verbal adverbs.
        ("ru", "Это хорошее место, и у меня синее платье.", "ru.comparative"),
        ("ru", "Я говорю с хорошей учительницей о последней неделе.", "ru.comparative"),
        ("ru", "Домашнее задание и будущее.", "ru.comparative"),
        ("ru", "У нас будет возможность и радость.", "ru.future"),
        ("ru", "Завтра будет ночь, и будет пять часов.", "ru.future"),
        ("ru", "Он учится, а они находятся дома.", "ru.gerund"),
        ("ru", "Здесь ведется работа, а там вводятся правила.", "ru.gerund"),
        ("ru", "Возвращайся домой и занимайся спортом.", "ru.gerund"),
        ("ru", "Взятая книга и вызванная проблема.", "ru.gerund"),
        ("ru", "Он ждёт гостя.", "ru.gerund"),
        # Greek: the present's we, you-plural and colloquial they end like a past's -ε, and a
        # command can end like one; έχει σπίτι και μένει is a present, not a perfect.
        ("el", "Γράφουμε ένα γράμμα και μένουμε στην Αθήνα.", "el.past"),
        ("el", "Εμείς μιλάμε ελληνικά. Αυτοί γράφουνε.", "el.past"),
        ("el", "Θέλετε καφέ; Πατήστε εδώ.", "el.past"),
        ("el", "Πες μου. Κοίτα εδώ και σταμάτα.", "el.past"),
        ("el", "Ο φίλος μου έχει ένα σπίτι και μένει εκεί.", "el.perfect"),
        ("el", "Έχω δουλειά και θέλει να έρθει.", "el.perfect"),
        # Polish: a noun in -c after a verb that takes an infinitive.
        ("pl", "Lubię noc i lubię ten owoc.", "pl.modals"),
        ("pl", "Chcę ten koc i ojciec ma pałac.", "pl.modals"),
        # Norwegian: a neuter noun with its article (huset) isn't a past tense after det, and an
        # adjective like nytt isn't a participle.
        ("nb", "Det huset er stort, og det barnet er søtt.", "nb.past"),
        ("nb", "Vi har nytt hus og fritt valg.", "nb.perfect"),
    ],
)
def test_look_alikes_are_left_alone(language: Code, text: str, point: str) -> None:
    assert point not in found(text, language)


# Present-tense texts, so a point found here would send a draft back for grammar it doesn't use.
PLAIN = {
    "de": "Ich nehme einen Kaffee. Die Bedienung ist nett, und das Wetter ist schön. Die Kinder "
    "spielen im Garten, die Katze schläft. Die rechte Seite ist frei. Er ist gut gelaunt. Das "
    "Wetter ist schön, und es geht mir gut. Es wird dunkel, und wir gehen nach Hause.",
    "fr": "Je prends un café. Le serveur est gentil et il fait beau. Nous sommes assis dehors. "
    "Les enfants jouent, le chat dort. Mais c'est vrai, elle est jolie et il est petit. Je "
    "connais ce quartier. Je vais à la mer chez ma mère, et nous allons au théâtre en octobre.",
    "ru": "Я хочу кофе. Официант вежливый, и сегодня хорошая погода. Дети играют в саду, кошка "
    "спит. У меня нет времени. Вы говорите по-русски? Мама и дочь дома. Это хорошее место, у "
    "меня есть синее платье и домашнее задание. Он учится, а они находятся дома.",
    "el": "Θέλω έναν καφέ. Ο σερβιτόρος είναι ευγενικός. Καθόμαστε έξω στον ήλιο. Τα παιδιά "
    "παίζουν στον κήπο, η γάτα κοιμάται. Όταν έρχεται η μέρα. Εμείς γράφουμε και μένουμε εδώ. "
    "Τι κάνετε; Θέλετε καφέ; Αυτοί παίζουνε στον κήπο.",
    "pl": "Poproszę kawę. Kelner jest miły, a dzisiaj jest ładna pogoda. Dzieci bawią się w "
    "ogrodzie, kot śpi. To jest mała szkoła.",
    "nb": "Jeg tar en kaffe. Kelneren er hyggelig. Barna leker i hagen, katten sover. Det blir "
    "sju euro. Huset er stort og eplet er rødt.",
}


@pytest.mark.parametrize("language", list(PLAIN))
def test_a_plain_present_tense_text_uses_no_point(language: Code) -> None:
    assert found(PLAIN[language], language) == {}


def test_a_participle_after_its_auxiliary_is_a_verb_even_when_it_is_also_a_noun() -> None:
    # Gefahren is "dangers", but after bin it's "driven".
    assert found("Ich bin in die Stadt gefahren.", "de")["de.perfect"] == ["gefahren"]
    assert found("Ich habe das Buch gelesen.", "de")["de.perfect"] == ["gelesen"]


def test_every_language_but_english_has_points_with_names_and_notes() -> None:
    for code in LANGUAGES:
        assert points_for(code), code
    for p in POINTS.values():
        assert p.name and p.note and "—" not in p.name + p.note
        assert p.id.startswith(p.language + ".")


def test_french_elisions_line_up_with_the_rendered_words() -> None:
    from franki_reader.generator import Line
    from franki_reader.reader import render
    from franki_reader.store import StoredText

    text = StoredText(
        1,
        1,
        "t",
        (Line("A", "J'ai|parlé|à|l'homme.", "..."),),
        {},
        (),
        1.0,
        language="fr",
        grammar={"practice": ["fr.passe_compose"], "avoid": []},
    )
    lexicon: Any = lexicon_from([], "fr")
    marked = {w["text"]: w["grammar"] for w in render(text, lexicon, {})["lines"][0]["words"]}
    assert marked["ai"] == marked["parlé"] == "fr.passe_compose"
    assert marked["J'"] is None and marked["homme"] is None
