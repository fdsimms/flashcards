"""Japanese kana as IPA, by rule, for the word popup (docs/read-and-listen/architecture.md, IPA).

Wiktionary has IPA for fewer than half of Japanese's entries, and none for a conjugated form, so a
word's reading (Sudachi's, or the deck's KanaReading) is turned into IPA here, in the phonemic style
Wiktionary uses for Tokyo Japanese: しんぶん is /ɕimbɯɴ/, とうきょう /toːkʲoː/, ざっし /dzaɕɕi/. A long vowel
is written with ː, including おう and えい, as Wiktionary does. It leaves out what a reading doesn't
carry: pitch accent, and vowels devoiced between voiceless consonants (きます is [kimasɯ̥] in speech).

A reading is kana (katakana is folded to hiragana); anything else in it makes the whole word None,
so a digit or a Latin letter never produces half a pronunciation.
"""

import re

# Plain kana (a vowel or consonant + vowel) to IPA. The vowels are Japanese's five.
_BASE = {
    "あ": "a", "い": "i", "う": "ɯ", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "kɯ", "け": "ke", "こ": "ko",
    "が": "ɡa", "ぎ": "ɡi", "ぐ": "ɡɯ", "げ": "ɡe", "ご": "ɡo",
    "さ": "sa", "し": "ɕi", "す": "sɯ", "せ": "se", "そ": "so",
    "ざ": "dza", "じ": "dʑi", "ず": "dzɯ", "ぜ": "dze", "ぞ": "dzo",
    "た": "ta", "ち": "tɕi", "つ": "tsɯ", "て": "te", "と": "to",
    "だ": "da", "ぢ": "dʑi", "づ": "dzɯ", "で": "de", "ど": "do",
    "な": "na", "に": "ɲi", "ぬ": "nɯ", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "çi", "ふ": "ɸɯ", "へ": "he", "ほ": "ho",
    "ば": "ba", "び": "bi", "ぶ": "bɯ", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pɯ", "ぺ": "pe", "ぽ": "po",
    "ま": "ma", "み": "mi", "む": "mɯ", "め": "me", "も": "mo",
    "や": "ja", "ゆ": "jɯ", "よ": "jo",
    "ら": "ɾa", "り": "ɾi", "る": "ɾɯ", "れ": "ɾe", "ろ": "ɾo",
    "わ": "wa", "ゐ": "i", "ゑ": "e", "を": "o",
    "ぁ": "a", "ぃ": "i", "ぅ": "ɯ", "ぇ": "e", "ぉ": "o",
    "ゔ": "bɯ",
}  # fmt: skip

# A small ゃ ゅ ょ after an i-row kana: the whole syllable (きゃ is kja palatalized, しゃ is ɕa).
_YOON_CONSONANT = {
    "き": "kʲ", "ぎ": "ɡʲ", "し": "ɕ", "じ": "dʑ", "ぢ": "dʑ", "ち": "tɕ", "に": "ɲ", "ひ": "ç",
    "び": "bʲ", "ぴ": "pʲ", "み": "mʲ", "り": "ɾʲ",
}  # fmt: skip
_YOON_VOWEL = {"ゃ": "a", "ゅ": "ɯ", "ょ": "o"}
# After a sibilant or affricate the palatal glide is already in the consonant.

_KANA = re.compile(r"^[ぁ-ゖゝゞー]+$")
_VOWELS = "aiɯeo"
_LABIAL = ("p", "b", "m")
_VELAR = ("k", "ɡ")


def _fold(text: str) -> str:
    """Katakana as hiragana."""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in text)


def ipa_of_reading(reading: str) -> str | None:
    """IPA for a reading in kana, as /…/, or None when it has anything else in it (or is empty).

    A word that is only a particle is read as one: は is wa, へ is e, を is o."""
    text = _fold(reading.strip())
    if not text or not _KANA.fullmatch(text):
        return None
    if text in _PARTICLES:
        return f"/{_PARTICLES[text]}/"
    out: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "っ":
            # A double consonant: the next sound's first consonant, doubled; the length mark ː.
            out.append("Q")
            i += 1
            continue
        if ch == "ー":
            out.append("ː")
            i += 1
            continue
        if ch == "ん":
            out.append("N")
            i += 1
            continue
        if ch in ("ゝ", "ゞ"):
            i += 1
            continue
        small = text[i + 1] if i + 1 < len(text) else ""
        if ch in _YOON_CONSONANT and small in _YOON_VOWEL:
            consonant = _YOON_CONSONANT[ch]
            vowel = _YOON_VOWEL[small]
            # しゃ is ɕa and じゃ is dʑa: the glide is in the consonant, so no j.
            out.append(consonant + vowel)
            i += 2
            continue
        if ch in _BASE:
            out.append(_BASE[ch])
            i += 1
            continue
        if ch in _YOON_VOWEL:  # a small ゃ with nothing to join
            out.append("j" + _YOON_VOWEL[ch])
            i += 1
            continue
        return None
    return "/" + _resolve("".join(out)) + "/"


_PARTICLES = {"は": "wa", "へ": "e", "を": "o"}

_NASAL_BEFORE = {"p": "m", "b": "m", "m": "m", "k": "ŋ", "ɡ": "ŋ"}


def _resolve(raw: str) -> str:
    """Replaces the placeholders: っ doubles the next consonant, ん takes its place of articulation
    from what follows (m before a lip sound, ŋ before k or g, n before a tongue-tip sound, ɴ at the
    end), and a long vowel gets its mark."""
    out: list[str] = []
    for i, ch in enumerate(raw):
        nxt = raw[i + 1] if i + 1 < len(raw) else ""
        if ch == "Q":
            out.append(nxt if nxt and nxt not in _VOWELS else "")
        elif ch == "N":
            tip = nxt in ("n", "t", "d", "s", "z", "ɾ", "ɲ", "ɕ", "ç") and nxt != "ɕ"
            out.append(_NASAL_BEFORE.get(nxt, "n" if tip else "ɴ"))
        else:
            out.append(ch)
    text = "".join(out)
    # A vowel repeated, held with ー, or the おう and えい that are held in Tokyo speech, is long.
    text = re.sub(r"([aiɯeo])ː", r"\1ː", text)
    text = re.sub(r"([aiɯeo])\1", r"\1ː", text)
    return re.sub(r"oɯ|ei", lambda m: "oː" if m.group() == "oɯ" else "eː", text)
