"""The HTTP API the iOS app calls. Every /api route needs the passphrase as a bearer token
(docs/read-and-listen/architecture.md, Hosting); /health doesn't, so it shows whether the server is up. Caddy
serves all of it under /reader (../../Caddyfile), so the app's address ends in /reader.

    GET   /api/check                  204 if the passphrase is right
    GET   /api/status                 what's due in Anki now and whether a Read & Listen text is
                                      waiting, for another app (dundundun). Opens with the
                                      passphrase or STATUS_TOKEN, a key for this route alone:
                                      {reviews, learning, learning_later: [{at, count}],
                                      decks: [{name, reviews, learning}], day_ends_at,
                                      read_and_listen: {language, name, waiting, last_read_at},
                                      study_days: [{starts_at, cards, answer_seconds,
                                      reading_seconds}] (the last 7 study days, today last),
                                      franki: {due, new, reported_at} or null (Franki's own deck
                                      list counts, progress gates included, when it reported
                                      them since today's study day began)}
    PUT   /api/franki-counts          {due, new} the app's deck list totals, sent after each sync
                                      while the app's "Share today's counts" setting is on
    GET   /api/topics                 topics with their state and ready count; tops up in the background
    POST  /api/topics                 {name} adds a topic (or returns the existing one)
    DELETE /api/topics/{id}           removes a topic from the list (adding it again brings it back)
    GET   /api/suggestions            topic ideas not yet added, the best fit for the deck first
    POST  /api/topics/{id}/next       the next text for a topic; 202 {"writing": true} while one is
                                      being written in the background, so ask again shortly. With
                                      {words: [...]}, a text written to practice those words
    GET   /api/settings               {stretch_words: "topic" | "any", lines: 6 | 8 | 12,
                                      form: "dialogue" | "story", language: "th" | "es" | ...,
                                      decks: {th: <deck>, es: <deck>, ...},
                                      voices: {th: {male: <voice>, male2: <voice>, female: <voice>,
                                      female2: <voice>}, es: {...}, ...}, a text's speakers are
                                      read in the voice of their gender (second voices for a
                                      dialogue between two men or two women),
                                      common: {es: 10000, de: 3000, ...}} (every language but
                                      Thai: how many of its most common words count as known)

Topics are shared by every language. Everything else (ready texts, /next, progress, past texts,
marked words, ideas) is in the current language, the `language` setting.
    PATCH /api/settings               the same fields; takes effect from the next text written. A
                                      changed deck is read again at once; texts waiting to be read
                                      are spoken again in changed voices
    GET   /api/shelf                  the current language's shelf: the texts waiting (each
                                      with why it's there), the ongoing story and its next episode,
                                      what's being written, and each language's
                                      count of texts waiting; tops up in the background
    POST  /api/shelf/write            {name, form} writes a text on a topic typed in; it joins the
                                      shelf when it's ready (202)
    POST  /api/story                  {about?} starts a new story in the current language, retiring
                                      the one before it, and writes its first episode (202)
    POST  /api/texts/{id}/skip        takes a text off the shelf unread (Not this); 404 if it isn't
                                      waiting
    GET   /api/texts                  texts read to the end, newest first, to read again; with
                                      ?story=<id>, that story's episodes, first to last
    GET   /api/texts/{id}             one text, in the same shape as /next; reading it again isn't logged
    POST  /api/texts/{id}/reading     logs a session with a text and adjusts difficulty, from its
                                      rating and the check after reading's score (check_right of
                                      check_asked, both left out when it wasn't taken)
    POST  /api/texts/{id}/choice      {choice} the option picked at the end of a story episode, as an
                                      index into its choices; it can be changed until the episode is
                                      read, which is when the next one is written from it (404 for
                                      no such text or choice, 409 once it's read)
    GET   /api/progress               finished texts, coverage and ratings over the last 14 days,
                                      the check after reading's answers over them, and the
                                      difficulty the next text is written at
    GET   /api/costs?days=30          what Claude cost over the last `days` days, per language:
                                      texts read, waiting, dropped and skipped, attempts and dollars,
                                      plus Azure's audio estimated from the characters it spoke (every
                                      language, not just the current one; the MCP's
                                      read_and_listen_costs reads it). Then, over the same days,
                                      apart from the texts: `explanations`, what Explain's calls
                                      (lines and phrases) and the naturalness check cost;
                                      `drills`, `meanings` (glossing common words), `vocab_checks`
                                      and `note_queue`; `mnemonics`, memory hints; `questions`,
                                      the check after reading's questions (comprehension.py);
                                      `forms`, the grammatical form picked for a text's inflected
                                      words (forms.py); and
                                      `recordings`, the cards recorded through /api/speech, as
                                      Azure's characters and their estimate. A call that failed
                                      after Claude answered was still paid for, and counts in its
                                      feature's figure
    GET   /api/grammar                the current language's grammar points, each practice, avoid,
                                      normal ("Know it") or unset, with how often each came up in
                                      texts read; `least`, the known ones worked in next;
                                      `stretch`: {uses, next}, how many times a text may use
                                      grammar not set, and the easiest point to practice next
    GET   /api/grammar/choices        {choices}: every language's choices by point id (practice,
                                      avoid or normal; a point not set isn't listed), for the
                                      app's Forms practice (docs/grammar.md)
    POST  /api/drills                 {points, count?} a grammar drill's questions (drills.py), each
                                      {kind: "which", point, line, words, english, title, choices}
                                      or {kind: "gap", id, point, before, answer, after, english,
                                      wrong, hint}; `missing` names points that got none. Writes
                                      more gap questions in the background when Claude is set up
    GET   /api/vocab-check?language=pl   the vocabulary check's questions (vocab_check.py): {state:
                                      "ready", items: [{word, rank, meaning, wrong}]} without the
                                      deck's words, or "preparing" (Claude is writing them, ask
                                      again soon), "failed" or "unavailable"; not for Thai. The
                                      quiz and its scoring are in the app
    GET   /api/note-queue             the owner's queued words (note_queue.py): {available, items: [{id,
                                      language, deck, entry, meaning, state: "waiting" | "ready" |
                                      "failed", fields, error}]}. `fields` is what Claude filled in,
                                      by Anki field name, for a ready word. Starts filling any that are
                                      due; the app asks again every few seconds while some are waiting
    POST  /api/note-queue             {language, deck, entries: [{entry, meaning?}]} queues words for
                                      Claude to fill in; 503 without a Claude key
    POST  /api/note-queue/{id}/retry  a failed word waiting to be filled again
    DELETE /api/note-queue/{id}       takes a word off the queue (after the app saves it, or on remove)
    GET   /api/grammar/{id}           one point's page: {id, state, seen, choices (its language's,
                                      for the related points), examples: [{text_id, title, line,
                                      english, words}]}, lines from texts read, the latest first
    PUT   /api/grammar/stretch        {uses: 1 to 4}: how many times the next texts may use grammar
                                      not set (the Grammar dial on the wrap-up screen); answers as
                                      GET /api/grammar does
    PUT   /api/grammar/level          {through: 5 to 1}: "I know through N_" (Japanese): each point
                                      at that JLPT level or easier becomes Know it unless it's
                                      practiced, each above it Don't know it; answers as GET
                                      /api/grammar does, where each point has its `jlpt`
    PUT   /api/grammar/{id}           {state}; at most 2 practiced at once; from the next text
    GET   /api/forms?language=ru      the grammatical forms a word can be marked as in that language
                                      and the primer for each (form_primers.py): {forms: [{id, name,
                                      summary, table, examples}]}; none for Thai, which has no
                                      inflection
    GET   /api/words                  words marked unknown and not cleared, newest first
    POST  /api/words/clear            {word} takes a word off that list until it's marked again
    GET   /api/texts/{id}/lines/{n}/audio   one line's MP3, made now if it isn't cached yet
    GET   /api/voices?language=th     Azure's voices in a language (any code: th, pl, es-MX) and then
                                      its Multilingual voices of other locales, for the speakers
                                      here and for recording cards in the app
    POST  /api/speech                 {text, voice, rate?, language?} the text spoken by an Azure
                                      voice, as MP3: the app records a card's audio with it and
                                      keeps the file, so each recording is asked for once. The
                                      language (th-TH, or th) tells a Multilingual voice what to read
                                      the text as
    POST  /api/texts/{id}/lines/{n}/explain   {simple?} the line's grammar and vocabulary explained in
                                      English by Claude: {points: [{phrase, note}]}. Asked on the
                                      owner's tap and kept per line (and per simple version).
                                      With `grammar`: the points the finders find in the line,
                                      each {id, name, note, state}, as the choices stand now
    POST  /api/texts/{id}/lines/{n}/phrase    {phrase, simple?} a phrase the owner selected in the
                                      line, as it appears there, explained by Claude:
                                      {meaning, points: [{phrase, note}]}. Kept per phrase, like
                                      the line's
    POST  /api/texts/{id}/lines/{n}/natural   whether a native speaker would say the line, judged by
                                      Claude: {verdict, reason, alternative}, verdict one of
                                      natural, stiff, unusual. Asked on the owner's tap and kept
                                      per line
    POST  /api/production/check       {kind, language, attempt, word?, meaning?, english?, reference?}
                                      the owner's own writing checked by Claude (production.py):
                                      a sentence with `word` (kind "sentence") or their way of
                                      saying `english` (kind "translate", `reference` the sentence
                                      written for it): {verdict, corrected, english, notes,
                                      used_word}, verdict one of right, almost, wrong. Asked on the
                                      owner's tap, never kept
    POST  /api/texts/{id}/retell      {attempt} the owner's retelling of the text, checked the same
                                      way, plus {words: [{word, english, line}], left_out}: words
                                      from the text it could have used, and what it left out
    POST  /api/sentences              {language, count?} sentences to say (sentences.py), one a
                                      word, reviewed-today words first: {sentences: [{id, word,
                                      meaning, sentence, english, reviewed_today}], writing}. More
                                      are written in the background; never a word waiting for its
                                      review
    GET   /api/situations/scenes      ?language= scenes to pick from for Situations (situations.py):
                                      everyday situations, best fit to the deck first (Thai)
    POST  /api/situations/turn        {language, scene, roles?, lines: [{speaker, text}]} the other
                                      person's next line, written by Claude from the deck's words:
                                      {line, english, words: [word], unknown, done, roles?, audio}.
                                      The first turn (no lines) also sets `roles` {you, them, name,
                                      gender}, which the app sends back on every turn after. `audio`
                                      is a clip's key, or null. Nothing is kept: the app holds the
                                      conversation
    POST  /api/situations/feedback    {language, scene, roles, lines} at the end: each of the
                                      owner's lines checked {index, verdict, corrected, note}, and
                                      words worth adding {word, english, why: asked | heard}
    GET   /api/situations/audio/{key} a clip of one of the other person's lines (MP3)
    POST  /api/pronunciation          {language, reference, audio} a take of the owner's (base64 WAV,
                                      16 kHz mono) scored against `reference` by Azure's
                                      pronunciation assessment: {accuracy, fluency, completeness,
                                      heard, words: [{word, accuracy, band, error, syllables,
                                      weakest}]}. 422 for a language Azure doesn't score. The take
                                      isn't kept
    POST  /api/mnemonics              {language, entry, meaning, transliteration?, context?} three
                                      memory hints for a word the owner keeps forgetting: {hints: [...]}
    POST  /api/glosses                {language, sentences: [{text, english?}]} cards' example
                                      sentences split and glossed as a text's lines are, for the
                                      app's word popovers on a card: {ready, sentences: [[word]]},
                                      in the order sent. `ready` is false (and `sentences` empty)
                                      until the language's deck has been read. Asked once for a
                                      whole study session; afterwards, in the background, reads the
                                      deck if it's a day old and has Claude gloss the words that
                                      had no meaning, so they have one next time
"""

import hmac
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

import anthropic
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse, JSONResponse
from franki_speech import SpeechClient, SpeechError, is_multilingual, locale_of, text_locale
from pydantic import BaseModel, Field

from franki_reader import (
    comprehension,
    config,
    drills,
    exposure,
    form_primers,
    forms,
    grammar,
    meanings,
    note_queue,
    production,
    pronunciation,
    sentences,
    situations,
    store,
    timing,
    vocab_check,
)
from franki_reader.collection import AnkiDeck, SyncSettings
from franki_reader.coverage import parse_line
from franki_reader.engine import Engine, NotAvailable, NotFound
from franki_reader.explain import (
    CheckNatural,
    CheckRequest,
    Explain,
    ExplainFailed,
    ExplainPhrase,
    ExplainRequest,
    PhraseRequest,
    claude_check,
    claude_explain,
    claude_explain_phrase,
)
from franki_reader.gateway import AnkiUnavailable, ReadDue, due_with_timeout, with_timeout
from franki_reader.generator import Ask, Form, Usage, claude_ask
from franki_reader.languages import (
    HIDDEN_LANGUAGES,
    LANGUAGES,
    Code,
    CommonCount,
    VoiceSlot,
    speech_locale,
    with_deck,
)
from franki_reader.lexicon import Entry
from franki_reader.mnemonics import (
    MakeMnemonics,
    MnemonicRequest,
    MnemonicsFailed,
    claude_mnemonics,
)
from franki_reader.reader import (
    from_wanikani,
    gloss_for,
    lemma_for,
    parts_for,
    render,
    render_line,
    render_sentence,
)
from franki_reader.store import Length, Reading, Settings, StoredText, StretchWords, Topic
from franki_reader.stretch import reviewed_words
from franki_reader.stretch import waiting as waiting_for_review
from franki_reader.study_day import DEFAULT_ROLLOVER
from franki_reader.suggestions import suggest
from franki_reader.tts import (
    AudioCache,
    ClipCache,
    Speech,
    TtsFailed,
    azure_synthesize,
    azure_usd,
    billed_chars,
)
from franki_reader.wanikani import wanikani_reader

# The window the progress summary covers: the Milestone 1 exit check's two weeks.
VOCAB_RETRY = timedelta(minutes=10)  # before a vocabulary check bank that failed is written again
MAX_QUEUED = 50  # words one Quick add can queue
MAX_GLOSS_SENTENCES = 1000  # example sentences one /api/glosses call can ask about
PROGRESS_DAYS = 14
# How many past texts the list shows.
PAST_TEXTS = 50
# The longest text /api/speech speaks: a card's word or sentence, never a whole text.
MAX_SPEECH_CHARS = 500


class NewTopic(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class GrammarChoice(BaseModel):
    state: Literal["practice", "avoid", "normal"]


class GrammarLevelIn(BaseModel):
    through: int = Field(ge=1, le=5)  # 5 is N5 (the easiest) up to 1 for N1


class GrammarStretchIn(BaseModel):
    uses: int = Field(ge=grammar.MIN_UNSET_USES, le=grammar.MAX_UNSET_USES)


class ClearWord(BaseModel):
    word: str = Field(min_length=1, max_length=100)


class SettingsUpdate(BaseModel):
    stretch_words: StretchWords | None = None
    lines: Length | None = None
    form: Form | None = None
    language: Code | None = None
    # A language's deck by its full Anki name; an empty name goes back to the default.
    decks: dict[Code, Annotated[str, Field(max_length=500)]] | None = None
    # How many of a language's most common words count as known. Not Thai's: only its deck counts.
    common: dict[Code, CommonCount] | None = None
    # An Azure voice for each of a language's voice slots; an empty name goes back to the default.
    voices: dict[Code, dict[VoiceSlot, Annotated[str, Field(max_length=100)]]] | None = None


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SPEECH_CHARS)
    voice: str = Field(min_length=1, max_length=100)
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    # The text's language (th-TH, or a code here: th), for a Multilingual voice to read it in. An
    # app from before it was sent leaves it out, and the voice guesses from the text as before.
    language: str | None = Field(default=None, min_length=2, max_length=20)


class QueuedEntry(BaseModel):
    entry: str = Field(min_length=1, max_length=200)
    meaning: str = Field(default="", max_length=300)


class NoteQueueIn(BaseModel):
    language: Code
    deck: str = Field(min_length=1, max_length=500)
    entries: list[QueuedEntry] = Field(min_length=1, max_length=MAX_QUEUED)


class MnemonicIn(BaseModel):
    language: Code
    entry: str = Field(min_length=1, max_length=200)
    meaning: str = Field(min_length=1, max_length=300)
    transliteration: str = Field(default="", max_length=200)
    context: str = Field(default="", max_length=500)


class GlossSentence(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    # The sentence's translation, which tells Claude which sense a word has.
    english: str = Field(default="", max_length=1000)


class GlossesIn(BaseModel):
    language: Code
    sentences: list[GlossSentence] = Field(max_length=MAX_GLOSS_SENTENCES)


class AttemptIn(BaseModel):
    kind: production.Kind
    language: Code
    attempt: str = Field(min_length=1, max_length=production.MAX_ATTEMPT)
    word: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=300)
    english: str = Field(default="", max_length=500)
    reference: str = Field(default="", max_length=500)


class RetellIn(BaseModel):
    attempt: str = Field(min_length=1, max_length=production.MAX_ATTEMPT)


class SituationRoles(BaseModel):
    you: str = Field(min_length=1, max_length=80)
    them: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    gender: Literal["male", "female"]


class SituationLine(BaseModel):
    speaker: situations.Speaker
    text: str = Field(min_length=1, max_length=situations.MAX_LINE)


class SituationIn(BaseModel):
    language: Code
    scene: str = Field(min_length=1, max_length=200)
    roles: SituationRoles | None = None
    lines: list[SituationLine] = Field(default_factory=list, max_length=situations.MAX_LINES)

    def conversation(self) -> situations.Conversation:
        roles = situations.Roles(**self.roles.model_dump()) if self.roles else None
        lines = tuple(situations.Line(ln.speaker, " ".join(ln.text.split())) for ln in self.lines)
        return situations.Conversation(self.language, self.scene.strip(), roles, lines)


class TakeIn(BaseModel):
    language: Code
    reference: str = Field(min_length=1, max_length=600)
    # Base64 of the WAV: at most `pronunciation.MAX_WAV_BYTES`, so a third more as text.
    audio: str = Field(min_length=1, max_length=pronunciation.MAX_WAV_BYTES * 4 // 3 + 8)


class SentencesIn(BaseModel):
    language: Code
    count: int = Field(default=10, ge=1, le=20)


class DrillsIn(BaseModel):
    points: list[str]
    count: int = Field(default=10, ge=1, le=drills.MAX_DRILL)


class ExplainIn(BaseModel):
    # A second, plainer explanation of a line already explained.
    simple: bool = False


class PhraseIn(BaseModel):
    # As it appears in the line: the words the owner selected and what's between them.
    phrase: str = Field(min_length=1, max_length=300)
    simple: bool = False


class WriteIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    form: Form = "dialogue"


class StoryIn(BaseModel):
    # What the story is about; empty lets the model choose.
    about: str = Field(default="", max_length=200)


class NextIn(BaseModel):
    # The cards just studied, to write a text that practices them (the app's "Read a text with
    # these words"). Each is a note's Entry, as the deck has it.
    words: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=500)


class FrankiCountsIn(BaseModel):
    # The deck list's totals across the top-level decks: due (reviews and learning) and new.
    due: int = Field(ge=0, le=1_000_000)
    new: int = Field(ge=0, le=1_000_000)


class ChoiceIn(BaseModel):
    choice: int = Field(ge=0)


class ReadingIn(BaseModel):
    rating: Literal["too_easy", "about_right", "too_hard"] | None = None
    finished: bool = False
    words_glossed: list[str] = []
    words_flagged: list[str] = []
    audio_speed: float | None = Field(default=None, ge=0.5, le=1.5)
    listen_only: bool = False
    seconds: int = Field(default=0, ge=0)
    # The check after reading, when it was taken: answers right, of those asked.
    check_right: int | None = Field(default=None, ge=0)
    check_asked: int | None = Field(default=None, ge=1, le=20)


def _check_voice(name: str, code: Code) -> None:
    """Refuses a voice that isn't Azure's shape or doesn't speak the language it's chosen for."""
    try:
        locale = locale_of(name)
    except SpeechError as e:
        raise HTTPException(400, str(e)) from e
    if is_multilingual(name):  # it reads any language, so it's offered for every one
        return
    if locale.split("-")[0].lower() != code:
        raise HTTPException(
            400,
            f"{name} speaks {locale}, not {LANGUAGES[code].name}. Choose a {LANGUAGES[code].name} voice.",
        )


async def _check_voice_gender(speech: Speech | None, name: str, slot: VoiceSlot) -> None:
    """Refuses a voice of the other gender than its slot's, where Azure's list says what it is."""
    if speech is None:
        return
    want = "male" if slot.startswith("male") else "female"
    try:
        found = await speech.voices()
    except SpeechError:
        return  # can't tell, and the voice's language was already checked
    for v in found:
        if v.get("voice") == name:
            have = str(v.get("gender") or "").lower()
            if have in ("male", "female") and have != want:
                raise HTTPException(
                    400,
                    f"{v.get('name') or name} is a {have} voice. Choose a {want} voice for this one.",
                )
            return


def _spent(s: store.Spending) -> dict[str, Any]:
    """/api/costs's figures for one language or the total. Per read text divides everything spent
    (dropped and unread texts too) by the texts actually read: what each one really cost."""
    total = s.cost_usd + azure_usd(s.audio_chars)
    return {
        "texts": s.texts,
        "read": s.read,
        "waiting": s.waiting,
        "dropped": s.dropped,
        "skipped": s.skipped,
        "attempts_per_text": round(s.attempts / s.texts, 2) if s.texts else None,
        "cost_usd": round(s.cost_usd, 4),
        "per_text_usd": round(s.cost_usd / s.texts, 4) if s.texts else None,
        "per_read_text_usd": round(s.cost_usd / s.read, 4) if s.read else None,
        # Azure's audio, estimated from the characters it spoke (tts.AZURE_USD_PER_MILLION_CHARS),
        # and Claude and Azure together. The three above stay Claude's alone.
        "audio_chars": s.audio_chars,
        "azure_usd": round(azure_usd(s.audio_chars), 4),
        "total_usd": round(total, 4),
        "total_per_text_usd": round(total / s.texts, 4) if s.texts else None,
        "total_per_read_text_usd": round(total / s.read, 4) if s.read else None,
    }


def create_app(
    engine: Engine,
    passphrase: str | None,
    speech: Speech | None = None,
    mnemonics: MakeMnemonics | None = None,
    explain: Explain | None = None,
    explain_phrase: ExplainPhrase | None = None,
    status_token: str | None = None,
    read_due: ReadDue | None = None,
    write_drills: drills.WriteDrills | None = None,
    write_vocab: vocab_check.WriteVocab | None = None,
    write_notes: note_queue.WriteNotes | None = None,
    check_natural: CheckNatural | None = None,
    check_attempt: production.CheckAttempt | None = None,
    check_retell: production.CheckRetell | None = None,
    write_sentences: sentences.WriteSentences | None = None,
    play: situations.Play | None = None,
    give_feedback: situations.GiveFeedback | None = None,
    clips: ClipCache | None = None,
    assess: pronunciation.Assess | None = None,
) -> FastAPI:
    app = FastAPI(title="franki-reader")
    # Points whose drill questions are being written, shared by every request (drills.top_up).
    drills_writing: set[str] = set()
    # Languages whose vocabulary check words are being written, and when one last failed, so a
    # language Claude can't gloss isn't asked again on every poll of the quiz.
    vocab_writing: set[Code] = set()
    vocab_failed: dict[Code, datetime] = {}
    # Whether the note queue is being filled in, so a poll or a second Quick add doesn't start a
    # second pass (the running one picks up whatever was added meanwhile).
    queue_filling: list[bool] = [False]
    # Languages whose sentences are being written (sentences.top_up).
    sentences_writing: set[Code] = set()

    def keep_failed_cost(feature: store.CallFeature, language: Code, used: Usage) -> None:
        """What a call that failed after Claude answered cost: no answer is kept to carry it, so
        it goes in `call_costs`. A call Claude never answered cost nothing."""
        if used != Usage():
            store.save_call_cost(engine.conn, feature, language, engine.clock(), used.cost_usd())

    def given_key(authorization: str | None) -> bytes:
        # Header values arrive decoded as latin-1, so turn them back into the bytes that were sent
        # before comparing with the passphrase's UTF-8 bytes; otherwise "pässword" never matches.
        return (authorization or "").removeprefix("Bearer ").strip().encode("latin-1")

    def require_passphrase(authorization: Annotated[str | None, Header()] = None) -> None:
        if not passphrase:
            raise HTTPException(503, "The server has no passphrase set.")
        if not hmac.compare_digest(given_key(authorization), passphrase.encode()):
            raise HTTPException(401, "Wrong passphrase.")

    def require_status_key(authorization: Annotated[str | None, Header()] = None) -> None:
        keys = [k for k in (passphrase, status_token) if k]
        if not keys:
            raise HTTPException(503, "The server has no passphrase set.")
        given = given_key(authorization)
        # Both compared every time, so the answer's timing doesn't say which one was close.
        matches = [hmac.compare_digest(given, k.encode()) for k in keys]
        if not any(matches):
            raise HTTPException(401, "Wrong passphrase or status key.")

    authed = [Depends(require_passphrase)]

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/check", status_code=204, dependencies=authed)
    async def check() -> Response:
        return Response(status_code=204)

    @app.get("/api/status", dependencies=[Depends(require_status_key)])
    async def status() -> dict[str, Any]:
        if read_due is None:
            raise HTTPException(
                503,
                "The server can't read Anki: ANKI_SYNC_ENDPOINT, ANKI_USER and ANKI_PASSWORD "
                "aren't all set.",
            )
        try:
            due = await read_due()
        except AnkiUnavailable as e:
            raise HTTPException(503, f"Couldn't read Anki. {e}") from e
        language = engine.language()
        last_read = store.last_finished_reading(engine.conn, language)
        day_starts_at = due.day_ends_at - timedelta(days=1)
        reported = store.load_franki_counts(engine.conn)
        # Only today's: yesterday's new cards left say nothing about today's.
        if reported and reported.reported_at.replace(tzinfo=UTC) < day_starts_at:
            reported = None

        def naive_utc(at: datetime) -> datetime:
            return at.astimezone(UTC).replace(tzinfo=None)

        return {
            "reviews": due.reviews,
            "learning": due.learning,
            "learning_later": [{"at": instant(x.at), "count": x.count} for x in due.learning_later],
            "decks": [
                {"name": d.name, "reviews": d.reviews, "learning": d.learning} for d in due.decks
            ],
            "day_ends_at": instant(due.day_ends_at),
            "read_and_listen": {
                "language": language,
                "name": LANGUAGES[language].name,
                "waiting": store.ready_counts(engine.conn).get(language, 0),
                "last_read_at": instant(last_read) if last_read else None,
            },
            "study_days": [
                {
                    "starts_at": instant(d.starts_at),
                    "cards": d.cards,
                    "answer_seconds": d.answer_seconds,
                    "reading_seconds": store.reading_seconds(
                        engine.conn,
                        naive_utc(d.starts_at),
                        naive_utc(d.starts_at + timedelta(days=1)),
                    ),
                }
                for d in due.study_days
            ],
            "franki": (
                {
                    "due": reported.due,
                    "new": reported.new,
                    "reported_at": instant(reported.reported_at),
                }
                if reported
                else None
            ),
        }

    @app.put("/api/franki-counts", status_code=204, dependencies=authed)
    async def franki_counts(body: FrankiCountsIn) -> Response:
        store.save_franki_counts(
            engine.conn, store.FrankiCounts(body.due, body.new, engine.clock())
        )
        return Response(status_code=204)

    @app.get("/api/topics", dependencies=authed)
    async def topics(background: BackgroundTasks) -> list[dict[str, Any]]:
        background.add_task(engine.top_up)
        language = engine.language()
        return [_topic(t, engine, language) for t in store.list_topics(engine.conn, language)]

    @app.post("/api/topics", dependencies=authed)
    async def add_topic(body: NewTopic, background: BackgroundTasks) -> dict[str, Any]:
        try:
            topic = store.add_topic(engine.conn, body.name, engine.clock())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        background.add_task(engine.top_up)
        return _topic(topic, engine, engine.language())

    @app.delete("/api/topics/{topic_id}", status_code=204, dependencies=authed)
    async def remove_topic(topic_id: int) -> Response:
        if not store.remove_topic(engine.conn, topic_id):
            raise HTTPException(404, "No such topic.")
        return Response(status_code=204)

    @app.get("/api/suggestions", dependencies=authed)
    async def suggestions() -> list[dict[str, Any]]:
        language = engine.language()
        _, lexicon = engine.snapshot(language)
        taken = store.topic_names(engine.conn)
        return [{"name": s.name, "fit": s.fit} for s in suggest(lexicon, taken, language)]

    @app.post("/api/topics/{topic_id}/next", dependencies=authed)
    async def next_text(
        topic_id: int, background: BackgroundTasks, body: NextIn | None = None
    ) -> Any:
        try:
            text = await engine.next_text(topic_id, body.words if body else ())
        except NotFound as e:
            raise HTTPException(404, "No such topic.") from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        if text is None:
            return JSONResponse({"writing": True}, status_code=202)
        background.add_task(engine.top_up)
        return _rendered(text, engine)

    @app.get("/api/shelf", dependencies=authed)
    async def shelf(background: BackgroundTasks) -> dict[str, Any]:
        background.add_task(engine.top_up)
        return _shelf(engine)

    @app.post("/api/shelf/write", status_code=202, dependencies=authed)
    async def write(body: WriteIn) -> dict[str, Any]:
        try:
            topic = engine.write_about(body.name, body.form)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "topic": topic.name}

    @app.post("/api/story", status_code=202, dependencies=authed)
    async def start_story(body: StoryIn) -> dict[str, Any]:
        try:
            story = engine.start_story(body.about)
        except NotAvailable as e:
            raise HTTPException(503, str(e)) from e
        return {"writing": True, "id": story.id}

    @app.post("/api/texts/{text_id}/skip", status_code=204, dependencies=authed)
    async def skip(text_id: int, background: BackgroundTasks) -> Response:
        if not store.skip_text(engine.conn, text_id):
            raise HTTPException(404, "That text isn't on the shelf any more.")
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @app.get("/api/texts", dependencies=authed)
    async def past_texts(story: int | None = None) -> list[dict[str, Any]]:
        return [
            {
                "id": t.id,
                "topic": t.topic,
                "title": t.title,
                "rating": t.rating,
                "read_at": instant(t.read_at),
                "coverage": t.coverage,
                "form": t.form,
                "episode": t.episode,
            }
            for t in store.past_texts(engine.conn, PAST_TEXTS, engine.language(), story)
        ]

    @app.get("/api/texts/{text_id}", dependencies=authed)
    async def get_text(text_id: int) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or store.text_status(engine.conn, text_id) == "dropped":
            raise HTTPException(404, "No such text.")
        return _rendered(text, engine)

    @app.get("/api/texts/{text_id}/lines/{line}/audio", dependencies=authed)
    async def line_audio(text_id: int, line: int) -> FileResponse:
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        path = await engine.line_audio(text, line)
        if path is None:
            raise HTTPException(404, "No audio for this line.")
        return FileResponse(path, media_type="audio/mpeg")

    def line_grammar(text: StoredText, line: int) -> list[dict[str, str]]:
        # Found by the finders, not asked of Claude, and read with the choices as they stand now,
        # so every explanation, kept or new, shows them (docs/grammar.md, step 3).
        _, lexicon = engine.snapshot(text.language)
        choices = store.load_grammar(engine.conn)
        return [
            {"id": p.id, "name": p.name, "note": p.note, "state": choices.get(p.id, "unset")}
            for p in grammar.points_in(text.lines[line].text, lexicon, text.language)
        ]

    @app.post("/api/texts/{text_id}/lines/{line}/explain", dependencies=authed)
    async def explain_line(text_id: int, line: int, body: ExplainIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        if (kept := store.get_explanation(engine.conn, text_id, line, body.simple)) is not None:
            return {"points": kept, "grammar": line_grammar(text, line)}
        if explain is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain lines"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        try:
            points, used = await explain(
                ExplainRequest(
                    text.language,
                    plain[line],
                    text.lines[line].english,
                    tuple(plain[max(0, line - 3) : line] + plain[line + 1 : line + 3]),
                    body.simple,
                )
            )
        except ExplainFailed as e:
            keep_failed_cost("explain", text.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_explanation(
            engine.conn, text_id, line, body.simple, points, engine.clock(), used.cost_usd()
        )
        return {"points": points, "grammar": line_grammar(text, line)}

    @app.post("/api/texts/{text_id}/lines/{line}/phrase", dependencies=authed)
    async def explain_phrase_in_line(text_id: int, line: int, body: PhraseIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        phrase = body.phrase.strip()
        # The app joins the pieces the server split the line into, so the phrase is part of the
        # line as written; spaces are ignored in case the split and the line disagree on them.
        if not phrase or "".join(phrase.split()) not in "".join(plain[line].split()):
            raise HTTPException(400, "That phrase isn't in this line. Select it again.")
        kept = store.get_phrase_explanation(engine.conn, text_id, line, phrase, body.simple)
        if kept is not None:
            return kept
        if explain_phrase is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't explain phrases"
                " (ANTHROPIC_API_KEY in server/.env turns explanations on).",
            )
        try:
            answer, used = await explain_phrase(
                PhraseRequest(
                    text.language,
                    phrase,
                    plain[line],
                    text.lines[line].english,
                    tuple(plain[max(0, line - 3) : line] + plain[line + 1 : line + 3]),
                    body.simple,
                )
            )
        except ExplainFailed as e:
            keep_failed_cost("phrase", text.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_phrase_explanation(
            engine.conn, text_id, line, phrase, body.simple, answer, engine.clock(), used.cost_usd()
        )
        return answer

    @app.post("/api/texts/{text_id}/lines/{line}/natural", dependencies=authed)
    async def check_line(text_id: int, line: int) -> dict[str, str]:
        text = store.get_text(engine.conn, text_id)
        if text is None or not 0 <= line < len(text.lines):
            raise HTTPException(404, "No such line.")
        if (kept := store.get_naturalness(engine.conn, text_id, line)) is not None:
            return kept
        if check_natural is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't check lines"
                " (ANTHROPIC_API_KEY in server/.env turns this on).",
            )
        spaced = LANGUAGES[text.language].spaced
        plain = [parse_line(ln.text, spaced)[0] for ln in text.lines]
        speaker = text.lines[line].speaker
        role = text.roles.get(speaker, "")
        try:
            answer, used = await check_natural(
                CheckRequest(
                    text.language,
                    plain[line],
                    text.lines[line].english,
                    f"{speaker} ({role})" if role else "",
                    text.lines[line].register,
                    tuple(plain[max(0, line - 3) : line] + plain[line + 1 : line + 3]),
                )
            )
        except ExplainFailed as e:
            keep_failed_cost("natural", text.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_naturalness(engine.conn, text_id, line, answer, engine.clock(), used.cost_usd())
        return answer

    def settings_out(current: Settings) -> dict[str, Any]:
        # Every language's deck and voices, the default where none was chosen, so the app shows
        # what's used.
        decks = {code: with_deck(code, current.decks.get(code)).deck for code in LANGUAGES}
        common = {
            code: current.common_for(code) for code, info in LANGUAGES.items() if info.counts_common
        }
        voices = {code: engine.voices_for(code) for code in LANGUAGES}
        return {**current.__dict__, "decks": decks, "voices": voices, "common": common}

    @app.get("/api/settings", dependencies=authed)
    async def settings() -> dict[str, Any]:
        return settings_out(store.load_settings(engine.conn))

    @app.patch("/api/settings", dependencies=authed)
    async def update_settings(body: SettingsUpdate, background: BackgroundTasks) -> dict[str, Any]:
        current = store.load_settings(engine.conn)
        if body.common and any(not LANGUAGES[code].counts_common for code in body.common):
            raise HTTPException(422, "Thai counts only the words in its deck.")
        common = dict(current.common)
        for code, count in (body.common or {}).items():
            if count == LANGUAGES[code].common:
                common.pop(code, None)
            else:
                common[code] = count
        decks = dict(current.decks)
        changed_decks: list[Code] = []
        for code, name in (body.decks or {}).items():
            name = name.strip()
            before = with_deck(code, decks.get(code)).deck
            if name and name != LANGUAGES[code].deck:
                decks[code] = name
            else:
                decks.pop(code, None)
            if with_deck(code, decks.get(code)).deck != before:
                changed_decks.append(code)
        voices = {code: dict(v) for code, v in current.voices.items()}
        voices_before = {code: engine.voices_for(code) for code in body.voices or {}}
        for code, chosen in (body.voices or {}).items():
            mine = voices.setdefault(code, {})
            for speaker, name in chosen.items():
                name = name.strip()
                if name:
                    _check_voice(name, code)
                    await _check_voice_gender(speech, name, speaker)
                    mine[speaker] = name
                else:
                    mine.pop(speaker, None)
            if not mine:
                voices.pop(code)
        updated = Settings(
            stretch_words=body.stretch_words or current.stretch_words,
            lines=body.lines or current.lines,
            form=body.form or current.form,
            language=body.language or current.language,
            decks=decks,
            voices=voices,
            common=common,
        )
        store.save_settings(engine.conn, updated)
        for code in changed_decks:
            # The old deck's words mustn't be written with: read the new deck now.
            store.clear_snapshot(engine.conn, code)
            background.add_task(engine.refresh_lexicon, code)
        for code, then in voices_before.items():
            if engine.voices_for(code) != then:
                # The texts waiting to be read get the new voices too.
                background.add_task(engine.rerecord, code)
        return settings_out(updated)

    def need_speech() -> Speech:
        if speech is None:
            raise HTTPException(
                503,
                "Read & Listen's server has no Azure key. Set AZURE_SPEECH_KEY and"
                " AZURE_SPEECH_REGION in server/.env.",
            )
        return speech

    @app.get("/api/voices", dependencies=authed)
    async def voices(
        language: Annotated[str, Query(min_length=2, max_length=20)],
    ) -> dict[str, Any]:
        want = language.replace("_", "-").lower()
        try:
            found = await need_speech().voices()
        except SpeechError as e:
            raise HTTPException(503, str(e)) from e

        def in_language(v: dict[str, Any]) -> bool:
            loc = (v.get("locale") or "").lower()
            return loc == want or loc.startswith(want + "-")

        def order(v: dict[str, Any]) -> tuple[str, str]:
            return (v.get("locale") or "", v.get("name") or "")

        # The language's own voices first, then the Multilingual ones of other locales.
        own = sorted((v for v in found if in_language(v)), key=order)
        others = sorted(
            (v for v in found if not in_language(v) and is_multilingual(v.get("voice") or "")),
            key=order,
        )
        return {"voices": own + others}

    @app.post("/api/speech", dependencies=authed)
    async def speak(body: SpeechIn) -> Response:
        try:
            locale_of(body.voice)
            locale = speech_locale(body.language) if body.language else None
            language = text_locale(locale) if locale else None
        except SpeechError as e:
            raise HTTPException(400, str(e)) from e
        spoken = body.text.strip()
        try:
            mp3 = await need_speech().synthesize(spoken, body.voice, body.rate, language)
        except SpeechError as e:
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        # Counted as a text's lines are (Engine.line_audio): only a recording Azure made, which is
        # what it bills.
        store.save_call_cost(
            engine.conn, "recording", "", engine.clock(), audio_chars=billed_chars(spoken)
        )
        return Response(mp3, media_type="audio/mpeg")

    no_claude = (
        "Claude isn't set up on the server, so it can't check your writing"
        " (ANTHROPIC_API_KEY in server/.env turns this on)."
    )

    @app.post("/api/production/check", dependencies=authed)
    async def check_attempt_route(body: AttemptIn) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only answers."""
        if check_attempt is None:
            raise HTTPException(503, no_claude)
        if body.kind == "sentence" and not body.word.strip():
            raise HTTPException(422, "A sentence is checked for a word: send `word`.")
        if body.kind == "translate" and not body.english.strip():
            raise HTTPException(422, "A translation is checked against `english`: send it.")
        request = production.AttemptRequest(
            body.language,
            body.kind,
            body.attempt.strip(),
            body.word.strip(),
            body.meaning.strip(),
            body.english.strip(),
            body.reference.strip(),
        )
        try:
            answer, used = await check_attempt(request)
        except production.ProductionFailed as e:
            keep_failed_cost("production", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "production", body.language, engine.clock(), used.cost_usd()
        )
        return answer

    @app.post("/api/texts/{text_id}/retell", dependencies=authed)
    async def retell(text_id: int, body: RetellIn) -> dict[str, Any]:
        text = store.get_text(engine.conn, text_id)
        if text is None:
            raise HTTPException(404, "No such text.")
        if check_retell is None:
            raise HTTPException(503, no_claude)
        spaced = LANGUAGES[text.language].spaced
        lines = tuple((parse_line(ln.text, spaced)[0], ln.english) for ln in text.lines)
        try:
            answer, used = await check_retell(
                production.RetellRequest(text.language, body.attempt.strip(), lines)
            )
        except production.ProductionFailed as e:
            keep_failed_cost("production", text.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "production", text.language, engine.clock(), used.cost_usd()
        )
        return answer

    async def top_up_sentences(language: Code, words: list[Entry]) -> None:
        if write_sentences is None:
            return
        await engine.refresh_lexicon(language)
        entries, full = engine.snapshot(language)
        days = engine.snapshot_days(language)
        held = frozenset(
            e.text
            for e in entries
            if e.tier != "unreviewed"
            and waiting_for_review(e, days)
            and e.text not in {w.text for w in words}
        )
        await sentences.top_up(
            engine.conn,
            language,
            words,
            lambda code, keep: engine.writing_lexicon(code, keep),
            full,
            held,
            write_sentences,
            engine.clock,
            sentences_writing,
        )

    @app.post("/api/sentences", dependencies=authed)
    async def sentences_route(body: SentencesIn, background: BackgroundTasks) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only reads the snapshot of the deck."""
        entries, _ = engine.snapshot(body.language)
        days = engine.snapshot_days(body.language)
        words = sentences.candidates(entries, days, engine.rng)
        reviewed = frozenset(e.text for e in reviewed_words(entries, days))
        served = sentences.serve(
            engine.conn, body.language, words, body.count, engine.clock(), reviewed
        )
        background.add_task(top_up_sentences, body.language, words)
        return {"sentences": served, "writing": write_sentences is not None}

    @app.get("/api/situations/scenes", dependencies=authed)
    async def situation_scenes(language: Code) -> list[str]:
        _, lexicon = engine.snapshot(language)
        return [s.name for s in suggest(lexicon, set(), language)]

    async def speak_clip(language: Code, gender: str, line: str) -> tuple[str | None, int]:
        """One of their lines spoken in the voice for their gender: the clip's key (None when
        there's no text to speech or Azure failed) and the characters Azure billed for it."""
        if clips is None or engine.synthesize is None:
            return None, 0
        voice = engine.voices_for(language)["female" if gender == "female" else "male"]
        key = ClipCache.key(line, voice)
        if clips.path(key) is not None:
            return key, 0
        try:
            spoken = await engine.synthesize(line, voice, LANGUAGES[language].locale)
        except TtsFailed:
            return None, 0
        clips.write(key, spoken.audio, engine.clock())
        return key, billed_chars(line)

    @app.post("/api/situations/turn", dependencies=authed)
    async def situation_turn(body: SituationIn) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only reads the snapshot of the deck."""
        if play is None:
            raise HTTPException(503, no_claude.replace("check your writing", "play a situation"))
        conversation = body.conversation()
        if conversation.lines and conversation.roles is None:
            raise HTTPException(422, "A conversation under way needs its `roles`.")
        if conversation.lines and conversation.lines[-1].speaker != "you":
            raise HTTPException(422, "It's the learner's turn: the last line should be theirs.")
        language = body.language
        # Words due today and not yet reviewed count as unknown, as when a text is written.
        entries, writing = engine.writing_lexicon(language)
        try:
            line, unknown, used = await situations.next_line(play, entries, conversation, writing)
        except situations.SituationFailed as e:
            keep_failed_cost("situations", language, e.usage)
            raise HTTPException(503, str(e)) from e
        roles = line.get("roles") or (body.roles.model_dump() if body.roles else None)
        audio, chars = await speak_clip(
            language, roles["gender"] if roles else "male", line["line"]
        )
        store.save_call_cost(
            engine.conn, "situations", language, engine.clock(), used.cost_usd(), chars
        )
        snapshot, lexicon = engine.snapshot(language)
        translits = {e.text: e.translit for e in snapshot if e.translit}
        meanings = {**engine.meanings(language), **line["glosses"]}
        out: dict[str, Any] = {
            "line": line["line"],
            "english": line["english"],
            "words": render_sentence(line["line"], lexicon, meanings, translits),
            "unknown": unknown,
            "done": line["done"],
            "audio": audio,
        }
        if "roles" in line:
            out["roles"] = line["roles"]
        return out

    @app.post("/api/situations/feedback", dependencies=authed)
    async def situation_feedback(body: SituationIn) -> dict[str, Any]:
        if give_feedback is None:
            raise HTTPException(503, no_claude)
        conversation = body.conversation()
        if not any(ln.speaker == "you" for ln in conversation.lines):
            raise HTTPException(422, "There are no lines of yours to check yet.")
        try:
            answer, used = await give_feedback(conversation)
        except situations.SituationFailed as e:
            keep_failed_cost("situations", body.language, e.usage)
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "situations", body.language, engine.clock(), used.cost_usd()
        )
        _, lexicon = engine.snapshot(body.language)
        return situations.clean_feedback(answer, conversation, lexicon)

    @app.get("/api/situations/audio/{key}", dependencies=authed)
    async def situation_audio(key: str) -> FileResponse:
        path = clips.path(key) if clips is not None else None
        if path is None:
            raise HTTPException(404, "No such clip.")
        return FileResponse(path, media_type="audio/mpeg")

    @app.post("/api/pronunciation", dependencies=authed)
    async def score_take(body: TakeIn) -> dict[str, Any]:
        """Never writes to Anki or grades a card, and keeps nothing of the take."""
        if assess is None:
            raise HTTPException(
                503,
                "Azure isn't set up on the server, so it can't score a recording"
                " (AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env turn this on).",
            )
        try:
            wav = pronunciation.wav_of(body.audio)
        except pronunciation.TakeRefused as e:
            raise HTTPException(422, str(e)) from e
        info = LANGUAGES[body.language]
        try:
            assessed = await assess(wav, body.reference.strip(), info.locale)
        except SpeechError as e:
            if e.status == 400:
                raise HTTPException(
                    422,
                    f"Azure didn't score this. It may not score {info.name}: compare your take with"
                    " the recording yourself instead.",
                ) from e
            raise HTTPException(503, str(e)) from e
        seconds = pronunciation.seconds_of(wav)
        store.save_call_cost(
            engine.conn,
            "pronunciation",
            body.language,
            engine.clock(),
            pronunciation.azure_stt_usd(seconds),
        )
        return pronunciation.result(assessed)

    @app.post("/api/mnemonics", dependencies=authed)
    async def make_mnemonics(body: MnemonicIn) -> dict[str, list[str]]:
        if mnemonics is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't suggest hints. Write your own"
                " (ANTHROPIC_API_KEY in server/.env turns suggestions on).",
            )
        try:
            hints, used = await mnemonics(
                MnemonicRequest(
                    body.language,
                    body.entry.strip(),
                    body.meaning.strip(),
                    body.transliteration.strip(),
                    body.context.strip(),
                )
            )
        except MnemonicsFailed as e:
            keep_failed_cost("mnemonics", body.language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(
            engine.conn, "mnemonics", body.language, engine.clock(), used.cost_usd()
        )
        return {"hints": hints}

    @app.post("/api/glosses", dependencies=authed)
    async def glosses(body: GlossesIn, background: BackgroundTasks) -> dict[str, Any]:
        """Never writes to Anki or grades a card: it only reads the snapshot of the deck."""
        language = body.language
        entries, lexicon = engine.snapshot(language)
        sentences = [(s.text, s.english) for s in body.sentences]

        async def after() -> None:
            await engine.refresh_lexicon(language)
            await engine.fill_sentence_meanings(sentences, language)

        background.add_task(after)
        if not entries:
            return {"ready": False, "sentences": []}
        known = engine.meanings(language)
        translits = {e.text: e.translit for e in entries if e.translit}
        return {
            "ready": True,
            "sentences": [
                render_sentence(text, lexicon, known, translits) for text, _ in sentences
            ],
        }

    @app.post("/api/texts/{text_id}/choice", status_code=204, dependencies=authed)
    async def choose(text_id: int, body: ChoiceIn) -> Response:
        match store.set_choice(engine.conn, text_id, body.choice):
            case "unknown":
                raise HTTPException(404, "That choice isn't on this text.")
            case "read":
                raise HTTPException(
                    409, "This episode is already read, so its choice can't change."
                )
        return Response(status_code=204)

    @app.post("/api/texts/{text_id}/reading", status_code=204, dependencies=authed)
    async def reading(text_id: int, body: ReadingIn, background: BackgroundTasks) -> Response:
        right, asked = body.check_right, body.check_asked
        checked = right is not None and asked is not None
        if right is not None and asked is not None and right > asked:
            raise HTTPException(422, "check_right can't be more than check_asked.")
        try:
            engine.record_reading(
                text_id,
                Reading(
                    rating=body.rating,
                    finished=body.finished,
                    words_glossed=tuple(body.words_glossed),
                    words_flagged=tuple(body.words_flagged),
                    audio_speed=body.audio_speed,
                    listen_only=body.listen_only,
                    seconds=body.seconds,
                    check_right=right if checked else None,
                    check_asked=asked if checked else None,
                ),
            )
        except NotFound as e:
            raise HTTPException(404, "No such text.") from e
        background.add_task(engine.top_up)
        return Response(status_code=204)

    @app.get("/api/progress", dependencies=authed)
    async def progress() -> dict[str, Any]:
        language = engine.language()
        since = engine.clock() - timedelta(days=PROGRESS_DAYS)
        done = store.progress(engine.conn, since, language)
        difficulty = store.load_difficulty(engine.conn, language)
        return {
            "days": PROGRESS_DAYS,
            "finished": done.finished,
            "median_coverage": done.median_coverage,
            "ratings": done.ratings,
            # The check after reading, over the finished texts it was taken with.
            "check": {"texts": done.checked, "right": done.check_right, "asked": done.check_asked},
            "next": {"floor": difficulty.floor, "stretch": difficulty.stretch},
        }

    @app.get("/api/costs", dependencies=authed)
    async def costs(days: Annotated[int, Query(ge=1, le=3650)] = 30) -> dict[str, Any]:
        since = engine.clock() - timedelta(days=days)
        by_language = store.spending(engine.conn, since)
        explained = store.explanation_spending(engine.conn, since)
        drilled = store.drill_spending(engine.conn, since)
        vocab = store.vocab_spending(engine.conn, since)
        queued = store.queue_spending(engine.conn, since)
        glossed = store.meaning_spending(engine.conn, since)
        hinted = store.mnemonic_spending(engine.conn, since)
        questioned = store.question_spending(engine.conn, since)
        formed = store.form_spending(engine.conn, since)
        produced = store.production_spending(engine.conn, since)
        sentenced = store.sentence_spending(engine.conn, since)
        situated, situated_chars = store.situation_spending(engine.conn, since)
        scored = store.pronunciation_spending(engine.conn, since)
        recorded, recorded_chars = store.recording_spending(engine.conn, since)
        rows = by_language.values()
        total = store.Spending(
            sum(r.read for r in rows),
            sum(r.waiting for r in rows),
            sum(r.dropped for r in rows),
            sum(r.attempts for r in rows),
            sum(r.cost_usd for r in rows),
            sum(r.skipped for r in rows),
            sum(r.audio_chars for r in rows),
        )
        return {
            "days": days,
            "since": instant(since),
            "languages": [
                {"language": code, "name": LANGUAGES[code].name, **_spent(r)}
                for code, r in by_language.items()
            ],
            "total": _spent(total),
            # Explain's calls (lines and phrases) and the naturalness check, failed calls included,
            # apart from the texts above (they aren't in per_text_usd).
            "explanations": {
                "asked": sum(n for n, _ in explained.values()),
                "cost_usd": round(sum(c for _, c in explained.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in explained.items()
                ],
            },
            # Grammar drills' questions, written a batch at a time (drills.py).
            "drills": {
                "batches": sum(n for n, _ in drilled.values()),
                "cost_usd": round(sum(c for _, c in drilled.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in drilled.items()
                ],
            },
            # Meanings for words in texts that nothing else glosses, a batch at a time (meanings.py).
            "meanings": {
                "batches": sum(n for n, _ in glossed.values()),
                "cost_usd": round(sum(c for _, c in glossed.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in glossed.items()
                ],
            },
            # The vocabulary check's words, glossed once a language (vocab_check.py).
            "vocab_checks": {
                "batches": sum(n for n, _ in vocab.values()),
                "cost_usd": round(sum(c for _, c in vocab.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in vocab.items()
                ],
            },
            # Words the owner queued in the app, filled in by Claude (note_queue.py).
            "note_queue": {
                "notes": sum(n for n, _ in queued.values()),
                "cost_usd": round(sum(c for _, c in queued.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "notes": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in queued.items()
                ],
            },
            # Memory hints for a word the owner keeps forgetting (mnemonics.py), failed calls included.
            "mnemonics": {
                "asked": sum(n for n, _ in hinted.values()),
                "cost_usd": round(sum(c for _, c in hinted.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in hinted.items()
                ],
            },
            # Questions for the check after reading, one call per text (comprehension.py), failed
            # calls included.
            "questions": {
                "asked": sum(n for n, _ in questioned.values()),
                "cost_usd": round(sum(c for _, c in questioned.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in questioned.items()
                ],
            },
            # The grammatical form picked for a text's inflected words, one call per text (forms.py),
            # failed calls included.
            "forms": {
                "asked": sum(n for n, _ in formed.values()),
                "cost_usd": round(sum(c for _, c in formed.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in formed.items()
                ],
            },
            # The owner's own writing checked (production.py): Use today's words, Check mine and
            # Retell it, one call each, failed calls included.
            "production": {
                "asked": sum(n for n, _ in produced.values()),
                "cost_usd": round(sum(c for _, c in produced.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in produced.items()
                ],
            },
            # Sentences to say, written a batch at a time (sentences.py).
            "sentences": {
                "batches": sum(n for n, _ in sentenced.values()),
                "cost_usd": round(sum(c for _, c in sentenced.values()), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "batches": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in sentenced.items()
                ],
            },
            # Situations (situations.py): a call a turn, and one for the feedback at the end, failed
            # calls included, plus Azure's estimate for the other person's lines.
            "situations": {
                "asked": sum(n for n, _ in situated.values()),
                "cost_usd": round(sum(c for _, c in situated.values()), 4),
                "audio_chars": situated_chars,
                "azure_usd": round(azure_usd(situated_chars), 4),
                "languages": [
                    {
                        "language": code,
                        "name": LANGUAGES[code].name,
                        "asked": n,
                        "cost_usd": round(c, 4),
                    }
                    for code, (n, c) in situated.items()
                ],
            },
            # Takes scored by Azure's pronunciation assessment (pronunciation.py): Azure's alone, an
            # estimate from the seconds sent.
            "pronunciation": {
                "scored": sum(n for n, _ in scored.values()),
                "azure_usd": round(sum(c for _, c in scored.values()), 4),
            },
            # Cards recorded by an Azure voice in the app (POST /api/speech): Azure's alone, an
            # estimate like the texts' audio. Not per language: the app doesn't say which.
            "recordings": {
                "recordings": recorded,
                "audio_chars": recorded_chars,
                "azure_usd": round(azure_usd(recorded_chars), 4),
            },
        }

    @app.get("/api/words", dependencies=authed)
    async def words() -> list[dict[str, Any]]:
        language = engine.language()
        lexicon = engine.snapshot(language)[1]
        known = engine.meanings(language)
        return [
            {
                "word": w.word,
                "gloss": (gloss := gloss_for(w.word, w.glosses, lexicon, known)),
                # A compound known from its parts, with no meaning of its own: the parts' meanings.
                "parts": None if gloss else parts_for(w.word, lexicon, known),
                "lemma": lemma_for(w.word, lexicon),
                "status": lexicon.status(w.word),
                "deck": lexicon.entry_of(w.word) is not None,
                "wanikani": from_wanikani(w.word, lexicon),
                "times": w.times,
                "last_marked": instant(w.last_marked),
            }
            for w in store.marked_words(engine.conn, language)
        ]

    def grammar_points() -> dict[str, Any]:
        language = engine.language()
        choices = store.load_grammar(engine.conn)
        seen = engine.grammar_exposure(language)
        return {
            "max_practice": grammar.MAX_PRACTICE,
            # The known points the next texts are asked to work in, least seen first.
            "least": list(engine.review_points(language)),
            "stretch": {
                "uses": store.load_difficulty(engine.conn, language).unset_uses,
                # What to suggest practicing when the dial goes up, null when every point is
                # practiced or known.
                "next": (
                    {"id": nxt.id, "name": nxt.name}
                    if (nxt := grammar.next_to_learn(language, choices))
                    else None
                ),
            },
            "points": [
                {
                    "id": p.id,
                    "name": p.name,
                    "note": p.note,
                    "state": choices.get(p.id, "unset"),
                    "seen": _seen(seen[p.id]),
                    # The JLPT level, 5 for N5 up to 1 for N1; left out for a language with none.
                    **({"jlpt": p.jlpt} if p.jlpt else {}),
                }
                for p in grammar.points_for(language)
            ],
        }

    @app.get("/api/grammar", dependencies=authed)
    async def get_grammar() -> dict[str, Any]:
        return grammar_points()

    @app.get("/api/grammar/choices", dependencies=authed)
    async def get_grammar_choices() -> dict[str, Any]:
        # Every language's, not just the one being read: Forms practice asks for the deck's.
        choices = store.load_grammar(engine.conn)
        return {"choices": {pid: state for pid, state in choices.items() if pid in grammar.POINTS}}

    async def top_up_drills(point_ids: tuple[str, ...]) -> None:
        if write_drills is not None:
            await drills.top_up(
                engine.conn, engine.snapshot, write_drills, point_ids, engine.clock, drills_writing
            )

    @app.post("/api/drills", dependencies=authed)
    async def drill(body: DrillsIn, background: BackgroundTasks) -> dict[str, Any]:
        points = tuple(dict.fromkeys(body.points))
        questions = drills.serve(
            engine.conn, engine.snapshot, points, body.count, engine.clock(), engine.rng
        )
        background.add_task(top_up_drills, points)
        asked = {q["point"] for q in questions}
        return {
            "questions": questions,
            # Points that got no question: not in this server's catalog, or nothing read and no
            # questions written yet (being written now when Claude is set up).
            "missing": [p for p in points if p not in asked],
            "writing": write_drills is not None,
        }

    async def write_vocab_bank(language: Code) -> None:
        assert write_vocab is not None
        vocab_writing.add(language)
        try:
            if await vocab_check.write_bank(engine.conn, write_vocab, language, engine.clock):
                vocab_failed.pop(language, None)
            else:
                vocab_failed[language] = engine.clock()
        finally:
            vocab_writing.discard(language)

    @app.get("/api/forms", dependencies=authed)
    async def get_forms(language: Code) -> dict[str, Any]:
        """The primers for a language's word forms (the chip on a word's popup opens one). Static:
        nothing here asks Claude."""
        return {"forms": list(form_primers.primers(language))}

    @app.get("/api/vocab-check", dependencies=authed)
    async def get_vocab_check(language: Code, background: BackgroundTasks) -> dict[str, Any]:
        """The vocabulary check's questions for a language (vocab_check.py). `state` is "ready" with
        the `items`, "preparing" while Claude writes them (ask again in a few seconds), "failed"
        when it couldn't (not asked again for `VOCAB_RETRY`), or "unavailable" with no Claude key."""
        if not LANGUAGES[language].counts_common:
            raise HTTPException(422, f"{LANGUAGES[language].name} counts only its deck.")
        stored = store.vocab_items(engine.conn, language)
        retry_due = (failed := vocab_failed.get(language)) is None or (
            engine.clock() - failed >= VOCAB_RETRY
        )
        if stored:
            items = vocab_check.serve(engine.conn, engine.snapshot(language)[1], language)
            # A bank written when fewer words were asked for, or before a band was added, is topped
            # up in the background; the quiz uses what's there meanwhile.
            failed = vocab_failed.get(language)
            if (
                write_vocab is not None
                and language not in vocab_writing
                and (failed is None or engine.clock() - failed >= VOCAB_RETRY)
                and store.vocab_asked(engine.conn, language) < len(vocab_check.sample(language))
            ):
                vocab_writing.add(language)
                background.add_task(write_vocab_bank, language)
            return {"state": "ready", "items": items}
        if write_vocab is None:
            return {"state": "unavailable", "items": []}
        if language in vocab_writing:
            return {"state": "preparing", "items": []}
        if not retry_due:
            return {"state": "failed", "items": []}
        vocab_writing.add(language)  # before the response, so the next poll sees it
        background.add_task(write_vocab_bank, language)
        return {"state": "preparing", "items": []}

    async def fill_note_queue() -> None:
        assert write_notes is not None
        queue_filling[0] = True
        try:
            await note_queue.fill_pending(engine.conn, write_notes, engine.clock)
        finally:
            queue_filling[0] = False

    def start_filling(background: BackgroundTasks) -> None:
        """Starts a pass over the words that are due, unless one is running or there's nothing to do."""
        if (
            write_notes is not None
            and not queue_filling[0]
            and note_queue.pending(engine.conn, engine.clock())
        ):
            queue_filling[0] = True  # before the response, so the next poll sees it
            background.add_task(fill_note_queue)

    def queue_view() -> dict[str, Any]:
        return {
            "available": write_notes is not None,
            "items": [
                {
                    "id": n.id,
                    "language": n.language,
                    "deck": n.deck,
                    "entry": n.entry,
                    "meaning": n.meaning,
                    "state": n.state,
                    "fields": n.fields,
                    "error": n.error,
                }
                for n in store.queued_notes(engine.conn)
            ],
        }

    @app.get("/api/note-queue", dependencies=authed)
    async def get_note_queue(background: BackgroundTasks) -> dict[str, Any]:
        """The queued words (note_queue.py). Also the way a pass starts again after the server
        restarted, or a failed word's wait is over."""
        start_filling(background)
        return queue_view()

    @app.post("/api/note-queue", dependencies=authed, status_code=202)
    async def add_to_note_queue(body: NoteQueueIn, background: BackgroundTasks) -> dict[str, Any]:
        if write_notes is None:
            raise HTTPException(
                503, "Claude isn't set up on the server, so notes can't be filled in for you."
            )
        seen: set[str] = set()
        entries: list[tuple[str, str]] = []
        for e in body.entries:
            entry = " ".join(e.entry.split())
            if entry and entry not in seen:
                seen.add(entry)
                entries.append((entry, " ".join(e.meaning.split())))
        if not entries:
            raise HTTPException(422, "Type at least one word.")
        store.add_queued(engine.conn, body.language, body.deck, entries, engine.clock())
        start_filling(background)
        return queue_view()

    @app.post("/api/note-queue/{note_id}/retry", dependencies=authed, status_code=202)
    async def retry_queued_note(note_id: int, background: BackgroundTasks) -> dict[str, Any]:
        if not store.retry_queued(engine.conn, note_id):
            raise HTTPException(404, "That word isn't waiting to be tried again.")
        start_filling(background)
        return queue_view()

    @app.delete("/api/note-queue/{note_id}", dependencies=authed, status_code=204)
    async def remove_queued_note(note_id: int) -> Response:
        # Asking again for one already gone (a save that was sent twice) is fine.
        store.delete_queued(engine.conn, note_id)
        return Response(status_code=204)

    @app.get("/api/grammar/{point_id}", dependencies=authed)
    async def get_grammar_point(point_id: str) -> dict[str, Any]:
        # After /api/grammar/choices, so "choices" isn't taken for a point's id.
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        _, lexicon = engine.snapshot(point.language)
        return {
            "id": point.id,
            "state": choices.get(point.id, "unset"),
            "max_practice": grammar.MAX_PRACTICE,
            "seen": _seen(engine.grammar_exposure(point.language)[point.id]),
            "choices": {
                p.id: choices.get(p.id, "unset") for p in grammar.points_for(point.language)
            },
            "examples": [
                {
                    "text_id": e.text_id,
                    "title": e.title,
                    "line": e.line,
                    "english": e.english,
                    "words": list(e.words),
                }
                for e in exposure.examples(engine.conn, lexicon, point.id)
            ],
        }

    # Before /api/grammar/{point_id}, which would take "stretch" for a point.
    @app.put("/api/grammar/stretch", dependencies=authed)
    async def set_grammar_stretch(body: GrammarStretchIn) -> dict[str, Any]:
        language = engine.language()
        current = store.load_difficulty(engine.conn, language)
        store.save_difficulty(engine.conn, replace(current, unset_uses=body.uses), language)
        return grammar_points()

    # Before /api/grammar/{point_id}, which would take "level" for a point.
    @app.put("/api/grammar/level", dependencies=authed)
    async def set_grammar_level(body: GrammarLevelIn) -> dict[str, Any]:
        language = engine.language()
        changes = grammar.level_choices(language, body.through, store.load_grammar(engine.conn))
        if not changes:
            raise HTTPException(422, f"{LANGUAGES[language].name} has no JLPT levels.")
        store.set_grammar_many(engine.conn, changes)
        return grammar_points()

    @app.put("/api/grammar/{point_id}", dependencies=authed)
    async def choose_grammar(
        point_id: str, body: GrammarChoice, background: BackgroundTasks
    ) -> dict[str, Any]:
        point = grammar.POINTS.get(point_id)
        if point is None:
            raise HTTPException(404, "No such grammar point.")
        choices = store.load_grammar(engine.conn)
        practiced = [
            pid
            for pid, state in choices.items()
            if state == "practice"
            and pid != point_id
            and pid in grammar.POINTS
            and grammar.POINTS[pid].language == point.language
        ]
        if body.state == "practice" and len(practiced) >= grammar.MAX_PRACTICE:
            raise HTTPException(
                422,
                f"Practice at most {grammar.MAX_PRACTICE} at a time. Set one to Know it first.",
            )
        store.set_grammar(engine.conn, point_id, body.state)
        if body.state in ("practice", "normal"):
            # Drilled from now on (docs/grammar.md, step 5): its questions are written ahead.
            background.add_task(top_up_drills, (point_id,))
        return grammar_points()

    @app.post("/api/words/clear", status_code=204, dependencies=authed)
    async def clear_word(body: ClearWord) -> Response:
        store.clear_word(engine.conn, body.word, engine.clock())
        return Response(status_code=204)

    return app


def instant(at: datetime) -> str:
    """A time the app reads, with its UTC offset. The server's clock and its stored times are naive
    UTC (`engine.utc_now`, whatever `TZ` says); without the offset the app read them as the phone's
    local time, hours off, so "today" and a date could land on the wrong day. An aware time keeps
    its own offset. Every time in a response goes through this."""
    return (at if at.tzinfo else at.replace(tzinfo=UTC)).isoformat()


def _seen(e: exposure.Exposure) -> dict[str, Any]:
    last = instant(e.last_seen) if e.last_seen is not None else None
    return {"texts": e.texts, "uses": e.uses, "last": last}


def _rendered(text: StoredText, engine: Engine) -> dict[str, Any]:
    entries, lexicon = engine.snapshot(text.language)
    out = render(
        text,
        lexicon,
        engine.meanings(text.language),
        {e.text: e.translit for e in entries if e.translit},
        # Not set as the owner's choices stand now, so a point marked since isn't still explained
        # as unmarked.
        unset=exposure.unset_points(store.load_grammar(engine.conn), text.language),
    )
    speaks = engine.audio is not None and engine.synthesize is not None
    for i, line in enumerate(out["lines"]):
        line["audio"] = speaks or engine.has_audio(text.id, i)
        timing.add_times(line["words"], engine.audio.marks(text.id, i) if engine.audio else None)
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    story = store.get_story(engine.conn, text.story_id) if text.story_id else None
    # What the reader shows under the title.
    out["topic"] = (story.title or "Your story") if story else (topic.name if topic else "")
    out["reason"] = text.reason
    out["episode"] = text.episode
    return out


def _practice_words(text: StoredText, engine: Engine) -> list[dict[str, Any]]:
    """The text's practice words as the reader draws them (meaning, dictionary form, status), in
    the order of `text.stretch`, so a card can open a word's popover without fetching the whole text.
    A practice word that doesn't turn up as a word of the text is left out."""
    entries, lexicon = engine.snapshot(text.language)
    out = render(
        text,
        lexicon,
        engine.meanings(text.language),
        {e.text: e.translit for e in entries if e.translit},
    )
    first: dict[str, dict[str, Any]] = {}
    for line in out["lines"]:
        for word in line["words"]:
            if word["status"] is not None:
                first.setdefault(word["text"], word)
    return [first[w] for w in text.stretch if w in first]


def _shelf_text(text: StoredText, engine: Engine, practice: bool = False) -> dict[str, Any]:
    """A text on the shelf as a card shows it, without its words (they come with /api/texts/{id}).
    `practice` adds its practice words' meanings, for the card that lists them."""
    topic = store.get_topic(engine.conn, text.topic_id, text.language, include_removed=True)
    return {
        **({"practice": _practice_words(text, engine)} if practice else {}),
        "id": text.id,
        "title": text.title,
        "topic": topic.name if topic else "",
        "topic_id": text.topic_id,
        "form": text.form,
        "lines": len(text.lines),
        "stretch": list(text.stretch),
        "reason": text.reason,
        "coverage": text.coverage,
        "episode": text.episode,
    }


def _recap_line(text: StoredText, engine: Engine) -> dict[str, Any] | None:
    """An episode's recap in its own language, split and glossed as a choice is, or None when it
    has none (written before the recap was asked for in the story's language)."""
    if not text.recap_line:
        return None
    entries, lexicon = engine.snapshot(text.language)
    deck_translits = {e.text: e.translit for e in entries if e.translit}
    words = render_line(
        text.recap_line, text, lexicon, engine.meanings(text.language), deck_translits
    )
    return {"english": text.recap_english, "words": words}


def _shelf(engine: Engine) -> dict[str, Any]:
    language = engine.language()
    writing = engine.writing(language)
    story = store.active_story(engine.conn, language)
    story_out = None
    if story is not None:
        told = store.episodes(engine.conn, story.id)
        read = [t for t in told if store.text_status(engine.conn, t.id) == "read"]
        waiting = store.waiting_episode(engine.conn, story.id)
        story_out = {
            "id": story.id,
            "title": story.title,
            "about": story.about,
            "read": len(read),
            "last_recap": read[-1].recap if read else "",
            # The same in the story's language, as the reader's words, with that line's English;
            # null for an episode written before it was asked for.
            "last_recap_line": _recap_line(read[-1], engine) if read else None,
            "next": _shelf_text(waiting, engine, practice=True) if waiting else None,
            "writing": any(j.story_id == story.id for j in writing),
            "failed": engine.failure(story.topic_id, language),
        }
    counts = store.ready_counts(engine.conn)
    return {
        "language": language,
        "languages": [
            {"code": code, "name": info.name, "ready": counts.get(code, 0)}
            for code, info in LANGUAGES.items()
            if code not in HIDDEN_LANGUAGES
        ],
        "texts": [_shelf_text(t, engine) for t in store.shelf_texts(engine.conn, language)],
        "writing": [
            {
                "topic": store.topic_name(engine.conn, j.topic_id),
                "reason": j.reason,
                "form": j.form or "dialogue",
            }
            for j in writing
            if j.story_id is None
        ],
        "story": story_out,
    }


def _topic(t: Topic, engine: Engine, language: Code) -> dict[str, Any]:
    # A topic's ready count is per language, so it's read again for the one being shown.
    t = store.get_topic(engine.conn, t.id, language) or t
    return {
        "id": t.id,
        "name": t.name,
        "ready": t.ready,
        "state": engine.topic_state(t, language),
    }


def production_app() -> FastAPI:
    """Built on startup by `uvicorn --factory franki_reader.app:production_app`, so importing this module
    (as the tests do) opens no database and reads no secrets."""
    settings = config.load()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = store.connect(settings.db_path)
    ask_for: Callable[[list[Entry], Code], Ask] | None = None
    mnemonics: MakeMnemonics | None = None
    explain: Explain | None = None
    explain_phrase: ExplainPhrase | None = None
    check_natural: CheckNatural | None = None
    check_attempt: production.CheckAttempt | None = None
    check_retell: production.CheckRetell | None = None
    write_sentences: sentences.WriteSentences | None = None
    play: situations.Play | None = None
    give_feedback: situations.GiveFeedback | None = None
    write_drills: drills.WriteDrills | None = None
    write_vocab: vocab_check.WriteVocab | None = None
    write_notes: note_queue.WriteNotes | None = None
    write_meanings: meanings.WriteMeanings | None = None
    write_questions: comprehension.WriteQuestions | None = None
    write_forms: forms.WriteForms | None = None
    if key := settings.secrets.get("ANTHROPIC_API_KEY"):
        client = anthropic.AsyncAnthropic(api_key=key)
        mnemonics = claude_mnemonics(client)
        explain = claude_explain(client)
        explain_phrase = claude_explain_phrase(client)
        check_natural = claude_check(client)
        check_attempt = production.claude_attempt(client)
        check_retell = production.claude_retell(client)
        write_sentences = sentences.claude_sentences(client)
        play = situations.claude_play(client)
        give_feedback = situations.claude_feedback(client)
        write_drills = drills.claude_drills(client)
        write_vocab = vocab_check.claude_vocab(client)
        write_notes = note_queue.claude_notes(client)
        write_meanings = meanings.claude_meanings(client)
        write_questions = comprehension.claude_questions(client)
        write_forms = forms.claude_forms(client)

        def ask_for(entries: list[Entry], language: Code) -> Ask:
            return claude_ask(client, entries, language)

    synthesize = None
    speech: SpeechClient | None = None
    key, region = (
        settings.secrets.get("AZURE_SPEECH_KEY"),
        settings.secrets.get("AZURE_SPEECH_REGION"),
    )
    if key and region:
        speech = SpeechClient(
            key,
            region,
            settings.speech_endpoint,
            user_agent="franki-reader",
            voice_help=(
                "Check the voice names chosen in Read & Listen's settings in the app (Thai's"
                " defaults are AZURE_VOICE_MALE and AZURE_VOICE_FEMALE in server/.env)."
            ),
        )
        synthesize = azure_synthesize(speech)

    # Without the sync server's address and sign-in the lexicon is never refreshed, and the server
    # says it has no word list.
    secrets = settings.secrets
    endpoint, user, password = (
        secrets.get("ANKI_SYNC_ENDPOINT"),
        secrets.get("ANKI_USER"),
        secrets.get("ANKI_PASSWORD"),
    )
    anki = (
        AnkiDeck(settings.anki_dir, SyncSettings(endpoint, user, password))
        if endpoint and user and password
        else None
    )
    read_deck = with_timeout(anki.read) if anki else None
    wanikani_token = secrets.get("WANIKANI_TOKEN")
    engine = Engine(
        conn,
        ask_for,
        read_deck=read_deck,
        synthesize=synthesize,
        audio=AudioCache(settings.audio_dir),
        voices=settings.voices,
        rollover=lambda: anki.rollover if anki else DEFAULT_ROLLOVER,
        write_meanings=write_meanings,
        write_questions=write_questions,
        write_forms=write_forms,
        read_wanikani=wanikani_reader(wanikani_token) if wanikani_token else None,
    )
    engine.count_existing_audio()
    return create_app(
        engine,
        settings.secrets.get("APP_PASSPHRASE"),
        speech,
        mnemonics,
        explain,
        explain_phrase,
        status_token=settings.secrets.get("STATUS_TOKEN"),
        read_due=due_with_timeout(anki.due) if anki else None,
        write_drills=write_drills,
        write_vocab=write_vocab,
        write_notes=write_notes,
        check_natural=check_natural,
        check_attempt=check_attempt,
        check_retell=check_retell,
        write_sentences=write_sentences,
        play=play,
        give_feedback=give_feedback,
        # Beside the texts' audio: a text's folder is its id, so "situations" can't be one.
        clips=ClipCache(settings.audio_dir / "situations"),
        assess=speech.assess if speech else None,
    )
