"""A scripted model and sample deck shared by the engine, reader and API tests."""

from typing import Any

from franki_reader.generator import Usage
from franki_reader.lexicon import Entry

ENTRIES = [
    Entry(1, "ฉัน", "I; me", "mature"),
    Entry(2, "อยาก", "want to", "mature"),
    Entry(3, "กิน", "eat", "mature"),
    Entry(4, "ข้าวเหนียวมะม่วง", "mango sticky rice", "young", due=True),
    Entry(5, "ครับ", "polite particle (male)", "mature"),
    Entry(6, "รับอะไรดี", "what would you like?", "mature"),
    Entry(7, "ทอน", "give change", "unreviewed"),
]


def draft(*texts: str, glosses: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "title": "At the stall",
        "roles": {"A": "Vendor", "B": "Customer"},
        "genders": {"A": "male", "B": "male"},
        "lines": [
            {"speaker": "AB"[i % 2], "text": t, "english": f"line {i}"} for i, t in enumerate(texts)
        ],
        "glosses": [{"word": w, "english": e} for w, e in (glosses or {}).items()],
    }


GOOD = draft("ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ", "*ข้าวเหนียวมะม่วง*|ครับ!")
# The same text with one word off the list in 20: 95%, inside the range the engine asks for (the
# default target is 92%, so nothing above 96% passes). GOOD is all known words, for tests with no
# ceiling.
IN_RANGE = draft(
    "ฉัน|อยาก|กิน|*ข้าวเหนียวมะม่วง*|ครับ|ฉัน|อยาก|กิน|ทอน|ครับ",
    "*ข้าวเหนียวมะม่วง*|ครับ!|ฉัน|อยาก|กิน|ครับ|ฉัน|อยาก|กิน|ครับ",
    glosses={"ทอน": "give change"},
)
BAD = draft("ทอน|ทอน|ฉัน")


class ScriptedModel:
    """Returns the given drafts in order, then repeats the last one. An exception in their place
    is raised, as a failed call would."""

    def __init__(self, *drafts: dict[str, Any] | Exception) -> None:
        self.drafts = list(drafts)
        self.calls = 0
        self.entries_seen: list[list[Entry]] = []
        self.languages_seen: list[str] = []
        self.messages_seen: list[list[dict[str, Any]]] = []

    def ask_for(self, entries: list[Entry], language: str = "th") -> Any:
        self.entries_seen.append(entries)
        self.languages_seen.append(language)

        async def ask(messages: list[dict[str, Any]]) -> tuple[dict[str, Any], list[Any], Usage]:
            self.calls += 1
            self.messages_seen.append(list(messages))
            d = self.drafts.pop(0) if len(self.drafts) > 1 else self.drafts[0]
            if isinstance(d, Exception):
                raise d
            return d, [{"type": "text", "text": "draft"}], Usage(100, 500, 2000, 0)

        return ask
