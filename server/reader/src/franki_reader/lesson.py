"""Audio lessons (docs/read-and-listen/architecture.md, Audio lessons): a short guided course in the
manner of a prompt-and-answer audio course, made from a scene the owner picks. A narrator speaks
English, a native voice speaks the language, and silences are left for the learner to say each
phrase aloud. The whole lesson is rendered into one MP3, so it plays with the screen locked.

Claude chooses the content only: a short dialogue, and 3 to 5 phrases to teach, each split into
parts. Everything about how it runs is code (`build_script`), never the model's, so the spacing is
exact and the same every time:

1. The dialogue is played once, to listen to.
2. Each phrase is taught: said by the native voice (a bit slower, `TEACH_RATE`), its meaning given, then built up from its last
   part to the whole (backward build-up), the learner repeating each step in a silence.
3. Each phrase is then asked for in English, after a silence, and answered by the native voice.
4. Earlier phrases come back at widening gaps (`RECALL_GAPS`: after 1, then 3, then 6 more phrases
   have been taught), each asked in English with a silence to answer. A recall the phrases run
   out before reaching is dropped, not made up in a closing pass.
5. A few new sentences, never taught whole, are asked for in English: built only from words the
   phrases already used, so the learner puts the pieces together (`Plan.mixes`).
6. The learner then takes speaker A's part in the dialogue (the narrator says whether that is the
   first or the second speaker, as the dialogue really runs): the narrator gives each line in
   English; a line made of words the phrases taught is then asked cold (a silence, then the native
   voice answers), and any other line is said by the native voice first and then repeated in a
   silence, so the learner is never asked for what they weren't given. The other speaker's lines
   are played. A, and every phrase taught, is in the voice of the learner's gender (`Learner`).

The phrases are written as a ladder, each reusing words from the ones before it, so the lesson
builds on itself rather than teaching separate phrases.

Languages written with spaces between words, and Thai (cut into words by `tokens`, its parts joined
with no space).

Generate, then verify: a phrase is kept only if its parts, put back together, are the phrase, and
none is empty. A lesson with fewer than `MIN_PHRASES` kept phrases isn't made. Nothing here grades
a card or writes a note: what the learner says aloud is never heard by the phone.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal

from pythainlp.tokenize import word_tokenize

from franki_reader import japanese
from franki_reader.coverage import Checker, is_word

MIN_PHRASES, MAX_PHRASES = 3, 5
MIN_PARTS, MAX_PARTS = 1, 4
MAX_DIALOGUE = 6
# A lesson made from the learner's own words and phrases (a cram in the app, `clean_given_plan`):
# at most this many, and a dialogue a little longer, to fit more of them.
MAX_GIVEN = 15
MAX_GIVEN_DIALOGUE = 10
# A dialogue line may hold this many words that are neither taught in the lesson nor known to the
# learner (a name, or the one word the scene needs) before the draft goes back to be written again.
MAX_UNFAMILIAR_PER_LINE = 2
MAX_MIXES = 3
MAX_CHARS = 200

# How many more phrases have been taught when an earlier phrase is asked for again.
RECALL_GAPS = (1, 3, 6)

# Silences, in milliseconds: time to start answering plus time per word, kept between a floor and a
# ceiling. Said slowly by a learner who has just heard the phrase, so it's generous.
PAUSE_BASE_MS = 2000
PAUSE_PER_WORD_MS = 700
PAUSE_MIN_MS = 3000
PAUSE_MAX_MS = 15000
# How fast the native voice speaks while a phrase is being taught (the first hearing and the
# repeat-after build-up), where 1.0 is normal. A bit slower so each sound can be copied; asking for
# a phrase and its answer, the dialogue and the role-play stay at normal speed.
TEACH_RATE = 0.8
# The breath between one thing said and the next.
BEAT_MS = 700
# The silence after a native voice speaks, before the narrator (or the next line) comes in: longer
# than a beat so a short phrase isn't cut straight into by the narrator.
AFTER_NATIVE_MS = 1400

Voice = Literal["narrator", "male", "female"]
# Whose part the learner plays: the voice they repeat after, and the first speaker (A) of the
# dialogue. Thai's polite particle follows it (ครับ for a man, ค่ะ for a woman), so it's the learner's
# choice; every other language has the man's voice.
Learner = Literal["male", "female"]


@dataclass(frozen=True)
class Say:
    """A clip to speak: the narrator's English, or a native voice's line in the language."""

    voice: Voice
    text: str
    # Spoken at `TEACH_RATE`. Part of the clip's identity, so a phrase heard slowly while taught and
    # at normal speed when asked for is two recordings.
    slow: bool = False


@dataclass(frozen=True)
class Silence:
    ms: int
    # Where the learner speaks (repeats, answers, says their line), as opposed to a breath between
    # two things said. The app can stop at these and wait for a tap (`lesson_audio.Rendered.pauses`).
    answer: bool = False


def answer(text: str) -> Silence:
    """The silence for saying `text`: sized to it (`pause_ms`), and marked as the learner's turn."""
    return Silence(pause_ms(word_count(text)), answer=True)


Step = Say | Silence


@dataclass(frozen=True)
class Phrase:
    text: str  # the phrase in the language
    english: str
    parts: tuple[str, ...]  # in order; put back together they are `text`


@dataclass(frozen=True)
class Line:
    speaker: Literal["A", "B"]
    text: str
    english: str


@dataclass(frozen=True)
class Plan:
    """What Claude chose for a lesson."""

    title: str
    scene: str
    dialogue: tuple[Line, ...]
    phrases: tuple[Phrase, ...]
    # New sentences made only of words the phrases used, asked for after all are taught. Each is a
    # one-part Phrase.
    mixes: tuple[Phrase, ...] = ()


# A word's letters. Thai's vowel and tone marks aren't `\w` (they're combining marks), so they're
# named, or a Thai word would split at every one.
_WORD = re.compile(r"[\w'\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+", re.UNICODE)
_THAI = re.compile(r"[\u0E00-\u0E7F]")
_JAPANESE = re.compile(r"[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]")
_SPACES = re.compile(r"\s+")


def _unspaced(text: str) -> bool:
    """Whether `text` is in a language written without spaces between words (Thai, Japanese)."""
    return bool(_THAI.search(text) or _JAPANESE.search(text))


def tokens(text: str) -> list[str]:
    """The words of `text`. Thai and Japanese are written without spaces between words, so each is
    cut by the segmenter the rest of the server uses for it (newmm, Sudachi as the reader splits it);
    anything else is split where it's spaced."""
    if _THAI.search(text):
        return [t for t in word_tokenize(text, engine="newmm") if _WORD.search(t)]
    if _JAPANESE.search(text):
        return japanese.words(text)
    return _WORD.findall(text)


def word_count(text: str) -> int:
    return len(tokens(text))


def pause_ms(words: int) -> int:
    """The silence for saying `words` words, to a tenth of a second."""
    raw = min(PAUSE_MAX_MS, max(PAUSE_MIN_MS, PAUSE_BASE_MS + PAUSE_PER_WORD_MS * words))
    return round(raw / 100) * 100


def _squash(text: str) -> str:
    return _SPACES.sub(" ", text).strip()


def _plain(text: str) -> str:
    """Text with the spaces and punctuation that don't matter when parts are put back together."""
    return "".join(_WORD.findall(text.casefold()))


def clean_phrase(raw: object) -> Phrase | None:
    """A phrase Claude wrote, or None if the code doesn't accept it: words and parts present, and
    the parts, put back together, the phrase."""
    if not isinstance(raw, dict):
        return None
    text, english, parts = raw.get("text"), raw.get("english"), raw.get("parts")
    if not isinstance(text, str) or not isinstance(english, str) or not isinstance(parts, list):
        return None
    text, english = _squash(text), _squash(english)
    if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
        return None
    if not all(isinstance(p, str) and _squash(p) for p in parts):
        return None
    chunks = tuple(_squash(p) for p in parts)
    if not MIN_PARTS <= len(chunks) <= MAX_PARTS:
        return None
    if _plain("".join(chunks)) != _plain(text):
        return None
    return Phrase(text, english, chunks)


def words_of(text: str) -> set[str]:
    return set(tokens(text.casefold()))


def _is_phrases_end_to_end(plain: str, phrases: tuple[str, ...]) -> bool:
    """Whether `plain` is nothing but whole phrases (each `_plain`) one after another, in any order
    and with repeats: two phrases said in a row ("soon, don't forget") aren't a new sentence."""
    reach = [True] + [False] * len(plain)
    for end in range(1, len(plain) + 1):
        reach[end] = any(
            reach[end - len(p)] and plain.endswith(p, 0, end)
            for p in phrases
            if p and len(p) <= end
        )
    return reach[len(plain)]


def clean_mix(raw: object, known: set[str], taught: tuple[str, ...] = ()) -> Phrase | None:
    """A new sentence Claude wrote from the taught phrases' words, or None unless every word of it is
    one of `known` (a model told to reuse words doesn't always, so the code checks), and it isn't
    just taught phrases (`taught`, each `_plain`) said one after another. Only a lesson on the
    learner's own words passes `taught`: there the phrases are vocabulary ("soon", "don't forget"),
    and two of them in a row is no sentence, where a written lesson's phrases can make one."""
    if not isinstance(raw, dict):
        return None
    text, english = raw.get("text"), raw.get("english")
    if not isinstance(text, str) or not isinstance(english, str):
        return None
    text, english = _squash(text), _squash(english)
    if not text or not english or len(text) > MAX_CHARS or len(english) > MAX_CHARS:
        return None
    if not words_of(text) or not words_of(text) <= known:
        return None
    if _is_phrases_end_to_end(_plain(text), taught):
        return None
    return Phrase(text, english, (text,))


def clean_plan(
    raw: object, scene: str, *, require_phrases: bool = True, max_dialogue: int = MAX_DIALOGUE
) -> Plan | None:
    """The plan Claude wrote, or None when fewer than `MIN_PHRASES` phrases pass `clean_phrase`
    (a repeated phrase counts once) or the dialogue can't be used. `require_phrases=False` keeps a
    plan with no phrases, for `clean_given_plan`, which brings its own."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    title = _squash(title) if isinstance(title, str) else ""
    dialogue: list[Line] = []
    for item in raw.get("dialogue", []) if isinstance(raw.get("dialogue"), list) else []:
        if not isinstance(item, dict):
            continue
        speaker, text, english = item.get("speaker"), item.get("text"), item.get("english")
        if speaker in ("A", "B") and isinstance(text, str) and isinstance(english, str):
            text, english = _squash(text), _squash(english)
            if text and english and len(text) <= MAX_CHARS:
                dialogue.append(Line(speaker, text, english))
    phrases: list[Phrase] = []
    seen: set[str] = set()
    for item in raw.get("phrases", []) if isinstance(raw.get("phrases"), list) else []:
        phrase = clean_phrase(item)
        if phrase is not None and _plain(phrase.text) not in seen:
            seen.add(_plain(phrase.text))
            phrases.append(phrase)
    if (require_phrases and len(phrases) < MIN_PHRASES) or not dialogue:
        return None
    phrases = phrases[:MAX_PHRASES]
    known = set().union(*(words_of(p.text) for p in phrases))
    taught = {_plain(p.text) for p in phrases}
    mixes: list[Phrase] = []
    for item in raw.get("mixes", []) if isinstance(raw.get("mixes"), list) else []:
        mix = clean_mix(item, known)
        if mix is not None and _plain(mix.text) not in taught:
            taught.add(_plain(mix.text))
            mixes.append(mix)
    return Plan(
        title=title[:80] or scene[:80],
        scene=scene,
        dialogue=tuple(dialogue[:max_dialogue]),
        phrases=tuple(phrases),
        mixes=tuple(mixes[:MAX_MIXES]),
    )


def clean_given_plan(raw: object, scene: str, given: tuple[Phrase, ...]) -> Plan | None:
    """The plan Claude wrote around the learner's own words and phrases (`given`, each one part,
    with its meaning from their card), or None when its dialogue can't be used. Every given phrase
    is taught, as the learner has it and with their meaning: in Claude's order and with Claude's
    parts where it wrote the phrase back exactly (`clean_phrase`, compared without spacing or
    punctuation), then any it left out or changed, whole, in the order given. Claude's own extra
    phrases are dropped."""
    if not isinstance(raw, dict) or not given:
        return None
    base = clean_plan(
        {**raw, "phrases": [], "mixes": []},
        scene,
        require_phrases=False,
        max_dialogue=MAX_GIVEN_DIALOGUE,
    )
    if base is None:
        return None
    by_plain = {_plain(g.text): g for g in given}
    phrases: list[Phrase] = []
    for item in raw.get("phrases", []) if isinstance(raw.get("phrases"), list) else []:
        phrase = clean_phrase(item)
        mine = by_plain.pop(_plain(phrase.text), None) if phrase is not None else None
        if phrase is not None and mine is not None:
            phrases.append(Phrase(mine.text, mine.english, phrase.parts))
    phrases += [g for g in given if _plain(g.text) in by_plain]
    known = set().union(*(words_of(p.text) for p in phrases))
    taught = {_plain(p.text) for p in phrases}
    mixes: list[Phrase] = []
    for item in raw.get("mixes", []) if isinstance(raw.get("mixes"), list) else []:
        mix = clean_mix(item, known, tuple(_plain(p.text) for p in phrases))
        if mix is not None and _plain(mix.text) not in taught:
            taught.add(_plain(mix.text))
            mixes.append(mix)
    return Plan(
        title=base.title,
        scene=scene,
        dialogue=base.dialogue,
        phrases=tuple(phrases[:MAX_GIVEN]),
        mixes=tuple(mixes[:MAX_MIXES]),
    )


def given_phrases(items: list[tuple[str, str]]) -> tuple[Phrase, ...]:
    """The learner's own words and phrases (text, meaning) as one-part phrases, squashed, each
    once, empties and anything over `MAX_CHARS` left out, at most `MAX_GIVEN`."""
    out: dict[str, Phrase] = {}
    for text, english in items:
        text, english = _squash(text), _squash(english)
        if text and english and len(text) <= MAX_CHARS and len(english) <= MAX_CHARS:
            out.setdefault(_plain(text), Phrase(text, english, (text,)))
    return tuple(out.values())[:MAX_GIVEN]


def unfamiliar_words(plan: Plan, lexicon: Checker) -> list[str]:
    """The words, in order and each once, of the dialogue's lines that hold more than
    `MAX_UNFAMILIAR_PER_LINE` words the learner can't be expected to follow: not taught in the
    lesson's phrases and not known (a studied deck word, or one of the language's most common). A
    line within the allowance contributes nothing. The dialogue is played first and acted out last,
    so words from nowhere in it are words the learner never met."""
    # Taught words as this module cuts them and as the checker does (it splits d'eau into d' and eau).
    taught_words = {_plain(w) for p in plan.phrases for w in words_of(p.text)} | {
        _plain(piece) for p in plan.phrases for piece in lexicon.segment(p.text) if is_word(piece)
    }
    taught_text = "".join(_plain(p.text) for p in plan.phrases)
    over: dict[str, None] = {}
    for line in plan.dialogue:
        strangers = [
            piece
            for piece in lexicon.segment(line.text)
            if is_word(piece)
            and lexicon.status(piece) != "known"
            and _plain(piece) not in taught_words
            and not (_unspaced(piece) and _plain(piece) in taught_text)
        ]
        if len(strangers) > MAX_UNFAMILIAR_PER_LINE:
            over.update(dict.fromkeys(strangers))
    return list(over)


def build_up(phrase: Phrase) -> list[str]:
    """What the learner repeats, last part first, growing to the whole phrase (backward build-up):
    "un café s'il vous plaît" in parts un café | s'il vous plaît is "s'il vous plaît", then the
    whole. A phrase of one part has only itself."""
    parts = phrase.parts
    # Thai and Japanese have no spaces between words, and Azure's voice would pause at one.
    joiner = "" if _unspaced(phrase.text) else " "
    steps = [joiner.join(parts[i:]) for i in range(len(parts) - 1, -1, -1)]
    return steps[:-1] + [phrase.text] if len(parts) > 1 else [phrase.text]


def other(learner: Learner) -> Learner:
    return "female" if learner == "male" else "male"


def _ask(phrase: Phrase, learner: Learner) -> list[Step]:
    """The narrator asks for the phrase in English, the learner has a silence to say it, and the
    native voice answers."""
    return [
        Say("narrator", f"How do you say: {phrase.english}"),
        answer(phrase.text),
        Say(learner, phrase.text),
        Silence(AFTER_NATIVE_MS),
    ]


def _teach(phrase: Phrase, learner: Learner) -> list[Step]:
    steps: list[Step] = [
        Say("narrator", "Listen."),
        Say(learner, phrase.text, slow=True),
        Silence(AFTER_NATIVE_MS),
        Say("narrator", f"That means: {phrase.english}"),
        Silence(BEAT_MS),
    ]
    steps.append(Say("narrator", "Listen and repeat."))
    for chunk in build_up(phrase):
        steps += [
            Say(learner, chunk, slow=True),
            answer(chunk),
        ]
    return steps


def _dialogue(lines: tuple[Line, ...], intro: str, learner: Learner) -> list[Step]:
    steps: list[Step] = [Say("narrator", intro), Silence(BEAT_MS)]
    for line in lines:
        steps += [
            Say(learner if line.speaker == "A" else other(learner), line.text),
            Silence(AFTER_NATIVE_MS),
        ]
    return steps


def _role_play(
    lines: tuple[Line, ...], learner: Learner, taught_words: set[str] | None = None
) -> list[Step]:
    """The learner is speaker A: the narrator gives each of their lines in English. A line made only
    of `taught_words` (words from the phrases taught) is asked cold: a silence, then the native voice
    answers. Any other line is new to them, so the native voice says it first and the silence that
    follows is for repeating it. B's lines are played. The narrator says whether A speaks first or
    second, as the dialogue runs."""
    known = taught_words or set()
    starts = lines[0].speaker == "A" if lines else True
    steps: list[Step] = [
        Say(
            "narrator",
            "Now take part in the conversation. You are the first speaker."
            if starts
            else "Now take part in the conversation. You are the second speaker, so you will hear"
            " the first line before you speak.",
        ),
        Silence(BEAT_MS),
    ]
    if any(line.speaker == "A" and not words_of(line.text) <= known for line in lines):
        steps += [
            Say("narrator", "When a line is new, you will hear it first and then say it."),
            Silence(BEAT_MS),
        ]
    for line in lines:
        if line.speaker == "B":
            steps += [Say(other(learner), line.text), Silence(AFTER_NATIVE_MS)]
        elif words_of(line.text) <= known:
            steps += [
                Say("narrator", f"You say: {line.english}"),
                answer(line.text),
                Say(learner, line.text),
                Silence(AFTER_NATIVE_MS),
            ]
        else:
            steps += [
                Say("narrator", f"You say: {line.english}"),
                Say(learner, line.text),
                answer(line.text),
            ]
    return steps


def build_script(plan: Plan, learner: Learner = "male") -> list[Step]:
    """The lesson, step by step (see the module's docstring for its shape). The native voice the
    learner repeats after, and speaker A, is `learner`'s; speaker B is the other."""
    steps = _dialogue(plan.dialogue, f"{plan.title}. Listen to this conversation.", learner)
    # Recalls waiting: (phrase index, taught count at which it's asked).
    due: list[tuple[int, int]] = []
    steps.append(Say("narrator", "Now let's learn how to say some of it."))
    for taught, phrase in enumerate(plan.phrases, start=1):
        steps += _teach(phrase, learner)
        steps += _ask(phrase, learner)
        due += [(taught - 1, taught + gap) for gap in RECALL_GAPS]
        steps += [
            s for index, at in due if at == taught for s in _ask(plan.phrases[index], learner)
        ]
        due = [d for d in due if d[1] > taught]
    # Recalls the phrases ran out before reaching are dropped: the mixes and the role-play bring
    # the phrases back, and a closing pass was only the same question asked once more.
    if plan.mixes:
        steps.append(
            Say(
                "narrator",
                "Now put them together. These sentences are new, built from what you know.",
            )
        )
        for mix in plan.mixes:
            steps += _ask(mix, learner)
    taught_words = set().union(*(words_of(p.text) for p in plan.phrases))
    steps += _role_play(plan.dialogue, learner, taught_words)
    steps.append(Say("narrator", "That's the end of the lesson."))
    return steps


def clips(steps: list[Step]) -> list[Say]:
    """Each distinct thing spoken, in order of first use, so it's recorded once however often it's
    heard."""
    seen: dict[Say, None] = {}
    for step in steps:
        if isinstance(step, Say):
            seen.setdefault(step)
    return list(seen)


def duration_ms(steps: list[Step], lengths: dict[Say, int]) -> int:
    """How long the lesson runs, given each clip's length in milliseconds."""
    return sum(s.ms if isinstance(s, Silence) else lengths.get(s, 0) for s in steps)


def characters(steps: list[Step]) -> int:
    """Characters Azure bills for, counting each distinct clip once."""
    return sum(len(c.text) for c in clips(steps))


def describe(plan: Plan) -> dict[str, Any]:
    """The plan as the app shows it: the title, the phrases taught, and the dialogue."""
    return {
        "title": plan.title,
        "scene": plan.scene,
        "phrases": [{"text": p.text, "english": p.english} for p in plan.phrases],
        "dialogue": [
            {"speaker": line.speaker, "text": line.text, "english": line.english}
            for line in plan.dialogue
        ],
    }


@dataclass(frozen=True)
class Placed:
    """A step where it falls in the lesson's audio, in milliseconds from the start."""

    step: Step
    start: int
    end: int


_PROMPTS = ("How do you say:", "You say:")


def script_of(plan: Plan, placed: list[Placed]) -> dict[str, Any]:
    """What the app follows the lesson with (docs/read-and-listen/architecture.md, Audio lessons):
    each thing said, and each turn of the learner's, with where it falls; and where each phrase is
    first said at normal speed, so it can be cut out for a card.

    A turn's `text` is what the learner is to say: the native line after it when the narrator has
    just asked for it, otherwise the native line just heard (a repeat). Its `english` is the
    phrase's, mix's or dialogue line's meaning, and none for a part being built up. `replay` is where
    its prompt starts (the run of things said with no silence between, before the turn), for Again.
    """
    meanings = {p.text: p.english for p in (*plan.phrases, *plan.mixes)}
    meanings.update({line.text: line.english for line in plan.dialogue})
    entries: list[dict[str, Any]] = []
    for i, here in enumerate(placed):
        step = here.step
        if isinstance(step, Say):
            native = step.voice != "narrator"
            entries.append(
                {
                    "kind": "say",
                    "voice": "native" if native else "narrator",
                    "text": step.text,
                    "english": meanings.get(step.text) if native else None,
                    "start": here.start,
                    "end": here.end,
                }
            )
            continue
        if not step.answer:
            continue
        before = placed[i - 1].step if i > 0 else None
        after = placed[i + 1].step if i + 1 < len(placed) else None
        asked = isinstance(before, Say) and before.text.startswith(_PROMPTS)
        expected = after if asked else before
        if not isinstance(expected, Say) or expected.voice == "narrator":
            continue
        replay = i
        while replay > 0 and isinstance(placed[replay - 1].step, Say):
            replay -= 1
        entries.append(
            {
                "kind": "turn",
                "text": expected.text,
                "english": meanings.get(expected.text),
                "start": here.start,
                "end": here.end,
                "replay": placed[replay].start if replay < i else here.start,
            }
        )
    # A phrase for a card is the answer to its question (the learner's own voice, normal speed);
    # failing that, anywhere it's said at normal speed (a dialogue line).
    clips: list[list[int] | None] = []
    for phrase in plan.phrases:
        said = [
            (i, p)
            for i, p in enumerate(placed)
            if isinstance(p.step, Say)
            and p.step.voice != "narrator"
            and not p.step.slow
            and p.step.text == phrase.text
        ]
        answers = [
            p
            for i, p in said
            if i > 0 and (gap := placed[i - 1].step) and isinstance(gap, Silence) and gap.answer
        ]
        best = answers[0] if answers else said[0][1] if said else None
        clips.append(None if best is None else [best.start, best.end])
    return {"entries": entries, "phrase_clips": clips}


# A review (lesson_service.make_review): phrases from earlier lessons the learner asked to hear
# again or answered slowly. Offered once there are REVIEW_MIN of them, and made of at most REVIEW_MAX.
REVIEW_MIN = 3
REVIEW_MAX = 12
REVIEW_TITLE = "Review"


def review_plan(phrases: tuple[Phrase, ...]) -> Plan:
    n = len(phrases)
    return Plan(
        REVIEW_TITLE,
        f"{n} {'phrase' if n == 1 else 'phrases'} from earlier lessons",
        (),
        phrases,
    )


def build_review(plan: Plan, learner: Learner = "male") -> list[Step]:
    """Each phrase asked for in English and answered, then all of them once more in the other
    order, so each comes back after the others have been in between. Nothing new is taught."""
    steps: list[Step] = [
        Say("narrator", "A review of phrases from your earlier lessons."),
        Silence(BEAT_MS),
    ]
    for phrase in plan.phrases:
        steps += _ask(phrase, learner)
    if len(plan.phrases) > 1:
        steps += [Say("narrator", "Once more, in a different order."), Silence(BEAT_MS)]
        for phrase in reversed(plan.phrases):
            steps += _ask(phrase, learner)
    steps.append(Say("narrator", "That's the end of the review."))
    return steps
