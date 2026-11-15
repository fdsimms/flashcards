"""What Read & Listen's Story characters screen has the voices say, so a voice and pitch can be
heard before one is chosen (docs/read-and-listen/architecture.md, Audio: Story voices).

A sample is one line a character might say. The scene is the same line from a girl, an answer from
a woman, and a sentence from the narrator, read in the voices a story would give them, as one
recording in several voices like a story's lines (cast.line_parts). Thai's polite ending is the
speaker's, so its sample has a man's and a woman's.
"""

from franki_speech import Part

from franki_reader.cast import Preset
from franki_reader.languages import Code, Gender

# language -> (what the narrator says, what the girl says, what the woman answers)
SCENES: dict[Code, tuple[str, str, str]] = {
    "th": ("ในครัวมีไฟเปิดอยู่ แต่แม่ไม่อยู่ที่นั่น", "“แม่คะ ไปตรงนั้นไม่ได้นะคะ”", "“ทำไมไปไม่ได้ล่ะ”"),
    "es": (
        "En la cocina hay una luz encendida, pero mamá no está.",
        "«¡Mamá, ahí no se puede entrar!»",
        "«¿Por qué no se puede?»",
    ),
    "de": (
        "In der Küche brennt Licht, aber Mama ist nicht da.",
        "„Mama, da darfst du nicht hin!“",
        "„Warum denn nicht?“",
    ),
    "fr": (
        "Dans la cuisine, la lumière est allumée, mais maman n’est pas là.",
        "« Maman, on ne peut pas aller là ! »",
        "« Pourquoi pas ? »",
    ),
    "ru": (
        "На кухне горит свет, но мамы там нет.",
        "«Мама, туда нельзя!»",
        "«Почему нельзя?»",
    ),
    "el": (
        "Στην κουζίνα ανάβει φως, αλλά η μαμά δεν είναι εκεί.",
        "«Μαμά, εκεί δεν πρέπει να πας!»",
        "«Γιατί όχι;»",
    ),
    "pl": (
        "W kuchni pali się światło, ale mamy tam nie ma.",
        "„Mamo, tam nie wolno!”",
        "„Dlaczego nie wolno?”",
    ),
    "nb": (
        "Det er lys på kjøkkenet, men mamma er ikke der.",
        "«Mamma, du kan ikke gå dit!»",
        "«Hvorfor ikke?»",
    ),
    "ja": (
        "台所に明かりがついていますが、お母さんはいません。",
        "「お母さん、そこに行ってはいけません！」",
        "「どうしてだめなの？」",
    ),
    "en": (
        "The kitchen light is on, but Mom isn’t there.",
        "“Mom, you can’t go there!”",
        "“Why not?”",
    ),
}
# A man in Thai ends it with ครับ where the girl's and a woman's is คะ.
_THAI_MAN = "“แม่ครับ ไปตรงนั้นไม่ได้นะครับ”"


def sample_line(language: Code, gender: Gender) -> str:
    """One line a character of `gender` might say, in the language."""
    if language == "th" and gender == "male":
        return _THAI_MAN
    return SCENES[language][1]


def scene_parts(language: Code, narrator: str, girl: Preset, woman: Preset) -> list[Part]:
    """The scene as the voices that speak it: the narrator, then the girl, then the woman."""
    said, asks, answers = SCENES[language]
    return [
        Part(said + " ", narrator),
        Part(asks + " ", girl.voice, girl.pitch),
        Part(answers, woman.voice, woman.pitch),
    ]
