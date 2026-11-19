"""The Omnilanguage house style: what the rules call a problem, what the fixes change, and what a write is refused for."""

from __future__ import annotations

import re
from pathlib import Path

from franki_mcp import omnilanguage as o

GERMAN_NOUN = {
    "Entry": "Einstellung", "Meaning": "setting; attitude", "Language": "german", "Register": "neutral",
    "PartOfSpeech": "noun", "Gender": "f", "Plural": "Einstellungen",
    "Context": "Die <b>Einstellungen</b> sind im Menü.", "ContextTranslation": "The settings are in the menu.",
}  # fmt: skip


def rules(fields: dict[str, str], tags: list[str] | None = None) -> set[str]:
    return {p.rule for p in o.problems(fields, tags or [])}


def test_a_note_in_the_house_style_has_no_problems():
    assert o.problems(GERMAN_NOUN) == []


def test_every_rule_reported_is_described_and_every_fixable_rule_exists():
    assert o.FIXABLE <= set(o.RULES)
    messy = {**GERMAN_NOUN, "Entry": "<b>die Einstellung</b>", "Meaning": "1. a setting<br>2. attitude / stance",
             "Register": "informal", "PartOfSpeech": "", "GenerateReverse": "yes", "Genitive": "der Einstellung",
             "Context": "<i>Die Einstellungen sind im Menü</i>", "Notes": "already known — see above"}  # fmt: skip
    assert rules(messy, ["noun"]) <= set(o.RULES)


def test_the_fixes_run_one_after_another_until_none_is_left():
    messy = {**GERMAN_NOUN, "Entry": "<strong>die Einstellung</strong>", "Meaning": "<b>1. a setting<br>2. attitude / stance</b>",
             "Register": "Informal", "PartOfSpeech": "", "GenerateReverse": "yes", "Genitive": "der Einstellung"}  # fmt: skip
    fixed = o.fix(messy, ["noun", "travel"])
    assert fixed.fields["Entry"] == "Einstellung"
    assert fixed.fields["Meaning"] == "1. setting<br>2. attitude; stance"
    assert fixed.fields["Register"] == "casual"
    assert fixed.fields["PartOfSpeech"] == "noun" and fixed.tags == ["travel"]
    assert fixed.fields["GenerateReverse"] == "y" and fixed.fields["Genitive"] == ""
    # What is left needs a writer: the second sense has no example yet.
    assert [(p.rule, p.field, p.level) for p in o.problems(fixed.fields, fixed.tags)] == [("meaning-examples", "Context", "required")]


def test_distinct_senses_are_numbered_lines_and_one_sense_has_no_number():
    base = {**GERMAN_NOUN, "Entry": "Zug", "Gender": "m", "Plural": "Züge", "Genitive": "des Zuges"}
    meaning = lambda value, tags=(): o.fix({**base, "Meaning": value}, list(tags)).fields["Meaning"]  # noqa: E731
    assert meaning("1. train<br>2. move (in a game)") == "1. train<br>2. move (in a game)"
    # A lone number comes off, numbers along one line become lines, and a miscount is recounted.
    assert meaning("1. bait") == "bait"
    assert meaning("1. hook 2. catch, snag 3. checkmark") == "1. hook<br>2. catch; snag<br>3. checkmark"
    assert meaning("2) train<br>5) move") == "1. train<br>2. move"
    assert meaning("<div>1. train</div><div>2. a move / a turn</div>") == "1. train<br>2. move; turn"
    # Anki's editor writes the second line as "first<div>second</div>", with no tag closing the first.
    assert meaning("1. to kill<div>2. to commit suicide (reflexive)</div>") == "1. to kill<br>2. to commit suicide (reflexive)"
    assert o.plain("one<div>two</div><div><br></div>three") == "one\ntwo\nthree"
    # Lines with no numbers are taken as senses; glosses on one line stay one sense.
    assert meaning("train<br>move") == "1. train<br>2. move"
    assert meaning("fame; glory") == "fame; glory"
    # A number that isn't a sense's number is left alone.
    assert meaning("twenty-five (25)") == "twenty-five (25)" and meaning("3.5 liters") == "3.5 liters"
    assert o.senses("1. to receive<br>2. to preserve; to maintain") == ["to receive", "to preserve; to maintain"]
    assert o.write_senses(["train"]) == "train" and o.write_senses(["a < b", "c"]) == "1. a &lt; b<br>2. c"

    two = {**base, "Meaning": "1. train<br>2. move (in a game)"}
    assert rules(two) == {"meaning-examples"}
    examples = {"Context": "Der <b>Zug</b> kommt um acht.<br>Das war ein guter <b>Zug</b>.",
                "ContextTranslation": "The train comes at eight.<br>That was a good move.", "ContextLabels": "train<br>move"}  # fmt: skip
    assert o.problems({**two, **examples}) == []
    assert "meaning-examples" in rules({**two, **examples, "Meaning": "1. train<br>2. move<br>3. draft (of air)"})
    # Four senses is a dictionary entry, not a card; so is a sense with four glosses.
    assert "meaning-many" in rules({**base, "Meaning": "1. train<br>2. move<br>3. draft<br>4. platoon"})
    assert "meaning-many" in rules({**base, "Meaning": "train; move; draft; platoon"})
    assert "meaning-many" not in rules({**base, "Meaning": "1. train; railway train; rail service<br>2. move"})


def test_an_article_stays_when_it_disagrees_with_the_gender_on_purpose():
    agua = {"Entry": "el agua", "Meaning": "water", "Language": "spanish", "Register": "neutral", "PartOfSpeech": "noun", "Gender": "f"}
    assert "entry-article" not in rules(agua)
    # With no Gender to go by, "el" before a stressed a could be either: said, but not fixed.
    unknown = [p for p in o.problems({**agua, "Gender": ""}) if p.rule == "entry-article"]
    assert unknown and unknown[0].fix is None
    ficha = o.fix({**agua, "Entry": "la ficha", "Gender": ""})
    assert ficha.fields["Entry"] == "ficha" and ficha.fields["Gender"] == "f"
    # A phrase that happens to start with an article is left alone.
    assert "entry-article" not in rules({**agua, "Entry": "la verdad es que", "PartOfSpeech": "phrase", "Gender": ""})


def test_an_aspect_pair_moves_to_its_own_field_with_a_label_for_each_example():
    pair = {
        "Entry": "добавлять / добавить", "Meaning": "to add", "Language": "russian", "Register": "neutral", "PartOfSpeech": "verb",
        "Context": "Он <b>добавлял</b> соль.<br><br>Она <b>добавила</b> соль.", "ContextTranslation": "He was adding salt.<br><br>She added salt.",
        "KeyForms": "добавляю, добавляешь",
    }  # fmt: skip
    fixed = o.fix(pair).fields
    assert (fixed["Entry"], fixed["AspectPartner"]) == ("добавлять", "добавить")
    assert fixed["Context"] == "Он <b>добавлял</b> соль.<br>Она <b>добавила</b> соль."
    assert fixed["ContextTranslation"] == "He was adding salt.<br>She added salt."
    assert fixed["ContextLabels"] == "imperfective<br>perfective"
    assert fixed["KeyForms"] == "I: добавляю<br>you: добавляешь"
    assert [(p.rule, p.level) for p in o.problems(fixed)] == [("pattern-missing", "gap")]
    # A slash in another language's Entry, or in a Polish noun, is not an aspect pair.
    assert "entry-aspect-pair" not in rules({**pair, "PartOfSpeech": "noun"})


def test_commas_between_glosses_are_split_only_when_that_is_plainly_what_they_are():
    base = {"Entry": "x", "Language": "greek", "Register": "neutral", "Context": "<b>x</b>.", "ContextTranslation": "x."}
    assert o.fix({**base, "PartOfSpeech": "verb", "Meaning": "to invite, to call"}).fields["Meaning"] == "to invite; to call"
    assert o.fix({**base, "PartOfSpeech": "adjective", "Meaning": "calm, quiet (of the sea, of a person)"}).fields["Meaning"] == "calm; quiet (of the sea, of a person)"
    for unsure in ({"PartOfSpeech": "phrase", "Meaning": "well, yes"}, {"PartOfSpeech": "verb", "Meaning": "can, to be able"},
                   {"PartOfSpeech": "adjective", "Meaning": "done (cooked), complete, or as an intensifier"}):  # fmt: skip
        found = [p for p in o.problems({**base, **unsure}) if p.rule.startswith("meaning-commas")]
        assert [(p.rule, p.level, p.fix) for p in found] == [("meaning-commas-check", "review", None)]


def test_a_wanikani_meaning_is_lowercased_but_keeps_its_names():
    note = {"Entry": "月曜日", "Meaning": "Monday, First Day Of The Week", "Language": "japanese", "Register": "neutral", "PartOfSpeech": "noun"}
    assert o.fix(note, ["wanikani"]).fields["Meaning"] == "Monday; first day of the week"
    assert o.fix({**note, "Meaning": "Alone, One Person"}, ["wanikani"]).fields["Meaning"] == "alone; one person"


def test_japanese_notes_need_a_reading_and_a_kanji_breakdown_of_their_own_kanji():
    note = {"Entry": "割り込む", "Meaning": "to cut in", "Language": "japanese", "Register": "neutral", "PartOfSpeech": "verb",
            "KanaReading": "わりこむ", "Hanzi": "割(わ)divide; 込(こ)go into", "VerbClass": "godan",
            "Context": "列に<b>割り込む</b>のはよくない", "ContextTranslation": "It's not good to cut in line."}  # fmt: skip
    assert rules(note) == {"context-end-punctuation"}
    assert o.fix(note).fields["Context"].endswith("のはよくない。")
    assert "kana-missing" in rules({**note, "KanaReading": ""})
    assert "kana-format" in rules({**note, "KanaReading": "わりこむ、ワリコム"})
    assert "kanji-breakdown" in rules({**note, "Hanzi": "割(わ)divide; 掛(か)hang"})
    assert o.fix({**note, "Hanzi": "neutral"}).fields["Hanzi"] == ""
    # A kana-only word has nothing to read out.
    assert "kana-missing" not in rules({**note, "Entry": "びっくり", "KanaReading": "", "Hanzi": ""})


def test_thai_romanization_is_held_to_one_scheme():
    note = {"Entry": "เดินทาง", "Meaning": "to travel", "Language": "thai", "Register": "neutral", "PartOfSpeech": "verb",
            "Transliteration": "dəən-thaang", "Context": "เขา<b>เดินทาง</b>บ่อย", "ContextRomanized": "khǎo dəən-thaang bàwi",
            "ContextTranslation": "He travels often."}  # fmt: skip
    assert o.problems(note) == []
    for wrong in ("dəən-taang", "dɤɤn-thaang", "Dəən-thaang", "dəən-thɯang", "pai", "kin"):
        assert "romanization-letters" in rules({**note, "Transliteration": wrong}), wrong
    assert "romanization-missing" in rules({**note, "ContextRomanized": ""})
    # Russian and Greek notes carry none.
    assert "romanization-unneeded" in rules({"Entry": "дом", "Language": "russian", "Transliteration": "dom"})


def test_several_examples_need_a_label_each():
    two = {**GERMAN_NOUN, "Sense": "a setting, or an attitude", "Context": "Die <b>Einstellungen</b> sind im Menü.<br>Seine <b>Einstellung</b> ist gut.",
           "ContextTranslation": "The settings are in the menu.<br>His attitude is good."}  # fmt: skip
    assert "context-labels" in rules(two)
    assert "context-labels" not in rules({**two, "ContextLabels": "setting<br>attitude"})
    assert "context-labels" in rules({**two, "ContextLabels": "setting<br>attitude<br>extra"})


def test_grammar_a_finished_note_carries_is_a_gap_not_a_refusal():
    verb = {"Entry": "werfen", "Meaning": "to throw", "Language": "german", "Register": "neutral", "PartOfSpeech": "verb",
            "Context": "Er <b>wirft</b> den Ball.", "ContextTranslation": "He throws the ball."}  # fmt: skip
    gaps = {p.field for p in o.problems(verb) if p.level == "gap"}
    assert gaps == {"KeyForms", "VerbClass", "Auxiliary"}
    ready = o.prepare(verb)
    assert ready.refused == [] and len(ready.gaps) == 3 and "a pattern: line" in ready.gaps[0]
    assert "verbclass-unknown" in rules({**verb, "VerbClass": "irregular"})
    assert "auxiliary-unknown" in rules({**verb, "Auxiliary": "werden"})
    masculine = {**GERMAN_NOUN, "Entry": "Tisch", "Gender": "m", "Plural": "Tische"}
    assert {p.field for p in o.problems(masculine) if p.level == "gap"} == {"Genitive"}


def test_a_new_note_is_tidied_and_refused_for_what_only_its_writer_can_fix():
    ready = o.prepare({"Entry": "la ficha", "Meaning": "a token / an index card", "Language": "Spanish", "Gender": "F",
                       "PartOfSpeech": "noun", "Register": "Neutral", "Context": "Dame <strong>la ficha</strong>.",
                       "ContextTranslation": "Give me the token.", "GenerateReverse": "yes"}, ["noun", "travel"])  # fmt: skip
    assert ready.refused == []
    assert ready.fields["Entry"] == "ficha" and ready.fields["Meaning"] == "token; index card"
    assert ready.fields["Context"] == "Dame <b>la ficha</b>." and ready.fields["GenerateReverse"] == "y"
    assert ready.tags == ["travel"] and len(ready.tidied) == 6
    # Two senses with one example between them: refused, with the count.
    senses = o.prepare({**ready.fields, "Meaning": "1. token<br>2. index card"}, ["travel"])
    assert "2 senses, 1 example" in " ".join(senses.refused)

    bad = o.prepare({"Entry": "ficha", "Meaning": "token", "Language": "spanish", "PartOfSpeech": "thing", "Register": "posh",
                     "Context": "Dame la ficha.", "Notes": "a token — not a file", "Pronunciation": "ˈfitʃa"})  # fmt: skip
    said = " ".join(bad.refused)
    for expected in ("PartOfSpeech is one value from", "Register is one of", "Put the word in <b></b>", "No em dashes",
                     "Translate the example", "A Spanish noun needs Gender" if False else "between slashes"):  # fmt: skip
        assert expected in said, expected


def test_an_update_is_checked_only_for_the_fields_it_writes():
    old = {"Entry": "<b>halten von</b>", "Meaning": "1. to think of", "Language": "german", "Register": "", "PartOfSpeech": "",
           "Context": "Ich halte viel von Dieter", "ContextTranslation": ""}  # fmt: skip
    # Correcting the translation of a note that breaks other rules goes through, and touches nothing else.
    ready = o.prepare({"ContextTranslation": "I think a lot of Dieter."}, existing=old)
    assert ready.refused == [] and ready.fields == {"ContextTranslation": "I think a lot of Dieter."}
    # The field it does write is held to its rule, and tidied where that needs no judgment.
    assert o.prepare({"Meaning": "to think of / to rate"}, existing=old).fields == {"Meaning": "to think of; to rate"}
    assert "Register is one of" in " ".join(o.prepare({"Register": "posh"}, existing=old).refused)
    assert "Put the word in <b></b>" in " ".join(o.prepare({"Context": "Er hält nichts davon."}, existing=old).refused)


def test_a_fix_never_writes_a_field_the_note_type_lacks():
    names = ["Entry", "Meaning", "Language", "PartOfSpeech"]
    ready = o.prepare({"Entry": "добавлять / добавить", "Meaning": "to add", "Language": "russian", "PartOfSpeech": "verb"}, field_names=names)
    assert "AspectPartner" not in ready.fields and ready.fields["Entry"] == "добавлять / добавить"
    # Rules about fields it lacks (Register, Context) don't refuse it either.
    assert all(line.split(":")[0] in names for line in ready.refused)


def test_the_english_deck_keeps_its_definitions():
    word = {"Entry": "plangent", "Meaning": "Loud and resonant, with a mournful tone.", "Language": "english", "Register": "literary",
            "PartOfSpeech": "adjective", "Context": "The <b>plangent</b> toll of the bell carried across the square."}  # fmt: skip
    assert o.problems(word) == []


def test_the_guide_gives_a_languages_rules_values_and_a_finished_note():
    thai = o.guide("Thai")
    assert thai["language"] == "thai" and "dt" in thai["this_language"] and "Register" in thai["values"]
    german = o.guide("deutsch")
    assert german["values"]["VerbClass"] == ["mixed", "strong", "weak"] and german["values"]["Auxiliary"] == ["haben", "sein"]
    # Every finished note the guide shows passes its own rules.
    for name, example in {**o.EXAMPLES, "several senses": o.SEVERAL_SENSES}.items():
        assert [p for p in o.problems(example) if p.level != "gap"] == [], name
    assert german["example_with_several_senses"]["Meaning"].startswith("1. ")
    # Sense flags a word that covers only some of its gloss's senses, and is not written beside numbered senses.
    assert "Sense: only when the word covers some, not all" in german["every_note"]
    assert "Sense is no longer written" not in german["every_note"]
    assert "No rules beyond the common ones" in o.guide("italian")["this_language"]


POLISH_TABLE = ("nominative · singular: ogród<br>nominative · plural: ogrody<br>genitive · singular: ogrodu<br>"
                "genitive · plural: ogrodów<br>locative · singular: ogrodzie<br>instrumental · plural: ogrodami")  # fmt: skip


def test_every_key_form_says_which_form_it_is():
    noun = {"Entry": "ogród", "Meaning": "garden", "Language": "polish", "Register": "neutral", "PartOfSpeech": "noun", "Gender": "m",
            "Context": "W <b>ogrodzie</b> rosną jabłka.", "ContextTranslation": "Apples grow in the garden.", "Forms": POLISH_TABLE}  # fmt: skip
    labeled = {**noun, "KeyForms": "pattern: Masculine inanimate. The ó becomes o.<br>genitive: ogrodu<br>plural: ogrody<br>takes: w + locative (w ogrodzie)"}
    assert o.problems(labeled) == []
    # A bare form is refused; a label nobody defined is too; a note with no pattern line is told so, not refused.
    assert "keyforms-unlabeled" in rules({**noun, "KeyForms": "ogrodu"})
    assert "keyforms-label" in rules({**noun, "KeyForms": "pattern: x<br>second case: ogrodu"})
    missing = [p for p in o.problems({**noun, "KeyForms": "genitive: ogrodu<br>plural: ogrody"}) if p.rule == "pattern-missing"]
    assert [p.level for p in missing] == ["gap"]
    assert "pattern-missing" not in rules({"Entry": "กลับ", "Language": "thai", "PartOfSpeech": "verb"})


def test_an_older_notes_key_forms_are_labeled_from_its_own_table_or_its_languages_order():
    def relabel(language, pos, text, gender="", table=""):
        return o.label_key_forms(o.LANGUAGES[language], pos, gender, [text], table)

    # A Polish noun: each form the note chose is found in its table, and the genitive and plural lead.
    assert relabel("polish", "noun", "ogrodu", "m", POLISH_TABLE) == "genitive: ogrodu<br>plural: ogrody"
    assert relabel("polish", "noun", "ogrodu, ogrodzie, ogrody", "m", POLISH_TABLE) == "genitive: ogrodu<br>plural: ogrody<br>locative: ogrodzie"
    assert relabel("polish", "noun", "ogrodów", "m", POLISH_TABLE) == "genitive: ogrodu<br>plural: ogrody<br>genitive plural: ogrodów"
    assert relabel("polish", "noun", "spodni", "pl", "nominative · plural: spodnie<br>genitive · plural: spodni") == "genitive: spodni"
    # A form its table doesn't have, or a noun with no table, waits for a reader.
    assert relabel("polish", "noun", "ogrodu, ogrodem", "m", POLISH_TABLE) is None
    assert relabel("polish", "noun", "inżyniera, inżynierowie", "m") is None
    # Verbs go by the order their language's notes were written in.
    assert relabel("german", "verb", "warf ab") == "past: warf ab"
    assert relabel("german", "verb", "fuhr los, ist losgefahren") == "past: fuhr los<br>perfect: ist losgefahren"
    assert relabel("german", "verb", "bat / gebeten") == "past: bat<br>participle: gebeten"
    assert relabel("greek", "verb", "αντιπάθησα") == "past: αντιπάθησα"
    assert relabel("norwegian", "verb", "tømmer / tømte / tømt") == "present: tømmer<br>past: tømte<br>participle: tømt"
    assert relabel("norwegian", "phrase", "går seg vill / gikk seg vill / gått seg vill") == "present: går seg vill<br>past: gikk seg vill<br>participle: gått seg vill"
    assert relabel("norwegian", "phrase", "god dag") is None
    assert relabel("polish", "verb", "jem, jesz, zjem") == "I: jem<br>you: jesz<br>perfective I: zjem"
    assert relabel("russian", "verb", "выгляжу, выглядишь") == "I: выгляжу<br>you: выглядишь"
    assert relabel("russian", "verb", "различаю / различу") == "I: различаю<br>perfective I: различу"
    assert relabel("russian", "verb", "добиваюсь") == "I: добиваюсь"
    for unsure in (("polish", "verb", "idę, idziesz, pójdę, szedł"), ("russian", "verb", "сокращу (pfv., т→щ)"), ("russian", "verb", "послышится"),
                   ("russian", "verb", "пеку, печёшь, пекут"), ("polish", "pronoun", "kogoś, kimś")):  # fmt: skip
        assert relabel(*unsure) is None, unsure
    # Through the fixes, and a labeled field is left as it is.
    fixed = o.fix({"Entry": "abwerfen", "Language": "german", "PartOfSpeech": "verb", "KeyForms": "warf ab, hat abgeworfen"}, rules=["keyforms-unlabeled"])
    assert fixed.fields["KeyForms"] == "past: warf ab<br>perfect: hat abgeworfen"
    assert o.fix(fixed.fields, rules=["keyforms-unlabeled"]).applied == []


def test_quick_add_labels_its_key_forms_with_labels_from_the_list():
    # Read & Listen's note queue writes KeyForms too (server/reader), in another package: its labels are read off its source.
    source = (Path(__file__).parents[2] / "reader" / "src" / "franki_reader" / "note_queue.py").read_text()
    labels = set(re.findall(r'_form\(\s*"\w+",\s*"([^"]+)"', source)) | set(re.findall(r'label="([^"]+)"', source))
    assert {"pattern", "past", "genitive", "I"} <= labels
    assert {label.lower() for label in labels} <= set(o.FORM_LABELS)


def test_a_norwegian_verb_is_stored_bare_and_a_phrase_keeps_its_marker():
    verb = {"Entry": "å huske", "Meaning": "to remember", "Language": "norwegian", "Register": "neutral", "PartOfSpeech": "verb"}
    assert o.fix(verb, rules=["entry-infinitive-marker"]).fields["Entry"] == "huske"
    # The card puts å back before a verb only, so a phrase's stays in its Entry.
    assert "entry-infinitive-marker" not in rules({**verb, "Entry": "å gå seg vill", "PartOfSpeech": "phrase"})
    assert "entry-infinitive-marker" not in rules({**verb, "PartOfSpeech": ""})


def test_an_example_sentence_keeps_its_own_dashes_and_a_note_about_the_word_does_not():
    note = {"Entry": "исход", "Meaning": "outcome", "Language": "russian", "Register": "neutral", "PartOfSpeech": "noun", "Gender": "m",
            "Context": "Наиболее вероятный <b>исход</b> — это компромисс.", "ContextTranslation": "The most likely outcome — a compromise."}  # fmt: skip
    assert "em-dash" not in rules(note)
    assert "em-dash" in rules({**note, "Notes": "formal — mostly written"})
    assert "em-dash" in rules({**note, "Meaning": "outcome — result"})


def test_a_word_with_no_such_form_says_so_with_a_dash():
    ruhm = {**GERMAN_NOUN, "Entry": "Ruhm", "Meaning": "fame", "Gender": "m", "Plural": o.NO_FORM, "Genitive": "des Ruhmes",
            "Context": "Sein <b>Ruhm</b> ist groß.", "ContextTranslation": "His fame is great."}  # fmt: skip
    assert o.problems(ruhm) == []
    assert "grammar-gap" in rules({**ruhm, "Plural": ""})
    assert 'holds "-"' in o.guide("german")["every_note"]
