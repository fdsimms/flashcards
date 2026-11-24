"""
The Omnilanguage note type's house style, in code: what each field holds, per language, the checks
that say where a note departs from it, and the fixes that need no judgment.

One definition, read three ways. `prepare` runs when the MCP writes a note (`add_notes`,
`update_notes`): it applies the fixes, and names what's left for Claude to correct. `problems` runs
over notes already in the collection (`lint_notes`). `guide` is the same rules as prose, for Claude to
read before writing a note (`note_guide`). A rule that exists in only one of the three drifts, which
is how ten languages came to write a Meaning four ways.

Pure: fields and tags in, problems out. Nothing here touches Anki.

A problem's level says who acts on it:
- "format": the value breaks the field's format. Refused on write, unless a fix settles it.
- "required": a field every note of its kind carries is empty. Refused on a new note.
- "gap": grammar a finished note carries (a plural, an auxiliary) that is still to fill. Reported, never refused.
- "review": a person or Claude has to read it (commas that may be inside one gloss). Lint reports it; a write
  says so too for the rules in WARN_ON_WRITE, and saves the note anyway.
"""

from __future__ import annotations

import html
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from franki_speech.icons import icon_drawing, similar_names, tabler_name_of
from franki_speech.thai_romanization import (
    LETTERS_ADVICE, THAI_SCHEME, TONELESS_ADVICE, is_toneless, letters_wrong, tone_mismatch,
)

NOTE_TYPE = "Omnilanguage"

PARTS_OF_SPEECH = (
    "noun", "proper noun", "verb", "adjective", "adverb", "pronoun", "determiner", "numeral", "preposition",
    "conjunction", "particle", "classifier", "interjection", "prefix", "suffix", "phrase",
)  # fmt: skip
# Other spellings notes have used, and the one they become.
POS_RENAMES = {"number": "numeral", "counter": "classifier", "expression": "phrase", "proper-noun": "proper noun",
               "idiom": "phrase", "article": "determiner"}  # fmt: skip
# A tag that names a part of speech, and the PartOfSpeech it stands for.
TAG_POS = {**{p: p for p in PARTS_OF_SPEECH if " " not in p}, **POS_RENAMES}

REGISTERS = ("neutral", "casual", "formal", "literary", "technical", "slang", "vulgar", "dated")
REGISTER_RENAMES = {"informal": "casual", "colloquial": "casual", "familiar": "casual", "archaic": "dated"}

SWITCHES = ("GenerateReverse", "GenerateAudioCard", "SuppressFrontCard")
# Fields whose text is one value from a list: stored lowercase, with no markup.
LIST_FIELDS = ("Language", "Register", "PartOfSpeech", "Gender", "VerbClass", "Auxiliary")
# Fields no rule reads for punctuation: machine-written tables and file names.
NOT_PROSE = frozenset({"Audio", "Forms", "Pronunciation", "Stress", "Icon", *SWITCHES})

# What an emoji is made of: the pictographs, with the joiner, variation selector, skin tones and
# flag letters that build one out of several code points. Read & Listen's note queue checks an
# Icon the same way (`is_emoji`, server/reader/src/franki_reader/note_queue.py).
_EMOJI = re.compile(
    "(?:[\u2190-\u21ff\u2300-\u23ff\u2460-\u27bf\u2900-\u297f\u2b00-\u2bff\u3030\u303d\u3297\u3299"
    "\U0001f000-\U0001faff]|[\u200d\ufe0f\u20e3]|[\U0001f3fb-\U0001f3ff]|[\U0001f1e6-\U0001f1ff])+"
)
MAX_ICON_CODEPOINTS = 8


def is_emoji(value: str) -> bool:
    """Whether `value` is one emoji and nothing else: at most a few code points, all of them an
    emoji's, with a pictograph among them."""
    return (
        0 < len(value) <= MAX_ICON_CODEPOINTS
        and _EMOJI.fullmatch(value) is not None
        and any(ch not in "\u200d\ufe0f\u20e3" for ch in value)
    )

# A picture for a thing no emoji shows exactly is a Tabler icon (franki_speech.icons), stored as its
# path data, which src/core/noteIcon.ts draws. Written `tabler:umbrella`, which `fix` turns into that
# path data. Never a drawing made up for the note: a picture has to be exactly the thing.
TABLER_PREFIX = "tabler:"

# An example sentence keeps its own language's punctuation (Russian's dash for "is", a French dialogue
# dash), and its translation follows it: the no-em-dash rule is for the notes written about a word.
SENTENCES = frozenset({"Context", "ContextRomanized", "ContextTranslation", "ContextLiteral", "Source"})
NO_FORM = "-"  # a grammar field of a word that has no such form (no plural, never counted, no aspect partner)

MAX_SENSES = 3  # distinct senses a Meaning numbers
MAX_GLOSSES = 3  # glosses to one sense
MAX_MEANING = 80
MAX_CONTRAST_WORDS = 2  # words SenseContrast gives for one excluded sense


@dataclass(frozen=True)
class Language:
    """What a language's notes carry beyond the common fields."""

    name: str
    genders: frozenset[str] = frozenset()
    # The singular article that goes before a noun, and the gender it marks: the card adds it from Gender.
    articles: Mapping[str, str] = field(default_factory=dict)
    noun: tuple[str, ...] = ()  # grammar fields a noun carries
    verb: tuple[str, ...] = ()  # grammar fields a verb carries
    verb_classes: frozenset[str] = frozenset()
    auxiliaries: frozenset[str] = frozenset()
    romanized: bool = False  # Transliteration and ContextRomanized are written
    key_forms: str = ""  # what KeyForms holds, for the guide
    aspect_pairs: bool = False
    definition: bool = False  # Meaning is a definition sentence (the English deck), not glosses


_MFN = frozenset({"m", "f", "n", "m/f", "m pl", "f pl", "n pl"})
_MF = frozenset({"m", "f", "m/f", "m pl", "f pl"})

LANGUAGES: dict[str, Language] = {
    "thai": Language("thai", noun=("Classifier",), romanized=True),
    "spanish": Language("spanish", genders=_MF, articles={"el": "m", "la": "f"}),
    "french": Language("french", genders=_MF, articles={"le": "m", "la": "f"}, verb=("Auxiliary",),
                       auxiliaries=frozenset({"avoir", "être"}),
                       key_forms="for a verb with an irregular one, participle: pris"),
    "german": Language("german", genders=_MFN, articles={"der": "m", "die": "f", "das": "n"}, noun=("Plural",),
                       verb=("KeyForms", "VerbClass", "Auxiliary"), verb_classes=frozenset({"strong", "weak", "mixed"}),
                       auxiliaries=frozenset({"haben", "sein"}),
                       key_forms="for a verb, past: warf ab and perfect: hat abgeworfen, with he, she: wirft ab first when the vowel changes"),
    "greek": Language("greek", genders=_MFN, articles={"ο": "m", "η": "f", "το": "n"}, noun=("Plural",),
                      verb=("KeyForms", "VerbClass"), verb_classes=frozenset({"active", "deponent", "passive"}),
                      key_forms="for a verb, past: αντιπάθησα (the aorist)"),
    "norwegian": Language("norwegian", genders=frozenset({"m", "f", "n"}), articles={"en": "m", "ei": "f", "et": "n"},
                          noun=("Plural",), verb=("KeyForms",),
                          key_forms="for a verb, present: tømmer, past: tømte, participle: tømt"),
    "russian": Language("russian", genders=frozenset({"m", "f", "n", "pl"}), noun=("KeyForms",),
                        verb=("AspectPartner", "KeyForms"), aspect_pairs=True,
                        key_forms="for a noun, genitive: стола and plural: столы; for a verb, I: добиваюсь and you: добиваешься "
                                  "(present, or the future of a perfective)"),
    "polish": Language("polish", genders=frozenset({"m", "f", "n", "pl", "mpl"}), noun=("KeyForms",),
                       verb=("AspectPartner", "KeyForms"), aspect_pairs=True,
                       key_forms="for a noun, genitive: mężczyzny and plural: mężczyźni; for a verb, I: mam and you: masz "
                                 "(present, or the future of a perfective)"),
    "japanese": Language("japanese", verb=("VerbClass",),
                         verb_classes=frozenset({"godan", "ichidan", "suru", "irregular"})),
    "english": Language("english", definition=True),
}  # fmt: skip
# What the Language field may say for each (the names `speechLangFor` reads in src/core/cards.ts).
LANGUAGE_NAMES = {
    **{name: name for name in LANGUAGES},
    "ภาษาไทย": "thai", "español": "spanish", "espanol": "spanish", "français": "french", "francais": "french",
    "deutsch": "german", "ελληνικά": "greek", "norsk": "norwegian", "русский": "russian", "polski": "polish",
    "日本語": "japanese",
}  # fmt: skip

# What a rule is about, for lint's report and the guide. A rule with a fix says so in `fixable`.
RULES: dict[str, str] = {
    "entry-markup": "Entry has markup or stray spaces",
    "entry-article": "Entry starts with the article that Gender already gives",
    "entry-infinitive-marker": 'A Norwegian verb\'s Entry starts with "å", which the card adds',
    "entry-aspect-pair": "Entry holds an aspect pair; the partner belongs in AspectPartner",
    "entry-brackets": "Entry has a bracketed preposition or note",
    "meaning-markup": "Meaning has markup or HTML entities",
    "meaning-numbered": "Meaning's numbers are not one numbered line per distinct sense",
    "meaning-lines": "Meaning has several lines without numbers",
    "meaning-slashes": 'A sense joins its glosses with " / "',
    "meaning-commas": "A sense joins its glosses with commas",
    "meaning-commas-check": "Meaning has a comma that may join two glosses or sit inside one",
    "meaning-article": 'A noun\'s gloss starts with "a" or "the"',
    "meaning-title-case": "Meaning is in Title Case",
    "meaning-verb-to": 'A verb\'s first gloss does not start with "to"',
    "meaning-many": f"More than {MAX_SENSES} senses, or more than {MAX_GLOSSES} glosses to a sense",
    "meaning-examples": "A numbered sense without an example of its own",
    "meaning-long": f"A sense is longer than {MAX_MEANING} characters",
    "sense-names-gloss": "Sense says which gloss it is about, so Meaning may hold two senses on one line",
    "sense-has-entry": "Sense contains the Entry, which the reverse card shows on its front",
    "contrast-format": 'SenseContrast is not one "english sense = word" pair per line',
    "sense-restates-meaning": "Sense restates the Meaning's glosses instead of saying what the word does not cover",
    "context-missing": "No example sentence",
    "context-markup": "Context has markup other than <b> and <br>",
    "context-no-bold": "The word is not in bold in Context",
    "context-bold-unbalanced": "Context's <b> tags do not pair up",
    "context-labels": "Several examples without a matching ContextLabels line for each",
    "context-end-punctuation": "A Japanese example with no 。",
    "translation-missing": "No translation of the example",
    "literal-redundant": "ContextLiteral says the same as ContextTranslation",
    "source-markup": "Source has markup other than <b> and <br>",
    "source-lines": "Source is not the line, its translation and where it was met, one to a line",
    "source-no-bold": "The word isn't in <b></b> in Source's line",
    "switch-value": "A card switch holds something other than y",
    "register-missing": "Register is empty",
    "register-unknown": "Register is not one of the list",
    "pos-missing": "PartOfSpeech is empty",
    "pos-unknown": "PartOfSpeech is not one of the list",
    "pos-in-tags": "A tag repeats the part of speech",
    "source-tag": "A source:: tag is not the title in lowercase words joined by hyphens",
    "language-missing": "Language is empty",
    "gender-missing": "A noun without Gender",
    "gender-unknown": "Gender is not a value this language uses",
    "romanization-missing": "A Thai note without its romanization",
    "romanization-letters": "A romanization outside the deck's scheme",
    "romanization-toneless": "A Thai example romanization with no tone marks",
    "romanization-tone-mismatch": "A Thai transliteration whose tone marks disagree with the Pronunciation",
    "romanization-unneeded": "A romanization in a language that is not romanized",
    "kana-missing": "A word with kanji and no KanaReading",
    "kana-format": "KanaReading is not one reading in kana",
    "kanji-breakdown": "The kanji breakdown lists something that is not in the Entry",
    "grammar-gap": "A grammar field this kind of word carries is empty",
    "keyforms-unlabeled": "KeyForms has a form with nothing saying which form it is",
    "keyforms-label": "KeyForms uses a label that is not one of the list",
    "pattern-missing": "No line saying what kind of word it is",
    "genitive-feminine": "A German feminine noun has a Genitive, which never differs from the nominative",
    "verbclass-unknown": "VerbClass is not a value this language uses",
    "auxiliary-unknown": "Auxiliary is not a value this language uses",
    "pronunciation-format": "Pronunciation is not IPA between slashes or brackets",
    "icon-format": "Icon is neither one emoji nor a Tabler icon",
    "icon-tabler-name": "Icon is a Tabler icon's name, not its path data",
    "pronunciation-castilian": "Spanish IPA with Castilian θ",
    "em-dash": "An em dash",
    "notes-already-known": 'Notes says "already known"',
}


@dataclass(frozen=True)
class Problem:
    rule: str
    field: str
    level: str  # "format", "required", "gap" or "review"
    message: str  # what to change, written for whoever fixes it
    # The fix that needs no judgment: field name to new value ("tags" to the full tag list, space separated).
    fix: Mapping[str, str] | None = None


# ---- text helpers ----

_TAG = re.compile(r"<[^>]+>")
# Anki's editor writes a second line as "first<div>second</div>": the opening tag ends the line before it too.
_BREAK = re.compile(r"<\s*br\s*/?>|</?(?:div|p)\b[^>]*>", re.IGNORECASE)
_KANJI = re.compile(r"[一-鿿々]")
_KANA_ONLY = re.compile(r"^[ぁ-ゟ゠-ヿー]+$")


def loose_spelling(text: str) -> str:
    """`text` as the app's `norm` compares a word (src/tools/skillWords.ts): Russian ё as е, and
    Greek's tone marks off, since decks and screens write четвертый and μια as often as четвёртый and
    μία. Other accents stay (Polish ę, ł and ś are letters of their own). Case is left as given."""
    decomposed = unicodedata.normalize("NFD", text.replace("ё", "е").replace("Ё", "Е"))
    out: list[str] = []
    base = ""
    for ch in decomposed:
        if "\u0300" <= ch <= "\u036f":
            if "\u0370" <= base <= "\u03ff":
                continue
        else:
            base = ch
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def plain(value: str) -> str:
    """A field's HTML as text: a line break for <br> and wherever a <div> or <p> opens or closes, tags dropped, entities read."""
    text = _TAG.sub("", _BREAK.sub("\n", value or ""))
    text = re.sub(r"[ \t]*\n\s*", "\n", html.unescape(text).replace("\xa0", " "))
    return text.strip()


def source_tag(title: str) -> str:
    """The tag for words met in `title` (a game, a show, a book), as the house style writes it: lowercase, words joined by hyphens."""
    words = re.split(r"[\s_\-]+|::", title.strip().lower())
    return "source::" + "-".join(w for w in words if w)


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _lines(value: str) -> list[str]:
    return [line.strip() for line in plain(value).split("\n") if line.strip()]


def split_top(text: str, separator: str) -> list[str]:
    """`text` split on `separator` wherever it is outside brackets: a bracket's own commas stay with it."""
    parts, depth, current, i = [], 0, "", 0
    while i < len(text):
        ch = text[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if depth == 0 and text.startswith(separator, i):
            parts.append(current)
            current = ""
            i += len(separator)
            continue
        current += ch
        i += 1
    parts.append(current)
    return [p.strip() for p in parts if p.strip()]


_NUMBER = re.compile(r"^\d+[.)]\s+")  # a sense's number at the start of its line: "1. " or "1) "


def senses(meaning: str) -> list[str]:
    """A Meaning's distinct senses, each without its number: the numbered lines, or the one line a
    word with one sense has. Numbers written along one line ("1. hook 2. catch") are read as lines."""
    text = plain(meaning)
    if _NUMBER.match(text):
        text = re.sub(r"\s+(?=\d+[.)]\s)", "\n", text)
    return [item for item in (_NUMBER.sub("", line.strip(), count=1).strip() for line in text.split("\n")) if item]


_STOP = frozenset("or and to a an the of in for as be on at by with from is are e g".split())
_EXCLUDES = re.compile(r"\b(?:not|never|without|rather than|instead of)\b|n't\b", re.IGNORECASE)


def _gloss_words(text: str) -> set[str]:
    """The content words of an English line, lightly stemmed, for comparing a Sense with a Meaning."""
    words = set()
    for word in re.findall(r"[a-z]+", text.lower()):
        if word in _STOP:
            continue
        words.add(re.sub(r"(?:ing|ed|es|s)$", "", word) if len(word) > 4 else word)
    return words


def sense_restates_meaning(meaning: str, sense: str) -> bool:
    """Whether a Sense only repeats the Meaning. A Sense earns its place by saying what the word does not
    cover ("hot in temperature, not spicy"), so one with no exclusion in it (not, never, without) is
    suspect when at least half its content words are the Meaning's, when it is two glosses joined by
    "or", or when it is a gloss with a colon and a usage note. A fake exclusion ("intelligent, not well
    dressed") still passes: that one needs a person, which is why this is a review rule."""
    sense = plain(sense).replace("\n", " ")
    if not sense or _EXCLUDES.search(sense):
        return False
    mine, theirs = _gloss_words(sense), _gloss_words(plain(meaning))
    overlap = len(mine & theirs) / len(mine) if mine else 0.0
    return overlap >= 0.5 or bool(re.search(r",? or ", sense)) or ":" in sense


def write_senses(items: Sequence[str]) -> str:
    """Senses as the Meaning field stores them: one plain line for one, a numbered line each for several."""
    items = [item for item in items if item]
    if len(items) <= 1:
        return _escape(items[0]) if items else ""
    return "<br>".join(f"{n}. {_escape(item)}" for n, item in enumerate(items, 1))


def language_of(fields: Mapping[str, str]) -> Language | None:
    return LANGUAGES.get(LANGUAGE_NAMES.get(plain(fields.get("Language", "")).lower(), ""))


def part_of_speech(fields: Mapping[str, str], tags: Iterable[str]) -> str:
    """The note's part of speech: the field, else the one tag that names one."""
    said = plain(fields.get("PartOfSpeech", "")).lower()
    said = POS_RENAMES.get(said, said)
    if said:
        return said
    named = {TAG_POS[t] for t in tags if t in TAG_POS}
    return named.pop() if len(named) == 1 else ""


# What a KeyForms line may be labeled. Plain words, not grammar terms, where both would do: "past", not "preterite".
_CASES = ("genitive", "dative", "accusative", "instrumental", "locative", "vocative")
FORM_LABELS = (
    "pattern", "takes",
    *_CASES, "plural", *(f"{case} plural" for case in _CASES),
    "feminine", "neuter", "comparative", "superlative",
    "i", "you", "he, she", "we", "they", "present", "past", "perfect", "participle", "future", "imperative",
    "perfective", "imperfective", "perfective i",
)  # fmt: skip
_LABEL = re.compile(r"^([A-Za-z][A-Za-z ,/()-]{0,28}):\s+\S")


# A noun table's cells, in the order an unlabeled form is looked for: the genitive and the plural before the rest.
_CELL_ORDER = (("genitive", "singular"), ("nominative", "plural"), ("locative", "singular"), ("dative", "singular"),
               ("accusative", "singular"), ("instrumental", "singular"), ("vocative", "singular"),
               *((case, "plural") for case in _CASES))  # fmt: skip


def _cell_label(case: str, number: str, only_plural: bool) -> str:
    """What a table cell is called in KeyForms: "genitive", "plural", "genitive plural". A plural-only noun's cases need no "plural"."""
    if number == "singular" or only_plural:
        return "plural" if case == "nominative" else case
    return "plural" if case == "nominative" else f"{case} plural"


def label_key_forms(lang: Language, pos: str, gender: str, lines: Sequence[str], forms_table: str) -> str | None:
    """An older note's unlabeled KeyForms, each form under its name, or None when which form is which
    can't be told without reading the word. A Polish or Russian noun's come from its own Forms table
    (Wiktionary's, so the label is certain); the rest go by the one order their language's notes were
    written in: a German or Norwegian verb's past first, a Greek verb's aorist, a Polish or Russian verb's I and you."""
    if len(lines) != 1 or _LABEL.match(lines[0]):
        return None
    text = lines[0]
    if pos == "noun" and lang.name in ("polish", "russian"):
        table = {}
        for line in plain(forms_table).split("\n"):
            head, _, form = line.partition(":")
            if form.strip():
                table[tuple(part.strip() for part in head.split("·"))] = form.strip()
        # Each form the note chose keeps its place, under the first cell of the table that holds it.
        only_plural = gender in ("pl", "mpl")
        named: dict[str, str] = {}
        for form in (part.strip() for part in text.split(",")):
            label = next((_cell_label(case, number, only_plural) for case, number in _CELL_ORDER
                          if table.get((case, number)) == form and _cell_label(case, number, only_plural) not in named), None)  # fmt: skip
            if label is None:
                return None
            named[label] = form
        # The two a noun's other forms are worked out from come first, added from the table when the note left one out.
        first = {"genitive": table.get(("genitive", "plural" if only_plural else "singular"))}
        if not only_plural:
            first["plural"] = table.get(("nominative", "plural"))
        ordered = {label: named.get(label) or form for label, form in first.items() if named.get(label) or form}
        ordered.update({label: form for label, form in named.items() if label not in ordered})
        return "<br>".join(f"{label}: {form}" for label, form in ordered.items()) or None
    # A Norwegian verb phrase (å gå seg vill) lists its three forms as a verb does.
    if "(" in text or not (pos == "verb" or (pos == "phrase" and lang.name == "norwegian" and text.count(" / ") == 2)):
        return None
    if lang.name == "greek" and "," not in text and "/" not in text:
        return f"past: {text}"
    if lang.name == "german":
        if m := re.fullmatch(r"([^,/]+), ((?:hat|ist) [^,/]+)", text):
            return f"past: {m.group(1).strip()}<br>perfect: {m.group(2).strip()}"
        parts = [part.strip() for part in text.split(" / ")]
        if len(parts) == 2 and "," not in text:
            return f"past: {parts[0]}<br>participle: {parts[1]}"
        return f"past: {text}" if "," not in text and "/" not in text else None
    if lang.name == "norwegian":
        parts = [part.strip() for part in text.split(" / ")]
        if len(parts) == 3 and "," not in text:
            return f"present: {parts[0]}<br>past: {parts[1]}<br>participle: {parts[2]}"
        return f"past: {text}" if "," not in text and "/" not in text else None
    if lang.name in ("polish", "russian") and "/" not in text:
        parts = [part.strip() for part in text.split(",")]
        if len(parts) == 2:
            return f"I: {parts[0]}<br>you: {parts[1]}"
        if len(parts) == 3 and lang.name == "polish":
            return f"I: {parts[0]}<br>you: {parts[1]}<br>perfective I: {parts[2]}"
    if lang.name == "russian" and "," not in text:
        parts = [part.strip() for part in text.split(" / ")]
        if len(parts) == 2:  # written for an aspect pair: each one's "I"
            return f"I: {parts[0]}<br>perfective I: {parts[1]}"
        if len(parts) == 1 and re.search(r"[юу](?:сь)?$", text):
            return f"I: {text}"
    return None


# Words a Title Cased gloss keeps capitalized.
_PROPER = frozenset(
    "i monday tuesday wednesday thursday friday saturday sunday january february march april may june july august "
    "september october november december japan japanese america american france french england english britain "
    "british brit frenchman china chinese korea korean germany german tokyo kyoto osaka fuji mt mount tv ok".split()
)


def _lower_title(text: str) -> str:
    def word(m: re.Match[str]) -> str:
        w = m.group(0)
        return w if w.lower() in _PROPER or w.isupper() and len(w) > 1 else w.lower()

    return re.sub(r"[A-Za-z][A-Za-z']*", word, text)


# ---- the rules ----


def problems(fields: Mapping[str, str], tags: Sequence[str] = ()) -> list[Problem]:
    """Where a note departs from the house style, most basic first. `fields` is the whole note (field
    name to its HTML); a field the note type lacks is read as empty."""
    raw = lambda name: fields.get(name, "") or ""  # noqa: E731
    txt = lambda name: plain(raw(name))  # noqa: E731
    out: list[Problem] = []

    def add(rule: str, fld: str, level: str, message: str, fix: Mapping[str, str] | None = None) -> None:
        out.append(Problem(rule, fld, level, message, fix))

    lang = language_of(fields)
    pos = part_of_speech(fields, tags)
    gender = txt("Gender").lower()
    entry = re.sub(r"\s+", " ", txt("Entry"))

    # -- lists and switches --
    for name in SWITCHES:
        value = raw(name)
        if value and value != "y":
            on = bool(plain(value))
            add("switch-value", name, "format", f'{name} takes "y" or nothing.', {name: "y" if on else ""})
    if not txt("Language"):
        add("language-missing", "Language", "required", 'Set Language (lowercase English name: "thai", "german").')
    register = txt("Register").lower()
    if not register:
        add("register-missing", "Register", "required",
            f'Set Register: "neutral" for an ordinary word, else one of {", ".join(REGISTERS[1:])}.')  # fmt: skip
    elif register in REGISTER_RENAMES or (register in REGISTERS and raw("Register") != register):
        add("register-unknown", "Register", "format", f'Register is written "{REGISTER_RENAMES.get(register, register)}".',
            {"Register": REGISTER_RENAMES.get(register, register)})  # fmt: skip
    elif register not in REGISTERS:
        add("register-unknown", "Register", "format", f"Register is one of: {', '.join(REGISTERS)}.")
    said = txt("PartOfSpeech").lower()
    if not said:
        add("pos-missing", "PartOfSpeech", "required", f"Set PartOfSpeech to one of: {', '.join(PARTS_OF_SPEECH)}.",
            {"PartOfSpeech": pos} if pos else None)  # fmt: skip
    elif said in POS_RENAMES or (said in PARTS_OF_SPEECH and raw("PartOfSpeech") != said):
        add("pos-unknown", "PartOfSpeech", "format", f'PartOfSpeech is written "{POS_RENAMES.get(said, said)}".',
            {"PartOfSpeech": POS_RENAMES.get(said, said)})  # fmt: skip
    elif said not in PARTS_OF_SPEECH:
        add("pos-unknown", "PartOfSpeech", "format",
            f"PartOfSpeech is one value from: {', '.join(PARTS_OF_SPEECH)}. A verb's class goes in VerbClass.")  # fmt: skip
    elif any(t in TAG_POS for t in tags):
        add("pos-in-tags", "tags", "format", "PartOfSpeech holds the part of speech; tags are for topics and sources.",
            {"tags": " ".join(t for t in tags if t not in TAG_POS)})  # fmt: skip
    # Where a word was met (a game, a show, a book): one tag a title, so check_words and find_notes
    # "tag:source::*" can group its words. Anki compares tags without case, so "Source::Elden_Ring"
    # would quietly be a second spelling of the same tag in the tag list.
    for tag in tags:
        prefix, sep, title = tag.partition("::")
        if sep and prefix.lower() == "source" and tag != source_tag(title):
            add("source-tag", "tags", "format", f'Write the source tag "{source_tag(title)}": the title in lowercase words joined by hyphens.',
                {"tags": " ".join(source_tag(t.partition("::")[2]) if t == tag else t for t in tags)})  # fmt: skip
            break

    # -- Entry --
    if entry != raw("Entry"):
        add("entry-markup", "Entry", "format", "Entry is plain text: no bold, no line breaks.", {"Entry": _escape(entry)})
    if lang and lang.articles and pos != "phrase" and (pos in ("noun", "proper noun") or gender):
        m = re.match(r"(?i)(" + "|".join(map(re.escape, lang.articles)) + r")\s+(\S.*)$", entry)
        elided = lang.name == "french" and re.match(r"(?i)l['’](\S.*)$", entry)
        if m:
            marks, bare = lang.articles[m.group(1).lower()], m.group(2)
            # el agua, el hacha: the article and the gender disagree on purpose, so it stays written out.
            if gender in ("", marks):
                safe = gender or not (lang.name == "spanish" and marks == "m" and re.match(r"(?i)h?[aá]", bare))
                add("entry-article", "Entry", "format",
                    f'Write the bare noun ("{bare}"): the card puts the article in front from Gender.',
                    {"Entry": _escape(bare), **({} if gender else {"Gender": marks})} if safe else None)  # fmt: skip
        elif elided and gender:
            add("entry-article", "Entry", "format",
                f'Write the bare noun ("{elided.group(1)}"): the card puts the article in front from Gender.',
                {"Entry": _escape(elided.group(1))})  # fmt: skip
    # Only a verb's: the card puts å back before a verb, and nothing would put it back before a phrase.
    if lang and lang.name == "norwegian" and pos == "verb" and entry.startswith("å "):
        add("entry-infinitive-marker", "Entry", "format", 'Write the bare verb: the card puts "å" before a Norwegian verb.',
            {"Entry": _escape(entry[2:])})  # fmt: skip
    if lang and lang.aspect_pairs and " / " in entry and pos == "verb":
        first, _, second = entry.partition(" / ")
        fix = {"Entry": _escape(first)}
        if not txt("AspectPartner"):
            fix["AspectPartner"] = _escape(second)
        for name in ("Context", "ContextTranslation"):
            if "<br><br>" in raw(name):
                fix[name] = raw(name).replace("<br><br>", "<br>")
        if len(_lines(raw("Context"))) == 2 and not txt("ContextLabels"):
            fix["ContextLabels"] = "imperfective<br>perfective"
        add("entry-aspect-pair", "Entry", "format",
            f'One verb per Entry: write "{first}" and put "{second}" in AspectPartner.', fix)  # fmt: skip
    if "(" in entry:
        add("entry-brackets", "Entry", "format",
            "No brackets in Entry: a verb's fixed preposition follows it bare (zweifeln an); anything else goes in Notes.")  # fmt: skip

    # -- Meaning --
    meaning = txt("Meaning")
    numbered: list[str] = []
    if meaning and not (lang and lang.definition):
        lines = [line.strip() for line in meaning.split("\n") if line.strip()]
        items = senses(raw("Meaning"))
        stored = [f"{n}. {item}" for n, item in enumerate(items, 1)] if len(items) > 1 else items
        numbered = items if len(items) > 1 else []
        gloss_lists = [split_top(item, ";") for item in items]
        if re.search(r"<(?!\s*br\b)[^>]+>|&nbsp;|&#x?[0-9a-f]+;|&quot;", raw("Meaning"), re.IGNORECASE):
            add("meaning-markup", "Meaning", "format", "Meaning is plain text.", {"Meaning": "<br>".join(_escape(line) for line in lines)})
        elif lines != stored and not any(_NUMBER.match(line) for line in lines):
            add("meaning-lines", "Meaning", "format", "Number each distinct sense on its own line (1. 2. 3.).", {"Meaning": write_senses(items)})
        elif lines != stored:
            add("meaning-numbered", "Meaning", "format",
                "One numbered line per distinct sense, counted from 1; a word with one sense has no number.",
                {"Meaning": write_senses(items)})  # fmt: skip
        elif any(len(split_top(g, " / ")) > 1 for gl in gloss_lists for g in gl):
            fixed = ["; ".join(q for g in gl for q in split_top(g, " / ")) for gl in gloss_lists]
            add("meaning-slashes", "Meaning", "format", 'Join the glosses of one sense with "; ", not " / ".', {"Meaning": write_senses(fixed)})
        elif "wanikani" in tags and any(re.search(r"\b[A-Z][a-z]", re.sub(r"\b(?:%s)\b" % "|".join(_PROPER), "", item, flags=re.IGNORECASE)) for item in items):
            # WaniKani joins its meanings with ", " and capitalizes every word.
            fixed = ["; ".join(q for g in gl for q in split_top(_lower_title(g), ", ")) for gl in gloss_lists]
            add("meaning-title-case", "Meaning", "format", 'Lowercase glosses joined with "; ".', {"Meaning": write_senses(fixed)})
        elif any(len(split_top(g, ", ")) > 1 for gl in gloss_lists for g in gl):
            # Safe to split when the pieces are plainly glosses: every one "to ..." for a verb, short for a single word.
            def split_commas(gl: list[str]) -> list[str] | None:
                pieces = [q for g in gl for q in split_top(g, ", ")]
                if len(pieces) == len(gl):
                    return gl
                aside = any(re.match(r"(?:or|and|also|esp|especially|e\.g\.|i\.e\.|etc)\b", q) for q in pieces)
                plain_glosses = (pos == "verb" and all(q.startswith("to ") for q in pieces)) or (
                    pos in ("noun", "adjective", "adverb") and all(len(re.sub(r"\([^)]*\)", "", q).split()) <= 4 for q in pieces)
                )
                return pieces if plain_glosses and not aside else None

            split = [split_commas(gl) for gl in gloss_lists]
            if any(new is not None and new != gl for new, gl in zip(split, gloss_lists, strict=True)):
                fixed = ["; ".join(gl if new is None else new) for new, gl in zip(split, gloss_lists, strict=True)]
                add("meaning-commas", "Meaning", "format", 'Join the glosses of one sense with "; ".', {"Meaning": write_senses(fixed)})
            else:
                add("meaning-commas-check", "Meaning", "review",
                    'If the comma separates two glosses, write "; "; a comma inside one gloss stays.')  # fmt: skip
        elif pos == "noun" and any(re.match(r"(?:a|an|the) \S", g) for gl in gloss_lists for g in gl):
            fixed = ["; ".join(re.sub(r"^(?:a|an|the) ", "", g) for g in gl) for gl in gloss_lists]
            add("meaning-article", "Meaning", "format", 'A noun\'s gloss has no "a" or "the".', {"Meaning": write_senses(fixed)})
        else:
            if len(items) > MAX_SENSES:
                add("meaning-many", "Meaning", "format",
                    f"Keep the {MAX_SENSES} senses worth being tested on; a rarer one gets its own note, or is left out.")  # fmt: skip
            elif any(len(gl) > MAX_GLOSSES for gl in gloss_lists):
                add("meaning-many", "Meaning", "format",
                    f"At most {MAX_GLOSSES} glosses to a sense. If they are different senses, number them, one to a line.")  # fmt: skip
            if any(len(item) > MAX_MEANING for item in items):
                add("meaning-long", "Meaning", "format", f"Keep each sense under {MAX_MEANING} characters; usage goes in Notes.")
            if pos == "verb" and any(gl and not gl[0].startswith("to ") for gl in gloss_lists):
                add("meaning-verb-to", "Meaning", "review", 'A verb\'s gloss starts with "to".')

    # -- Sense --
    sense = txt("Sense").lower()
    if sense and entry and re.search(r"(?<!\w)" + re.escape(entry.lower()) + r"(?!\w)", sense):
        # An Entry in plain ASCII can be spelled like an English word (German "die", Spanish "red"),
        # so only a person can say whether the Sense names it. Any other Entry can't be English.
        add("sense-has-entry", "Sense", "review" if entry.isascii() else "format",
            "Sense is English only, without the word or a form of it: the reverse card shows Sense on its front.")  # fmt: skip
    if sense and meaning and not (lang and lang.definition):
        # A gloss as the Sense would quote it: without its "to" or its bracket.
        glosses = [re.sub(r"^to ", "", re.sub(r"\s*\([^)]*\)", "", g)).strip().lower()
                   for item in senses(raw("Meaning")) for g in split_top(item, ";")]  # fmt: skip
        quoted = any(g and re.search(r"(?<!\w)" + re.escape(g) + r"(?!\w)", sense) for g in glosses)
        if len(glosses) > 1 and (quoted or re.search(r"\b(?:as in|means)\b", sense)):
            add("sense-names-gloss", "Sense", "review",
                "If Sense has to say which gloss it is about, the glosses are different senses: number them in "
                "Meaning, one to a line with an example each, and leave Sense empty.")  # fmt: skip
    if txt("Sense") and meaning and not (lang and lang.definition) and sense_restates_meaning(raw("Meaning"), raw("Sense")):
        add("sense-restates-meaning", "Sense", "review",
            "Sense repeats the Meaning. Say what the word does not cover (\"hot in temperature, not spicy\"), or leave Sense empty.")  # fmt: skip

    # -- SenseContrast: the same reading as src/core/senseContrast.ts, which draws the card's box from it --
    for line in _lines(raw("SenseContrast")):
        left, eq, right = line.partition("=")
        words = [w.strip() for w in right.split(";")]
        if not eq or not left.strip() or not all(words) or len(words) > MAX_CONTRAST_WORDS:
            add("contrast-format", "SenseContrast", "format",
                'One pair per line (<br>): the English sense the word does not cover, " = ", then the word for it '
                f'as an Entry is written ("rain shower = aguacero"). At most {MAX_CONTRAST_WORDS} words, joined by "; ".')  # fmt: skip
            break
        if entry and any(w.lower() == entry.lower() for w in words):
            add("contrast-format", "SenseContrast", "format",
                "SenseContrast names the word for a sense this word does not cover, never the Entry itself.")
            break

    # -- Context --
    context = raw("Context")
    context_lines = _lines(context)
    if not context_lines:
        add("context-missing", "Context", "required", "Give one example sentence, with the word in <b>.")
    else:
        if re.search(r"<\s*/?\s*(?!b\s*>|/b\s*>|br\b)[a-z]", context, re.IGNORECASE) or "&nbsp;" in context:
            fixed = re.sub(r"(?i)<(/?)strong\b[^>]*>", r"<\1b>", context)
            fixed = re.sub(r"(?i)</(?:div|p)>\s*<(?:div|p)\b[^>]*>", "<br>", fixed)
            fixed = re.sub(r"(?i)</?(?:i|em|div|p|span|font|u)\b[^>]*>", "", fixed).replace("&nbsp;", " ")
            # A line break inside the bold belongs after it, and one break is enough between two examples.
            fixed = re.sub(r"(?i)((?:\s*<br\s*/?>\s*)+)</b>", r"</b>\1", fixed)
            fixed = re.sub(r"(?i)(?:\s*<br\s*/?>\s*)+", "<br>", fixed)
            fixed = re.sub(r"(?:<br>)+$", "", fixed).strip()
            add("context-markup", "Context", "format", "Context takes only <b> and <br>.", {"Context": fixed})
        opens, closes = len(re.findall(r"(?i)<b>", context)), len(re.findall(r"(?i)</b>", context))
        if opens != closes:
            add("context-bold-unbalanced", "Context", "format", "Every <b> in Context needs its </b>.")
        elif opens == 0 and not re.search(r"(?i)<strong\b", context):
            found = entry and entry.lower() in plain(context).lower()
            add("context-no-bold", "Context", "required" if found else "format",
                "Put the word in <b></b> as the sentence spells it (both parts of a split verb).")  # fmt: skip
        if numbered and len(context_lines) != len(numbered):
            add("meaning-examples", "Context", "required",
                f"Each numbered sense gets its own example: {len(numbered)} senses, {len(context_lines)} "
                f"example{'' if len(context_lines) == 1 else 's'}. Give Context one line per sense, in the same order, with "
                "ContextTranslation and ContextLabels to match.")  # fmt: skip
        labels = _lines(raw("ContextLabels"))
        counts = {name: len(_lines(raw(name))) for name in ("ContextTranslation", "ContextRomanized", "ContextLiteral")}
        if len(context_lines) > 1 and not labels:
            add("context-labels", "ContextLabels", "format",
                "Several examples need ContextLabels: one short label per line, in the same order.")  # fmt: skip
        elif labels and (len(labels) != len(context_lines) or any(n and n != len(context_lines) for n in counts.values())):
            add("context-labels", "ContextLabels", "format",
                "Context, ContextTranslation, ContextRomanized, ContextLiteral and ContextLabels need the same number of lines.")  # fmt: skip
        if lang and lang.name == "japanese" and any(not re.search(r"[。？！?!…]$", line.rstrip("」』）)")) for line in context_lines):
            fixed = "<br>".join(
                piece if re.search(r"[。？！?!…]$", plain(piece).rstrip("」』）)")) else piece.rstrip() + "。"
                for piece in re.split(r"<\s*br\s*/?>", context) if plain(piece)
            )  # fmt: skip
            add("context-end-punctuation", "Context", "format", "A Japanese sentence ends with 。", {"Context": fixed})
        words = lambda name: re.sub(r"[^\w\s]", "", txt(name).lower()).split()  # noqa: E731
        if txt("ContextLiteral") and words("ContextLiteral") == words("ContextTranslation"):
            add("literal-redundant", "ContextLiteral", "format",
                "ContextLiteral is only for a literal reading that differs from the translation: clear it.", {"ContextLiteral": ""})  # fmt: skip
        if not (lang and lang.definition) and not txt("ContextTranslation"):
            add("translation-missing", "ContextTranslation", "required", "Translate the example into natural American English.")

    # -- Source: the line the word was met in (a game, a show), its translation, and where --
    source = raw("Source")
    source_lines = _lines(source)
    if source_lines:
        if re.search(r"<\s*/?\s*(?!b\s*>|/b\s*>|br\b)[a-z]", source, re.IGNORECASE) or "&nbsp;" in source:
            fixed = re.sub(r"(?i)<(/?)strong\b[^>]*>", r"<\1b>", source)
            fixed = re.sub(r"(?i)</(?:div|p)>\s*<(?:div|p)\b[^>]*>", "<br>", fixed)
            fixed = re.sub(r"(?i)</?(?:i|em|div|p|span|font|u)\b[^>]*>", "", fixed).replace("&nbsp;", " ")
            fixed = re.sub(r"(?i)(?:\s*<br\s*/?>\s*)+", "<br>", fixed)
            fixed = re.sub(r"(?:<br>)+$", "", fixed).strip()
            add("source-markup", "Source", "format", "Source takes only <b> and <br>.", {"Source": fixed})
        # The app reads the last line as the title and a line between as the translation (sourceOf, src/core/examples.ts).
        wanted = (2,) if lang and lang.definition else (3,) if lang else (2, 3)
        if len(source_lines) not in wanted:
            add("source-lines", "Source", "format",
                "Source is the line as it was shown or said, " + ("" if wanted == (2,) else "its translation, ")
                + "and where it was met (the title), one to a line (<br>).")  # fmt: skip
        first = re.split(r"(?i)<\s*br\s*/?>|</(?:div|p)>", source, maxsplit=1)[0]
        if not re.search(r"(?i)<(?:b|strong)\b", first):
            add("source-no-bold", "Source", "format", "Put the word in <b></b> in Source's first line, as the line spells it.")

    # -- gender --
    if lang:
        if gender and not lang.genders:
            add("gender-unknown", "Gender", "format", f"{lang.name.capitalize()} notes have no Gender.")
        elif gender and gender not in lang.genders:
            add("gender-unknown", "Gender", "format", f"Gender is one of: {', '.join(sorted(lang.genders))}.")
        elif lang.genders and pos == "noun" and not gender and not any(p.rule == "entry-article" and p.fix for p in out):
            add("gender-missing", "Gender", "required", f"A {lang.name.capitalize()} noun needs Gender ({', '.join(sorted(lang.genders))}).")

    # -- reading aids --
    if lang and lang.romanized:
        if not txt("Transliteration"):
            add("romanization-missing", "Transliteration", "required", "Romanize the Entry (note_guide gives the scheme).")
        if context_lines and not txt("ContextRomanized"):
            add("romanization-missing", "ContextRomanized", "required", "Romanize the example, one line per sentence.")
        for name in ("Transliteration", "ContextRomanized"):
            if letters_wrong(txt(name)):
                add("romanization-letters", name, "format", LETTERS_ADVICE)
        if is_toneless(txt("ContextRomanized")):
            add("romanization-toneless", "ContextRomanized", "review", TONELESS_ADVICE)
        # The Transliteration's tone marks and the Pronunciation's tone letters say the same tones.
        clash = tone_mismatch(txt("Transliteration"), txt("Pronunciation"))
        if clash:
            add("romanization-tone-mismatch", "Transliteration", "review",
                f"Its tone marks ({', '.join(clash[0])}) disagree with Pronunciation's tone letters ({', '.join(clash[1])}). "
                "One of them is wrong: work out the tones from the Thai spelling.")  # fmt: skip
    elif lang and lang.name in ("russian", "greek"):
        for name in ("Transliteration", "ContextRomanized"):
            if txt(name):
                add("romanization-unneeded", name, "format", f"{lang.name.capitalize()} notes carry no romanization: leave {name} empty.")
    if lang and lang.name == "japanese":
        kana = txt("KanaReading")
        if _KANJI.search(entry) and not kana:
            add("kana-missing", "KanaReading", "required", "Give the word's reading in kana.")
        elif kana and not _KANA_ONLY.match(kana):
            add("kana-format", "KanaReading", "format", "KanaReading is one reading, in kana only: the one for this meaning.")
        breakdown = txt("Hanzi")
        if breakdown.lower() in REGISTERS:
            add("kanji-breakdown", "Hanzi", "format", "The kanji breakdown holds a Register value.", {"Hanzi": ""})
        elif breakdown:
            listed = [part.strip()[:1] for part in breakdown.split(";") if part.strip()]
            stray = [k for k in listed if _KANJI.match(k) and k not in entry]
            if stray:
                add("kanji-breakdown", "Hanzi", "format",
                    f"List only kanji that are in the Entry ({', '.join(stray)} is not), each with the reading this word uses.")  # fmt: skip

    # -- grammar --
    if lang:
        wants = lang.noun if pos == "noun" else lang.verb if pos == "verb" else ()
        for name in wants:
            if not txt(name) and not (name == "AspectPartner" and " / " in entry):
                detail = f" (a pattern: line saying what kind of word it is, then {lang.key_forms})" if name == "KeyForms" and lang.key_forms else ""
                add("grammar-gap", name, "gap", f"A {lang.name.capitalize()} {pos} carries {name}{detail}.")
        if lang.name == "german" and pos == "noun":
            if gender in ("m", "n") and not txt("Genitive"):
                add("grammar-gap", "Genitive", "gap", "A German masculine or neuter noun carries its genitive (des Tisches).")
            elif gender == "f" and txt("Genitive"):
                add("genitive-feminine", "Genitive", "format", "A feminine noun's genitive is its nominative: leave Genitive empty.",
                    {"Genitive": ""})  # fmt: skip
        verb_class, auxiliary = txt("VerbClass").lower(), txt("Auxiliary").lower()
        if verb_class and lang.verb_classes and verb_class.split(",")[0].strip() not in lang.verb_classes:
            add("verbclass-unknown", "VerbClass", "format", f"VerbClass is one of: {', '.join(sorted(lang.verb_classes))}.")
        if auxiliary and lang.auxiliaries and not set(re.split(r"\s*[,/]\s*", auxiliary)) <= lang.auxiliaries:
            add("auxiliary-unknown", "Auxiliary", "format", f"Auxiliary is one of: {', '.join(sorted(lang.auxiliaries))}.")

    # -- key forms: every form under the name of what it is --
    key_lines = _lines(raw("KeyForms"))
    labels = [m.group(1).strip().lower() if (m := _LABEL.match(line)) else None for line in key_lines]
    if any(label is None for label in labels):
        relabeled = label_key_forms(lang, pos, gender, key_lines, raw("Forms")) if lang else None
        add("keyforms-unlabeled", "KeyForms", "format",
            "Write each form on its own line under what it is (genitive: poniedziałku). note_guide lists the labels.",
            {"KeyForms": relabeled} if relabeled else None)  # fmt: skip
    elif any(label not in FORM_LABELS for label in labels):
        unknown = ", ".join(sorted({label for label in labels if label not in FORM_LABELS}))  # type: ignore[type-var]
        add("keyforms-label", "KeyForms", "format", f"KeyForms labels are: {', '.join(FORM_LABELS)}. Not: {unknown}.")
    elif labels and lang and "KeyForms" in (lang.noun if pos == "noun" else lang.verb if pos == "verb" else ()) and "pattern" not in labels:
        add("pattern-missing", "KeyForms", "gap",
            'Start KeyForms with a "pattern:" line saying what kind of word it is, in a short sentence or two '
            "(Masculine inanimate. Genitive in -u. The e drops out.).")  # fmt: skip

    # -- pronunciation and punctuation --
    icon = txt("Icon")
    named = icon.lower().startswith(TABLER_PREFIX)
    drawing = icon_drawing(icon) if named else None
    if drawing:
        add("icon-tabler-name", "Icon", "format", "Icon is stored as the Tabler icon's path data.", {"Icon": drawing})
    # Markup is a problem even where it strips to nothing: the field holds text only.
    elif "<" in raw("Icon") or (icon and not is_emoji(icon) and tabler_name_of(icon) is None):
        try_instead = similar_names(icon) if named else []
        add("icon-format", "Icon", "format",
            "Icon is one emoji that pictures exactly this thing, or a Tabler icon whose name is exactly this thing "
            "(tabler:umbrella), or empty. A drawing of your own is not accepted, and no words or markup."
            + (f" Tabler has no icon of that name. Names that contain it: {', '.join(try_instead)}." if try_instead else ""))  # fmt: skip
    ipa = txt("Pronunciation")
    if ipa and not re.fullmatch(r"/[^/]+/|\[[^\]]+\]", ipa):
        add("pronunciation-format", "Pronunciation", "format", "Pronunciation is one IPA transcription between slashes: /ˈbluːtʊŋ/.")
    elif lang and lang.name == "spanish" and "θ" in ipa:
        add("pronunciation-castilian", "Pronunciation", "format", "Spanish IPA is Latin American: s, not θ.",
            {"Pronunciation": raw("Pronunciation").replace("θ", "s")})  # fmt: skip
    for name, value in fields.items():
        if name not in NOT_PROSE and name not in SENTENCES and "—" in (value or ""):
            add("em-dash", name, "format", "No em dashes: use a period, colon, comma or parentheses.")
    if "already known" in txt("Notes").lower():
        add("notes-already-known", "Notes", "format", 'Never write "already known": say what the part means, or leave it out.')
    return out


# The review rules a write reports back (the note is saved either way); the rest are for lint_notes.
WARN_ON_WRITE = frozenset({"sense-restates-meaning"})

FIXABLE = frozenset(
    {"switch-value", "register-unknown", "pos-missing", "pos-unknown", "pos-in-tags", "source-tag", "entry-markup", "entry-article",
     "entry-infinitive-marker", "entry-aspect-pair", "meaning-markup", "meaning-numbered", "meaning-lines",
     "meaning-slashes", "meaning-commas", "meaning-article", "meaning-title-case", "context-markup",
     "context-end-punctuation", "source-markup", "kanji-breakdown", "genitive-feminine", "pronunciation-castilian", "keyforms-unlabeled",
     "icon-tabler-name"}
)  # fmt: skip


@dataclass
class Fixed:
    """A note after its fixes: the fields and tags as they should be stored, and the problems each fix settled."""

    fields: dict[str, str]
    tags: list[str]
    applied: list[Problem]


def fix(fields: Mapping[str, str], tags: Sequence[str] = (), rules: Iterable[str] | None = None,
        only_fields: Iterable[str] | None = None) -> Fixed:
    """Applies every fix that needs no judgment, one at a time, until none is left: a numbered Meaning
    becomes semicolons, and only then are its slashes seen. `rules` narrows it to some rules;
    `only_fields` to fixes that start from one of those fields (the ones an update writes)."""
    wanted = FIXABLE if rules is None else FIXABLE & set(rules)
    scope = None if only_fields is None else set(only_fields)
    out, now, applied = dict(fields), list(tags), []
    for _ in range(40):
        todo = next((p for p in problems(out, now)
                     if p.fix is not None and p.rule in wanted and (scope is None or p.field in scope)), None)  # fmt: skip
        if todo is None:
            break
        for name, value in (todo.fix or {}).items():
            if name == "tags":
                now = value.split()
            else:
                out[name] = value
        applied.append(todo)
    return Fixed(out, now, applied)


@dataclass
class Prepared:
    """A note ready to write, or the reasons it isn't."""

    fields: dict[str, str]
    tags: list[str]
    tidied: list[str]  # what the fixes changed, a line each
    refused: list[str]  # what the caller has to change before it's written
    gaps: list[str]  # grammar still to fill, reported with the note written
    review: list[str]  # review-level problems a person should read, reported with the note written


def _tidy_values(fields: Mapping[str, str]) -> dict[str, str]:
    out = {}
    for name, value in fields.items():
        value = unicodedata.normalize("NFC", value or "")
        if name in LIST_FIELDS:
            value = plain(value).lower()
        elif name not in ("Audio", "Forms"):
            value = re.sub(r"(?:\s|&nbsp;|<br\s*/?>)+$", "", value).strip()
        out[name] = value
    return out


def prepare(new: Mapping[str, str], tags: Sequence[str] = (), existing: Mapping[str, str] | None = None,
            field_names: Iterable[str] | None = None) -> Prepared:
    """Tidies and checks a note the MCP is about to write. With no `existing`, `new` is a new note and
    every rule applies. With `existing` (the note as stored), `new` is the fields an update writes: only
    they are tidied and checked, so an old note can be corrected a field at a time. `field_names` are the
    note type's fields: a fix never writes one it doesn't have."""
    written = set(new)
    merged = {**(existing or {}), **_tidy_values(new)}
    known = set(field_names) if field_names is not None else None
    fixed = fix(merged, tags, only_fields=None if existing is None else written)
    if known is not None and any(n != "tags" and n not in known for p in fixed.applied for n in (p.fix or {})):
        fixed = fix(merged, tags, rules=FIXABLE - {"entry-aspect-pair"}, only_fields=None if existing is None else written)
    left = [p for p in problems(fixed.fields, fixed.tags) if known is None or p.field == "tags" or p.field in known]
    if existing is None:
        refuse = [p for p in left if p.level in ("format", "required")]
    else:
        refuse = [p for p in left if p.level == "format" and p.field in written]
    changed = {n: v for n, v in fixed.fields.items() if (existing or {}).get(n, "") != v} if existing is not None else fixed.fields
    return Prepared(
        fields=dict(changed),
        tags=fixed.tags,
        tidied=[f"{p.field}: {RULES[p.rule]}, fixed" for p in fixed.applied],
        refused=[f"{p.field}: {p.message}" for p in refuse],
        gaps=[f"{p.field}: {p.message}" for p in left if p.level == "gap"] if existing is None else [],
        review=[f"{p.field}: {p.message}" for p in left if p.rule in WARN_ON_WRITE and (existing is None or "Sense" in written or "Meaning" in written)],
    )


# ---- the guide ----


_COMMON = """\
Entry: the citation form as plain text. No article (Gender supplies it), no markup, one word or one phrase.
  A verb's fixed preposition follows it bare (zweifeln an). An aspect partner goes in AspectPartner.
Meaning: English glosses, lowercase. A verb starts with "to"; a noun has no "a" or "the". A word with one
  sense is one line: one to three near-synonyms joined by "; " (fame; glory). The test: every gloss on a line
  could translate the word in the same example sentence. If one could not (ziehen: pull the door, move to
  Berlin), they are different senses, and each gets a number. A word with distinct senses numbers them, one to a line (<br>), the most common first, three at most:
  "1. train<br>2. move (in a game)<br>3. draft (of air)". Number only senses worth being tested on: every one
  listed has to be recalled to pass the card. A rarer sense is left out, or gets a note of its own; two
  different words spelled alike are two notes. A short bracket pins down a numbered sense. On a Meaning with
  one sense, a bracket that only narrows which English sense is meant moves to Sense: "to know" with the
  Sense "a fact, not a person", not "to know (a fact)". A bracket that labels grammar ((prefix),
  (classifier)) or register ((formal)), or explains the gloss (baht (Thai currency)), stays. No slashes, sub-senses or markup; grammar and usage go in Notes.
Examples for a numbered Meaning: Context holds one example per sense, in the same order, each on its own
  line (<br>), with ContextTranslation line for line and ContextLabels naming each in a word or two
  ("train", "move", "draft").
Sense: only when the word covers some, not all, of its English gloss's most common senses, so the learner
  doesn't assume it works wherever the gloss does (leke, "to play": to play for fun, as children do). Say what
  the word does not cover ("hot in temperature, not spicy"), never the Meaning again in other words ("itchy,
  or counter for vehicles" repeats "itchy; to itch; classifier for vehicles"). Empty when the word spans the
  same senses as the gloss, since a Sense would then imply the others don't apply; a gloss that is merely
  ambiguous English is not a reason. One short line, about 8 words at most, lowercase, no markup, American
  English, shown under the meaning. Never the word itself or a form of it: the reverse card shows Sense on
  its front. If a Sense would have to say which gloss it is about ("move as in relocate"), the Meaning holds
  two senses: number them and leave Sense empty. Never beside a numbered Meaning: the numbers and
  ContextLabels already say which sense.
SenseContrast: only beside a Sense that rules out an English sense, and only when the word for that sense is
  one worth knowing: "rain shower = aguacero" for ducha (Sense "a bathroom shower, not rain"). One pair per
  line (<br>): the excluded sense in English, " = ", then the word as an Entry is written (no article), two
  at most joined by "; ". The card's answer shows it under the Sense, with a button that adds the word as a
  note of its own. Empty when no single word covers the excluded sense.
Context: one full sentence of 5 to 12 words in an everyday setting, at or below the word's level, with end
  punctuation. The word in <b></b> as the sentence spells it, both parts of a split verb (Franki highlights
  what's bold). It should stop making sense if another word were swapped in.
ContextTranslation: the sentence in natural American English, as a person would say it.
ContextLiteral: only when the word-for-word reading differs from ContextTranslation in a way that teaches
  something about the sentence's structure ("Even though tired, still working." under "I keep working even
  though I'm tired."). Empty when the two say about the same thing (quiero comida: "I want food" needs no
  "want food"). Numbered examples: one line each, as above.
Source: only for a word met somewhere in particular (a game, a show, a book, a song). Three lines (<br>): the
  line exactly as it was shown or said, with the word in <b></b> as the line spells it; that line in natural
  American English; and where it was met, the title with the chapter or episode when known (The Last Train,
  chapter 4). Empty for any other word. Context is still an example sentence of its own, written as above.
Register: neutral, casual, formal, literary, technical, slang, vulgar or dated. Always filled.
Dialect: only when the word or sense is regional.
PartOfSpeech: one of noun, proper noun, verb, adjective, adverb, pronoun, determiner, numeral, preposition,
  conjunction, particle, classifier, interjection, prefix, suffix, phrase. Always filled. Not repeated in tags.
Language: the language's English name in lowercase. GenerateReverse, GenerateAudioCard, SuppressFrontCard: "y" or empty.
  GenerateReverse (meaning to word) only for a word the learner would say or write themselves; GenerateAudioCard
  (hear it, recall the meaning) only for one they would hear in everyday speech. A word to recognize only
  (literary, technical, rare, met on signs or in the news) gets neither. Never change either on an existing note unasked.
KeyForms: what the card's Grammar box shows, one "label: form" to a line (<br>). First "pattern:", a short
  sentence or two on what kind of word it is and what is unusual about it (pattern: Masculine inanimate.
  Genitive in -u. The e drops out.). Then the forms the rest can be worked out from, each under what it is
  (genitive: poniedziałku). Last, for a verb or preposition that takes a case or a preposition, "takes:"
  (takes: do + genitive (dzwonić do kogoś)). A bracket at a line's end is shown smaller under the form. Labels
  are plain words: genitive, dative, accusative, instrumental, locative, vocative, plural, genitive plural,
  (or "genitive plural" and so on), feminine, neuter, comparative, superlative, I, you, "he, she", we, they,
  present, past, perfect, participle, future, imperative, perfective, imperfective. Never a form with no label.
Pronunciation: one IPA transcription between slashes. fill_pronunciation fills it; write it only when sure.
Stress: Russian only, the Entry with its stress mark (говори́ть). fill_stress fills it; write it only when sure.
Icon: a picture of the word, only for a thing that can be pictured. One emoji when an emoji shows exactly it
  (ร่ม ☂️, ช้าง 🐘, กุญแจ 🔑). When none does, a Tabler icon whose name is exactly the word, written tabler:name
  (tabler:bike, tabler:bread). It has to be the thing itself: never an icon of a related thing, a place where it
  happens, a tool for it or a symbol of it (a stadium is not a running track, a ruler is not a mile, trees are
  not a park), and never a drawing of your own. When neither fits exactly, leave it empty. Franki shows it with
  the meaning on an answer side and first on the meaning-to-word card, the English behind a tap. Nothing for an
  action, a quality or an idea. Empty for most notes.
Notes: at most two short lines of what helps use the word: what it takes ("Takes the dative."), a collocation
  with its meaning, a contrast with a near word. A breakdown gives each part its meaning ("กลับ (return) +
  บ้าน (home)"). Never "already known".
Etymology: the real origin, or a cognate or false friend in a language the learner knows. Mnemonic: a sound
  or image hook only. Tags: topic, source and status. A word met in a game, a show, a book or a song gets
  that title's tag, "source::" then the title in lowercase words joined by hyphens (source::the-last-train),
  the same tag for every word from it: find_notes "tag:source::*" lists them, and check_words shows it. No em dashes in what is written about a word (Meaning,
  Notes, Etymology, Mnemonic); an example sentence keeps its language's own punctuation.
A grammar field of a word that has no such form holds "-": Plural of a noun with no plural in normal
  use, Classifier of a noun that is never counted, AspectPartner of a verb with no partner. The card
  says "none", and forms practice does not ask for it."""

_PER_LANGUAGE = {
    "thai": "Classifier: a countable noun's everyday counting word, in Thai script.\n" + THAI_SCHEME,
    "spanish": "Gender: m or f (m/f for a noun that takes either; m pl / f pl for a plural-only noun).\n"
               "The target is Mexican Spanish: a word or sense not used in Mexico gets a Dialect (Iberian, Caribbean,\n"
               "Colombian); a Mexico-only word says Mexican. IPA is Latin American (s, not θ).\n"
               "fill_forms writes a verb's Forms table.",
    "french": "Gender: m or f. Auxiliary: avoir or être, for every verb. KeyForms: participle: pris, when it is irregular.",
    "german": "Gender: m, f or n. Plural: every noun, without its article.\n"
              "Genitive: masculine and neuter nouns only, with the article (des Tisches).\n"
              "VerbClass: strong, weak or mixed. Auxiliary: haben or sein.\n"
              "KeyForms for a verb: he, she: wirft ab (when the vowel changes), past: warf ab, perfect: hat abgeworfen.",
    "greek": "Gender: m, f or n (m/f for a noun that takes either). Plural: every noun's nominative plural.\n"
             "VerbClass: active; deponent only for a verb with no active form; passive for the -μαι form of an active verb.\n"
             "KeyForms for a verb: past: αντιπάθησα (the aorist). No romanization.",
    "norwegian": "Bokmål. Gender: m, f or n. Plural: every noun's indefinite plural. A verb is entered without å: the card shows and says it.\n"
                 "KeyForms for a verb: present: tømmer, past: tømte, participle: tømt.",
    "russian": "Gender: m, f or n. AspectPartner: every verb's partner of the other aspect, as one word.\n"
               "KeyForms for a noun: genitive: стола, plural: столы; for a verb: I: добиваюсь, you: добиваешься (present, or the "
               "future of a perfective). No romanization.\n"
               "fill_forms writes the Forms tables.",
    "polish": "Gender: m, f or n; pl for a plural-only noun, mpl for a plural of men.\n"
              "AspectPartner: every verb's partner of the other aspect, as one word.\n"
              "KeyForms for a noun: genitive: mężczyzny, plural: mężczyźni; for a verb: I: mam, you: masz.\n"
              "fill_forms writes the Forms tables.",
    "japanese": "KanaReading: a word with kanji gets its reading in kana, one reading only. Empty for a kana-only word.\n"
                "Hanzi (the kanji breakdown): only kanji in the Entry, each with the reading this word uses (hiragana for\n"
                "kun, katakana for on) and a keyword, joined by \"; \": 割(わ)divide; 込(こ)go into.\n"
                "VerbClass: godan, ichidan, suru or irregular. Context ends with 。",
    "english": "Rare English words for a native speaker: Meaning is a one-sentence definition and there is no\n"
               "ContextTranslation, and Source has no translation line. Etymology is expected.",
}  # fmt: skip

EXAMPLES: dict[str, dict[str, str]] = {
    "german": {"Entry": "abwerfen", "Meaning": "to throw off; to shed", "Context": "Er <b>warf</b> seinen Mantel <b>ab</b>.",
               "ContextTranslation": "He threw off his coat.", "Register": "neutral", "PartOfSpeech": "verb",
               "Language": "german", "VerbClass": "strong", "Auxiliary": "haben",
               "KeyForms": "pattern: Strong verb. The prefix ab splits off.<br>he, she: wirft ab<br>past: warf ab<br>perfect: hat abgeworfen",
               "GenerateReverse": "y"},
    "thai": {"Entry": "กลับ", "Meaning": "to return; to go back", "Context": "เขา<b>กลับ</b>บ้านแล้ว",
             "ContextRomanized": "khǎo glàp bâan láaeo", "ContextTranslation": "He has already gone home.",
             "Transliteration": "glàp", "Register": "neutral", "PartOfSpeech": "verb", "Language": "thai",
             "Notes": "กลับบ้าน (go home), กลับมา (come back)", "GenerateReverse": "y"},
    "spanish": {"Entry": "blindaje", "Meaning": "armor plating; shielding", "Context": "El <b>blindaje</b> resistió el impacto.",
                "ContextTranslation": "The armor withstood the impact.", "Register": "neutral", "PartOfSpeech": "noun",
                "Gender": "m", "Language": "spanish", "GenerateReverse": "y"},
    "russian": {"Entry": "добавлять", "Meaning": "to add", "AspectPartner": "добавить",
                "Context": "Он всегда <b>добавлял</b> что-то новое.<br>Она <b>добавила</b> соль в суп.",
                "ContextTranslation": "He always added something new.<br>She added salt to the soup.",
                "ContextLabels": "imperfective<br>perfective", "Register": "neutral",
                "KeyForms": "pattern: Imperfective. Endings -ю, -ешь.<br>I: добавляю<br>you: добавляешь",
                "PartOfSpeech": "verb", "Language": "russian", "GenerateReverse": "y"},
    "japanese": {"Entry": "割り込む", "Meaning": "to cut in; to interrupt", "KanaReading": "わりこむ",
                 "Hanzi": "割(わ)divide; 込(こ)go into", "Context": "列に<b>割り込む</b>のはよくない。",
                 "ContextTranslation": "It's not good to cut in line.", "VerbClass": "godan", "Register": "neutral",
                 "PartOfSpeech": "verb", "Language": "japanese", "GenerateReverse": "y"},
}  # fmt: skip


SEVERAL_SENSES = {
    "Entry": "erhalten", "Meaning": "1. to receive<br>2. to preserve; to maintain",
    "Context": "Hast du meine E-Mail <b>erhalten</b>?<br>Wir müssen die alten Gebäude <b>erhalten</b>.",
    "ContextTranslation": "Did you get my email?<br>We have to preserve the old buildings.", "ContextLabels": "receive<br>preserve",
    "Register": "neutral", "PartOfSpeech": "verb", "Language": "german",
    "KeyForms": "pattern: Strong verb. The prefix er never splits off.<br>he, she: erhält<br>past: erhielt<br>perfect: hat erhalten",
    "VerbClass": "strong", "Auxiliary": "haben", "GenerateReverse": "y",
}  # fmt: skip


def guide(language: str) -> dict[str, object]:
    """The house style for one language's notes, as Claude reads it before writing one."""
    key = LANGUAGE_NAMES.get(language.strip().lower(), "")
    lang = LANGUAGES.get(key)
    return {
        "language": key or language.strip().lower(),
        "every_note": _COMMON,
        "this_language": _PER_LANGUAGE.get(key, "No rules beyond the common ones are written for this language yet."),
        "values": {
            "Register": list(REGISTERS),
            "PartOfSpeech": list(PARTS_OF_SPEECH),
            **({"Gender": sorted(lang.genders)} if lang and lang.genders else {}),
            **({"VerbClass": sorted(lang.verb_classes)} if lang and lang.verb_classes else {}),
            **({"Auxiliary": sorted(lang.auxiliaries)} if lang and lang.auxiliaries else {}),
        },
        "example": EXAMPLES.get(key) or EXAMPLES["german"],
        "example_with_several_senses": SEVERAL_SENSES,
        "checked": "add_notes and update_notes tidy what needs no judgment and refuse the rest with the reason. "
                   "lint_notes runs the same rules over notes already in the collection.",
    }  # fmt: skip
