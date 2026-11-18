"""Help for the app's cards: memory hints, questions about a card, a verb's aspect partner,
example sentences glossed, and a Japanese verb's forms."""

from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from franki_reader import (
    ask_card,
    aspect,
    conjugation,
    fix_card,
    store,
)
from franki_reader.ipa import ipa_of_entry
from franki_reader.languages import Code
from franki_reader.mnemonics import (
    MnemonicRequest,
    MnemonicsFailed,
)
from franki_reader.reader import render_sentence
from franki_reader.routes.context import AppContext

MAX_GLOSS_SENTENCES = 1000  # example sentences one /api/glosses call can ask about
MAX_CONJUGATIONS = 100  # verbs one /api/conjugations call can ask about: fill_forms' most a call
# Entries one /api/pronunciations call can ask about: fill_pronunciation's most a call.
MAX_PRONUNCIATIONS = 100


class VerbIn(BaseModel):
    entry: str = Field(min_length=1, max_length=200)
    # The note's KanaReading, for each form's reading (Sudachi's when it's empty).
    reading: str = Field(default="", max_length=200)


class ConjugationsIn(BaseModel):
    verbs: list[VerbIn] = Field(max_length=MAX_CONJUGATIONS)


class PronunciationIn(BaseModel):
    language: Code
    entry: str = Field(min_length=1, max_length=200)
    # The note's KanaReading (Japanese only), which the IPA is written from; Sudachi's when empty.
    reading: str = Field(default="", max_length=200)


class PronunciationsIn(BaseModel):
    entries: list[PronunciationIn] = Field(max_length=MAX_PRONUNCIATIONS)


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


class CardTurnIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1500)


class AskCardIn(BaseModel):
    # The card's language when the app knows it (an Omnilanguage note); other note types send none.
    language: Code | None = None
    front: str = Field(max_length=1500)
    back: str = Field(max_length=1500)
    details: str = Field(default="", max_length=2000)
    turns: list[CardTurnIn] = Field(min_length=1, max_length=40)


class FixCardIn(BaseModel):
    language: Code | None = None
    # The note's fields as stored (HTML), by name.
    fields: dict[str, str] = Field(min_length=1, max_length=40)
    reason: str = Field(min_length=1, max_length=200)
    # What the owner typed in the flag sheet.
    note: str = Field(default="", max_length=600)


class AspectIn(BaseModel):
    # The word's own language, which is not always the one being read: a card from the Polish deck
    # can be studied while Thai is the reading language.
    language: Code
    word: str = Field(min_length=1, max_length=80)
    # The sentence it was read in, so a homograph can be told apart; optional.
    line: str = Field(default="", max_length=400)


def router(ctx: AppContext) -> APIRouter:
    routes = APIRouter()
    authed = ctx.authed
    engine = ctx.engine
    mnemonics = ctx.mnemonics
    write_aspect = ctx.write_aspect
    ask_about_card = ctx.ask_about_card
    fix_flagged_card = ctx.fix_flagged_card
    keep_failed_cost = ctx.keep_failed_cost

    @routes.post("/api/mnemonics", dependencies=authed)
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

    @routes.post("/api/ask-card", dependencies=authed)
    async def ask_card_route(body: AskCardIn) -> dict[str, str]:
        if ask_about_card is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't answer questions about a card"
                " (ANTHROPIC_API_KEY in server/.env turns it on).",
            )
        if body.turns[-1].role != "user":
            raise HTTPException(422, "The last turn has to be your question.")
        language = body.language or ""
        try:
            answer, used = await ask_about_card(
                ask_card.CardQuestion(
                    body.language,
                    body.front.strip(),
                    body.back.strip(),
                    body.details.strip(),
                    [ask_card.Turn(t.role, t.content.strip()) for t in body.turns],
                )
            )
        except ask_card.AskCardFailed as e:
            keep_failed_cost("ask_card", language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(engine.conn, "ask_card", language, engine.clock(), used.cost_usd())
        return {"answer": answer}

    @routes.post("/api/fix-card", dependencies=authed)
    async def fix_card_route(body: FixCardIn) -> dict[str, Any]:
        if fix_flagged_card is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't suggest a fix for a card"
                " (ANTHROPIC_API_KEY in server/.env turns it on).",
            )
        if any(len(v) > 8000 for v in body.fields.values()):
            raise HTTPException(422, "A field on this note is too long to send to Claude.")
        language = body.language or ""
        try:
            fix, used = await fix_flagged_card(
                fix_card.FlaggedCard(
                    body.language, body.fields, body.reason.strip(), body.note.strip()
                )
            )
        except fix_card.FixCardFailed as e:
            keep_failed_cost("fix_card", language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(engine.conn, "fix_card", language, engine.clock(), used.cost_usd())
        return {"changes": fix.changes, "explanation": fix.explanation}

    @routes.post("/api/aspect-pair", dependencies=authed)
    async def aspect_pair(body: AspectIn) -> dict[str, Any]:
        language = body.language
        if language not in aspect.ASPECT_LANGUAGES:
            raise HTTPException(422, "Aspect pairs are only suggested for Russian and Polish.")
        if write_aspect is None:
            raise HTTPException(
                503,
                "Claude isn't set up on the server, so it can't suggest an aspect pair"
                " (ANTHROPIC_API_KEY in server/.env turns suggestions on).",
            )
        try:
            pair, used = await write_aspect(
                aspect.AspectRequest(language, body.word.strip(), body.line.strip())
            )
        except aspect.AspectFailed as e:
            keep_failed_cost("aspect", language, e.usage)
            # Not 502, which the app reads as Caddy's "Read & Listen isn't running".
            raise HTTPException(503, str(e)) from e
        store.save_call_cost(engine.conn, "aspect", language, engine.clock(), used.cost_usd())
        return pair.as_json()

    @routes.post("/api/conjugations", dependencies=authed)
    def conjugations(body: ConjugationsIn) -> dict[str, list[list[str] | None]]:
        """Each Japanese verb's lines for its Forms field (conjugation.form_lines), or None for an
        Entry that isn't a verb in its dictionary form: the MCP's fill_forms asks here."""
        return {"forms": [conjugation.form_lines(v.entry, v.reading) for v in body.verbs]}

    @routes.post("/api/pronunciations", dependencies=authed)
    def pronunciations(body: PronunciationsIn) -> dict[str, list[dict[str, str] | None]]:
        """Each entry's IPA and where it's from (ipa.SOURCE_*), or None when there is none to show (a
        phrase, a word the table lacks): the MCP's fill_pronunciation asks here. Reads only: it never
        asks Claude for a word's IPA, so it costs nothing, and uses the IPA Claude already wrote for texts."""
        found: list[dict[str, str] | None] = []
        for e in body.entries:
            result = ipa_of_entry(e.entry, e.language, e.reading, engine.ai_ipa(e.language))
            found.append({"ipa": result[0], "source": result[1]} if result else None)
        return {"pronunciations": found}

    @routes.post("/api/glosses", dependencies=authed)
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
                render_sentence(text, lexicon, known, translits, engine.ai_ipa(language))
                for text, _ in sentences
            ],
        }

    return routes
