"""
The deck's Thai romanization, in one place for the MCP (server/mcp: the house style `add_notes`
holds a note to, and `lint_notes`) and Read & Listen (server/reader: the note queue's drafts), so
the scheme a model is asked to write and the scheme a note is checked against can't drift apart.
Pure: no network, no Azure. It lives in this package only because both servers already install it.
"""

from __future__ import annotations

import re
import unicodedata

THAI_SCHEME = """\
Thai romanization, derived from the Thai spelling by the tone rules:
- Initials: ก g; ข ค ฆ kh; จ j; ฉ ช ฌ ch; ด ฎ d; ต ฏ dt; บ b; ป bp; ถ ฐ ท ธ ฑ ฒ th; ผ พ ภ ph; ฝ ฟ f; ซ ศ ษ ส s;
  ง ng; ญ ย y; น ณ n; ม m; ร r; ล ฬ l; ว w; ห ฮ h; อ nothing. Finals: k t p ng n m.
- Vowels, short / long: a / aa, i / ii, ue / uue, u / uu, e / ee, ae / aae, o / oo, aw / aaw, ə / əə.
  Diphthongs written once: ia, uea, ua. -ำ am (น้ำ alone náam). ไ ใ ai; -าย aai; เ-า ao; -าว aao.
- A final ย is i (sǔai, ráawi, ləəi); a final ว is o (láaeo, reo, dǐao), or u after i (hǐu).
- Tones: mid no mark, low à, falling â, high á, rising ǎ, on the syllable's first vowel letter.
- Lowercase, no punctuation. Syllables of a word joined by hyphens, words separated by spaces.
- In ContextRomanized the Entry is spelled exactly as in Transliteration, hyphens included."""

LETTERS_ADVICE = (
    "Use the deck's scheme: dt and bp for ต and ป, th ph kh for the aspirated letters, g for ก; "
    "aw / aaw, ae / aae, ue / uue, əə for the vowels; lowercase."
)
TONELESS_ADVICE = (
    "Add the tone marks (low à, falling â, high á, rising ǎ; mid none), derived from the Thai "
    "spelling by the tone rules."
)

_MARKS = re.compile(r"[̀-ͯ]")
# The tone each combining mark writes. Mid has no mark.
_MARK_TONE = {"̀": "low", "̂": "falling", "́": "high", "̌": "rising"}
# The tone letters Wiktionary's Thai IPA writes after a syllable, and the tone each is.
_IPA_TONE = {"˧": "mid", "˨˩": "low", "˥˩": "falling", "˦˥": "high", "˩˩˦": "rising"}
_IPA_SYLLABLE = re.compile(r"^(.*?)([˥˦˧˨˩]+)$")


def letters_wrong(text: str) -> bool:
    """True when `text` uses a letter or spelling outside the scheme (an unaspirated t, p or k, a
    capital, an IPA vowel the scheme doesn't have, punctuation)."""
    bare = _MARKS.sub("", unicodedata.normalize("NFD", text))
    return bool(re.search(r"[^a-zə\s-]|(?:^|[\s-])(?:t(?!h)|p(?!h)|k(?!h))", bare))


def syllables(text: str) -> list[str]:
    """A romanization's syllables: split at spaces and hyphens."""
    return re.findall(r"[^\s-]+", text)


def is_toneless(sentence: str) -> bool:
    """A sentence of four or more syllables with not one tone mark: every one mid tone does not
    happen, so the tones were left off."""
    return len(syllables(sentence)) >= 4 and not _MARKS.search(
        unicodedata.normalize("NFD", sentence)
    )


def tones_of(text: str) -> list[str]:
    """The tone each syllable of a romanization is marked with (mid when it has no mark)."""
    out: list[str] = []
    for syllable in syllables(text):
        marks = [_MARK_TONE[m] for m in unicodedata.normalize("NFD", syllable) if m in _MARK_TONE]
        out.append(marks[0] if marks else "mid")
    return out


def tones_of_ipa(ipa: str) -> list[str] | None:
    """The tone of each syllable of a Thai IPA transcription written with tone letters
    (/pʰuː˧.kʰaw˩˩˦/), or None when it has none or one this doesn't know, so a check built on it
    stays silent rather than guess."""
    inner = ipa.strip().strip("/[]")
    out: list[str] = []
    for syllable in re.split(r"[.\s]+", inner):
        if not syllable:
            continue
        match = _IPA_SYLLABLE.match(syllable)
        tone = _IPA_TONE.get(match.group(2)) if match else None
        if tone is None:
            return None
        out.append(tone)
    return out or None


def tone_mismatch(transliteration: str, ipa: str) -> tuple[list[str], list[str]] | None:
    """The tones the romanization marks and the tones the IPA gives, when they differ; None when they
    agree or can't be compared (no romanization yet). With the same number of syllables each is compared in turn. With a
    different number (a romanization written without hyphens is one token, a loanword splits
    differently) the marked tones are compared in order, which doesn't depend on where the syllables
    break: `phukhao` marks none and the IPA has a rising one."""
    heard = tones_of_ipa(ipa)
    if heard is None:
        return None
    written = tones_of(transliteration)
    if not written:  # an empty romanization is its own problem, reported as missing
        return None
    if len(written) == len(heard):
        return None if written == heard else (written, heard)
    marked = [t for t in written if t != "mid"]
    return None if marked == [t for t in heard if t != "mid"] else (written, heard)
