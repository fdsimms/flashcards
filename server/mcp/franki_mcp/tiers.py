"""
Filing a language deck's notes into tier subdecks by how common each word is, each tier with its
own desired retention, so a common word is kept at a higher retention than a rare one.

A tier is a subdeck (`Thai::Tier 1`) on its own options preset: Anki's desired retention belongs to
a preset, so every device schedules a tier's cards the same way and nothing here touches an
interval or a review. A tier preset copies the deck's preset when it's made and keeps its FSRS
parameters in step with it afterwards, so optimizing the deck's own preset is the one place the
weights come from; its limits, steps and retention are the user's to change in Anki, and a later
run leaves them. How a deck was filed is kept on its tier presets (presets.py). Franki lists a tier
subdeck inside its parent, not as a deck of its own (`isTierDeck` in src/core/deckTree.ts matches
the same names).

Only notes whose cards sit directly in the deck, or already in one of its tier subdecks, are
filed: another subdeck the user made (`Polski::Odmiana`) is left alone, as is a card in a filtered
deck or a note without the word field. Words with no place in the language's common-word list go
in the last tier.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import anyio
from anki.collection import Collection  # first: the anki package's modules import each other
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .collection import CollectionManager
from .frequency import BATCH, entry_word
from .presets import TIER_PRESET_KEY, copy_params
from .reader import ReaderClient
from .tools import search_text

log = logging.getLogger(__name__)

WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)

TIER_NAME = re.compile(r"^Tier \d+$")
DEFAULT_BANDS = [1000, 3000]
DEFAULT_RETENTIONS = [0.92, 0.88, 0.80]
EVERY = 24 * 3600
FIRST_RUN_DELAY = 600
EXAMPLES = 5


@dataclass(frozen=True)
class Settings:
    language: str
    field: str = "Entry"
    bands: tuple[int, ...] = tuple(DEFAULT_BANDS)
    # One per tier, most common first; None leaves each preset's own retention as it is (the daily
    # pass, so a retention changed in Anki stays changed).
    retentions: tuple[float, ...] | None = tuple(DEFAULT_RETENTIONS)
    daily: bool = True

    def check(self) -> None:
        if not 1 <= len(self.bands) <= 5 or list(self.bands) != sorted(set(self.bands)) or self.bands[0] < 1:
            raise ToolError("bands must be 1 to 5 increasing ranks, such as [1000, 3000]: tier 1 is the words up to the first.")
        if self.retentions is None:
            return
        if len(self.retentions) != len(self.bands) + 1:
            raise ToolError(f"retentions needs one more value than bands ({len(self.bands) + 1}), one per tier, most common first.")
        if not all(0.7 <= r <= 0.99 for r in self.retentions):
            raise ToolError("Each retention must be between 0.7 and 0.99.")

    def tier_of(self, rank: int | None) -> int:
        """0 for the most common tier; a word with no place goes in the last."""
        if rank is None:
            return len(self.bands)
        return next((i for i, upto in enumerate(self.bands) if rank <= upto), len(self.bands))

    def marker(self, did: int, tier: int) -> dict[str, Any]:
        """What tier `tier`'s preset remembers about how deck `did` was filed."""
        return {"deck": did, "tier": tier, "language": self.language, "field": self.field, "bands": list(self.bands), "daily": self.daily}


def tier_deck_name(deck: str, tier: int) -> str:
    return f"{deck}::Tier {tier + 1}"


def _existing_presets(col: Collection, did: int) -> dict[int, dict[str, Any]]:
    """Deck `did`'s tier presets, by tier."""
    return {c[TIER_PRESET_KEY]["tier"]: c for c in col.decks.all_config() if c.get(TIER_PRESET_KEY, {}).get("deck") == did}


def _presets_current(col: Collection, did: int, deck: str, settings: Settings) -> bool:
    """Whether every tier already has its subdeck and a preset that matches `settings` and the deck's parameters."""
    parent = col.decks.config_dict_for_deck_id(did)
    found = _existing_presets(col, did)
    for tier in range(len(settings.bands) + 1):
        conf = found.get(tier)
        tdid = col.decks.id_for_name(tier_deck_name(deck, tier))
        if conf is None or not tdid or col.decks.config_dict_for_deck_id(tdid)["id"] != conf["id"]:
            return False
        if conf[TIER_PRESET_KEY] != settings.marker(did, tier):
            return False
        if any(key in parent and conf.get(key) != parent[key] for key in ("fsrsParams6", "fsrsParams5", "fsrsWeights")):
            return False
        if settings.retentions is not None and conf.get("desiredRetention") != settings.retentions[tier]:
            return False
    return True


def _gather(col: Collection, deck: str, settings: Settings) -> tuple[str, list[tuple[int, str, list[tuple[int, str]]]], int, bool]:
    """The deck's name as Anki spells it, its notes as (id, word, [(card id, the deck it's in)]), how many
    cards were left alone, and whether its tier subdecks and presets are already as `settings` say."""
    did = col.decks.id_for_name(deck)
    if not did:
        names = sorted(n.name for n in col.decks.all_names_and_ids())
        raise ToolError(f'There\'s no deck called "{deck}". Decks: {", ".join(names)}.')
    deck = col.decks.name(did)
    wanted = {deck}
    wanted.update(n.name for n in col.decks.all_names_and_ids() if n.name.startswith(deck + "::") and TIER_NAME.match(n.name[len(deck) + 2 :]))
    by_note: dict[int, list[tuple[int, str]]] = {}
    skipped = 0
    for cid in col.find_cards(f'"deck:{search_text(deck)}"'):
        card = col.get_card(cid)
        home = col.decks.name(card.did)
        if card.odid or home not in wanted:
            skipped += 1
            continue
        by_note.setdefault(card.nid, []).append((cid, home))
    out = []
    for nid, cards in by_note.items():
        note = col.get_note(nid)
        if settings.field not in note:
            # Another note type in the deck (a cloze, a basic card): left where it is.
            skipped += len(cards)
            continue
        out.append((nid, entry_word(note[settings.field]), cards))
    if not out:
        raise ToolError(f'None of "{deck}"\'s notes has a field "{settings.field}" in the deck itself, so there\'s nothing to file. Pass the field that holds the word.')
    return deck, out, skipped, _presets_current(col, did, deck, settings)


async def _ranks(client: ReaderClient, language: str, words: list[str]) -> dict[str, int | None]:
    ranks: dict[str, int | None] = {}
    for i in range(0, len(words), BATCH):
        ranks.update((await client.post("/api/ranks", {"language": language, "words": words[i : i + BATCH]}))["ranks"])
    return ranks


def _ensure_presets(col: Collection, deck: str, settings: Settings) -> list[int]:
    """The tier subdecks' ids, each on a preset of its own: made as a copy of the deck's, then kept in
    step with its FSRS parameters and set to its tier's retention."""
    did = col.decks.id_for_name(deck)
    parent = col.decks.config_dict_for_deck_id(did)
    found = _existing_presets(col, did)
    ids = []
    for tier in range(len(settings.bands) + 1):
        tdid = col.decks.id(tier_deck_name(deck, tier))
        conf = found.get(tier) or col.decks.add_config(f"{deck} · Tier {tier + 1}", clone_from=parent)
        copy_params(parent, conf)
        if settings.retentions is not None:
            conf["desiredRetention"] = settings.retentions[tier]
        conf[TIER_PRESET_KEY] = settings.marker(did, tier)
        col.decks.update_config(conf)
        deck_dict = col.decks.get(tdid)
        assert deck_dict is not None
        col.decks.set_config_id_for_deck_dict(deck_dict, conf["id"])
        ids.append(tdid)
    return ids


async def file_deck(cm: CollectionManager, client: ReaderClient, deck: str, settings: Settings, apply: bool) -> dict[str, Any]:
    """Works out each note's tier (a read, then Read & Listen's ranks), and with `apply` creates the subdecks and presets and moves the cards."""
    settings.check()
    deck, notes, skipped, current = await cm.read(lambda col: _gather(col, deck, settings))
    words = list(dict.fromkeys(w for _, w, _ in notes if w))
    ranks = await _ranks(client, settings.language, words)
    if not any(ranks.get(w) is not None for w in words):
        raise ToolError(f'None of "{deck}"\'s words has a place in the {settings.language} list, so there\'s nothing to file by. Check `language` and `field`.')
    tiers: list[dict[str, Any]] = [{"notes": 0, "cards_to_move": 0, "examples": []} for _ in range(len(settings.bands) + 1)]
    moves: dict[int, list[int]] = {}
    for _, word, cards in notes:
        t = settings.tier_of(ranks.get(word))
        tiers[t]["notes"] += 1
        if len(tiers[t]["examples"]) < EXAMPLES:
            tiers[t]["examples"].append({"word": word, "rank": ranks.get(word)})
        target = tier_deck_name(deck, t)
        for cid, home in cards:
            if home != target:
                moves.setdefault(t, []).append(cid)
                tiers[t]["cards_to_move"] += 1
    summary: dict[str, Any] = {
        "deck": deck,
        "tiers": [
            {"deck": tier_deck_name(deck, i), **({"desired_retention": settings.retentions[i]} if settings.retentions else {}), **tiers[i]}
            for i in range(len(tiers))
        ],
        "left_alone": skipped,
    }
    if not apply:
        return {"preview": True, **summary}
    if not moves and current:
        # Nothing to move and the presets already match: no write, so no sync, on a day with nothing to do.
        return {"preview": False, **summary, "moved": 0}

    def save(col: Collection) -> dict[str, Any]:
        dids = _ensure_presets(col, deck, settings)
        moved = 0
        for t, cids in moves.items():
            # A card that's gone into a filtered deck since is left where it is.
            free = [c for c in cids if not col.get_card(c).odid]
            if free:
                moved += col.set_deck(free, dids[t]).count
        return {"moved": moved}

    return {"preview": False, **summary, **await cm.write(save)}


def _tiered(col: Collection) -> dict[str, dict[str, Any]]:
    """The decks filed with `daily` on, by name, each with how it was filed (from its Tier 1 preset)."""
    out: dict[str, dict[str, Any]] = {}
    for conf in col.decks.all_config():
        saved = conf.get(TIER_PRESET_KEY)
        if not saved or saved.get("tier") != 0 or not saved.get("daily"):
            continue
        deck = col.decks.get(saved["deck"], default=False)
        if deck:
            out[deck["name"]] = saved
    return out


async def daily_loop(cm: CollectionManager, client: ReaderClient, first_delay: float = FIRST_RUN_DELAY, every: float = EVERY) -> None:
    """Once a day, files again every deck that was filed with `daily` on, so words added since land in their tier."""
    await anyio.sleep(first_delay)
    while True:
        try:
            for deck, s in (await cm.read(_tiered)).items():
                try:
                    settings = Settings(s["language"], s["field"], tuple(s["bands"]), retentions=None)
                    result = await file_deck(cm, client, deck, settings, apply=True)
                    log.info("tiers: %s, %d cards moved", deck, result["moved"])
                except ToolError as e:
                    log.warning("tiers: %s skipped: %s", deck, e)
                except Exception:  # noqa: BLE001 - one deck's failure doesn't stop the others
                    log.exception("tiers: %s failed", deck)
        except Exception:  # noqa: BLE001 - a failed run waits for the next one
            log.exception("tiers: the daily run failed")
        await anyio.sleep(every)


def register(server: MCPServer, cm: CollectionManager, client: ReaderClient) -> None:
    @server.tool(annotations=WRITE)
    async def tier_all_languages_by_frequency(
        field: str = "Entry",
        bands: list[int] | None = None,
        retentions: list[float] | None = None,
        daily: bool = True,
        preview: bool = True,
    ) -> dict[str, Any]:
        """tier_deck_by_frequency for every language Read & Listen has a deck for (its settings say
        which deck each language reads; the Omnilanguage notes' word is `field`), with the same
        `bands`, `retentions` and `daily` for all of them. Returns each language's preview or
        result under `languages`; one that can't be filed (no such deck, no cards of its own, no
        place for any word, an unexpected error) is listed with the reason under `skipped` and the
        others go ahead. Each deck gets its own tier presets copied from its own preset: say which
        decks, and apply with preview=false only once the user agrees to the preview."""
        if bands and not retentions:
            raise ToolError(f"Pass retentions too: one value per tier ({len(bands) + 1}), most common first.")
        decks: dict[str, str] = (await client.get("/api/settings"))["decks"]
        done: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        for language, deck in decks.items():
            s = Settings(language, field, tuple(bands or DEFAULT_BANDS), tuple(retentions or DEFAULT_RETENTIONS), daily)
            try:
                done.append({"language": language, **await file_deck(cm, client, deck, s, apply=not preview)})
            except ToolError as e:
                skipped.append({"language": language, "deck": deck, "reason": str(e)[:200]})
            except Exception as e:  # noqa: BLE001 - one language's failure doesn't lose the others' results
                log.exception("tiers: %s failed", deck)
                skipped.append({"language": language, "deck": deck, "reason": f"Unexpected error ({e.__class__.__name__}); see the MCP's log."})
        return {"preview": preview, "languages": done, "skipped": skipped}

    @server.tool(annotations=WRITE)
    async def tier_deck_by_frequency(
        deck: str,
        language: str,
        field: str = "Entry",
        bands: list[int] | None = None,
        retentions: list[float] | None = None,
        daily: bool = True,
        preview: bool = True,
    ) -> dict[str, Any]:
        """Files a language deck's notes into tier subdecks by how common each note's word is, each
        tier on its own options preset with its own desired retention: common words are kept at a
        higher retention (shorter intervals), rarer ones at a lower. Every device schedules by the
        preset, so nothing differs between Franki, AnkiMobile and Anki; no interval or review is
        changed by the move itself, only what the next ones are scheduled from.
        - `language` is Read & Listen's code: th, es, de, fr, ru, el, pl, nb, ja, en.
        - `bands` are the ranks that end each tier but the last (default [1000, 3000]: tier 1 is the
          1,000 most common words, tier 2 up to 3,000, tier 3 the rest and any word with no place).
          `retentions` is one value per tier, most common first (default [0.92, 0.88, 0.80]).
        - The subdecks are `<deck>::Tier 1`, `Tier 2`, ...; each gets its own copy of the deck's
          preset, whose FSRS parameters are kept in step with the deck's on every run (so optimize the
          deck's own preset). Limits, steps and the like are copied once and are then yours to change.
        - Only cards directly in the deck, or already in its tier subdecks, move. Other subdecks,
          cards in filtered decks and notes without the `field` are left alone (`left_alone`).
        - Each call sets the tiers' retentions to `retentions`. `daily` (the default) files the deck
          again once a day so new notes get their tier; that pass leaves a retention or limit you've
          since changed in Anki alone.
        - `preview` (the default) changes nothing and returns each tier's notes, examples and how many
          cards would move. Show that to the user and apply with preview=false only once they agree.
        Needs Read & Listen running (it holds the word lists). Say which deck's presets this adds."""
        if bands and not retentions:
            raise ToolError(f"Pass retentions too: one value per tier ({len(bands) + 1}), most common first.")
        s = Settings(language, field, tuple(bands or DEFAULT_BANDS), tuple(retentions or DEFAULT_RETENTIONS), daily)
        return await file_deck(cm, client, deck, s, apply=not preview)
