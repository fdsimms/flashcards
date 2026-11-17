"""A Japanese verb's forms, for the Forms field Franki's forms practice reads: worked out from the
verb's conjugation type as Sudachi gives it (五段-ラ行 for 帰る, 下一段-バ行 for 食べる), so a る verb
that conjugates like a godan one (帰る, 切る, 入る) is never guessed wrong from its ending. The MCP's
fill_forms asks for them (/api/conjugations), as it has no Sudachi of its own.

Each line is `group · label: form / reading`, the format src/core/forms.ts reads: the form as written,
and its reading in kana as a second spelling, so practice takes either. A group is the form's name
as Read & Listen's form quiz and the grammar catalog call it (data/forms/ja.json, the points'
`forms`), and a label says plain or polite.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from franki_reader.japanese import hiragana, morphemes

# A godan verb's last kana, and the kana it turns into before each ending: the a-, i-, e- and
# o-rows (書く: 書か, 書き, 書け, 書こ). う's a-row is わ (買わない).
_GODAN: dict[str, tuple[str, str, str, str]] = {
    "う": ("わ", "い", "え", "お"), "く": ("か", "き", "け", "こ"), "ぐ": ("が", "ぎ", "げ", "ご"),
    "す": ("さ", "し", "せ", "そ"), "つ": ("た", "ち", "て", "と"), "ぬ": ("な", "に", "ね", "の"),
    "ぶ": ("ば", "び", "べ", "ぼ"), "む": ("ま", "み", "め", "も"), "る": ("ら", "り", "れ", "ろ"),
}  # fmt: skip
# A godan verb's te-form ending by its last kana (待つ: 待って, 読む: 読んで, 書く: 書いて).
_TE: dict[str, str] = {"う": "って", "つ": "って", "る": "って", "む": "んで", "ぶ": "んで", "ぬ": "んで",
                       "く": "いて", "ぐ": "いで", "す": "して"}  # fmt: skip
# Honorific verbs whose i-row is い, not り (くださいます, いらっしゃいます), and whose imperative is it.
_HONORIFIC = {"くださる", "下さる", "いらっしゃる", "なさる", "おっしゃる", "仰る", "ござる"}
# ある's negative is ない, and it has no potential, passive or causative.
_ARU = {"ある", "有る", "在る"}
_NOT_ARU = ("potential", "passive", "causative")

# The lines, in order: (group, label, the key `_inflect` gives the form under).
ROWS: tuple[tuple[str, str, str], ...] = (
    ("polite", "present", "masu"),
    ("polite", "past", "mashita"),
    ("polite", "negative", "masen"),
    ("polite", "past negative", "masendeshita"),
    ("past", "plain", "ta"),
    ("negative", "plain", "nai"),
    ("negative", "plain past", "nakatta"),
    ("te-form", "plain", "te"),
    ("potential", "plain", "potential"),
    ("passive", "plain", "passive"),
    ("causative", "plain", "causative"),
    ("volitional", "plain", "you"),
    ("volitional", "polite", "mashou"),
    ("conditional", "ば", "ba"),
    ("conditional", "たら", "tara"),
    ("imperative", "plain", "imperative"),
    ("desire", "plain", "tai"),
)


def _stems(verb: str, kind: str) -> dict[str, str] | None:
    """Each form of one verb in its dictionary form, by `ROWS`' keys, or None for a type it can't do."""
    head, last = verb[:-1], verb[-1:]
    if kind.startswith("五段"):
        rows = _GODAN.get(last)
        if rows is None:
            return None
        a, i, e, o = (head + k for k in rows)
        if verb in _HONORIFIC:
            i = head + "い"
        te = head + ("って" if verb.endswith(("行く", "いく")) else _TE[last])
        ta = te[:-1] + ("だ" if te.endswith("で") else "た")
        out = {"i": i, "nai": a + "ない", "te": te, "ta": ta, "potential": e + "る", "passive": a + "れる",
               "causative": a + "せる", "you": o + "う", "ba": e + "ば", "imperative": i if verb in _HONORIFIC else e}  # fmt: skip
        if verb in _ARU:
            out["nai"] = "ない"
            for key in _NOT_ARU:
                del out[key]
        return out
    if kind.startswith(("上一段", "下一段")) and last == "る":
        return {"i": head, "nai": head + "ない", "te": head + "て", "ta": head + "た", "potential": head + "られる",
                "passive": head + "られる", "causative": head + "させる", "you": head + "よう", "ba": head + "れば",
                "imperative": head + "ろ"}  # fmt: skip
    if kind.startswith("カ行変格") and last == "る":
        # 来る keeps its kanji in every form; in kana its vowel changes (きます, こない, くれば).
        ki, ko, ku = (
            ("来", "来", "来")
            if head.endswith("来")
            else (head[:-1] + "き", head[:-1] + "こ", head[:-1] + "く")
        )
        return {"i": ki, "nai": ko + "ない", "te": ki + "て", "ta": ki + "た", "potential": ko + "られる",
                "passive": ko + "られる", "causative": ko + "させる", "you": ko + "よう", "ba": ku + "れば",
                "imperative": ko + "い"}  # fmt: skip
    if kind.startswith("サ行変格") and verb.endswith("する"):
        h = verb[:-2]
        return {"i": h + "し", "nai": h + "しない", "te": h + "して", "ta": h + "した", "potential": h + "できる",
                "passive": h + "される", "causative": h + "させる", "you": h + "しよう", "ba": h + "すれば",
                "imperative": h + "しろ"}  # fmt: skip
    return None


def _forms(verb: str, kind: str) -> dict[str, str] | None:
    s = _stems(verb, kind)
    if s is None:
        return None
    i, nai, ta = s["i"], s["nai"], s["ta"]
    return {
        **{k: v for k, v in s.items() if k != "i"},
        "masu": i + "ます",
        "mashita": i + "ました",
        "masen": i + "ません",
        "masendeshita": i + "ませんでした",
        "nakatta": nai[:-1] + "かった",
        "mashou": i + "ましょう",
        "tara": ta + "ら",
        "tai": i + "たい",
    }


@dataclass(frozen=True)
class Verb:
    """A verb Entry split for conjugating: what comes before its verb (約束を, 勉強), the verb in its
    dictionary form, and its conjugation type."""

    before: str
    verb: str
    kind: str


def verb_of(entry: str) -> Verb | None:
    """The verb an Entry ends in, if it ends in one in its dictionary form: 食べる, 勉強する, 約束を破る."""
    ms = [m for m in morphemes(entry.strip()) if m.surface.strip()]
    if not ms or ms[-1].pos != "動詞" or ms[-1].surface != ms[-1].dictionary or not ms[-1].kind:
        return None
    last = ms[-1]
    return Verb("".join(m.surface for m in ms[:-1]), last.surface, last.kind)


def form_lines(entry: str, reading: str = "") -> list[str] | None:
    """The Forms field's lines for a verb Entry, each form followed by its reading in kana where the
    Entry has kanji. `reading` is the note's KanaReading (its first alternative); Sudachi's reading
    stands in when it's empty or doesn't end the way the verb does. None when the Entry isn't a verb in its dictionary
    form, or of a type this can't conjugate."""
    v = verb_of(entry)
    if v is None:
        return None
    written = _forms(v.verb, v.kind)
    if written is None:
        return None
    # The whole reading conjugates as the verb does, since only its end changes (やくそくをやぶる:
    # やくそくをやぶった). The note's own reading is used where it ends as the verb does.
    said = "".join(re.split(r"[、,/]", reading)[0].split()) if reading else ""
    kana = _forms(said, v.kind) if said and said[-1] == v.verb[-1] else None
    if kana is None:
        kana = _forms(
            hiragana("".join(m.reading for m in morphemes(entry.strip()) if m.surface.strip())),
            v.kind,
        )
    lines = []
    for group, label, key in ROWS:
        if key not in written:
            continue
        form = v.before + written[key]
        spoken = kana.get(key, "") if kana else ""
        alternative = f" / {spoken}" if spoken and spoken != form else ""
        lines.append(f"{group} · {label}: {form}{alternative}")
    return lines
