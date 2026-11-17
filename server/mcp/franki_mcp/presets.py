"""
The options presets of a deck filed into frequency tiers (tiers.py).

Each tier subdeck of a filed deck has a preset of its own, marked with `TIER_PRESET_KEY` (Anki keeps
keys it doesn't know in a preset and syncs them). The mark says which deck it belongs to by id, so
two decks that share one preset (Default) still get tier presets of their own, and a renamed deck
keeps its tiers. A tier preset copies the deck's preset when it's made and keeps its FSRS
parameters in step with it afterwards; its limits, steps and retention are the user's to change.
"""

from __future__ import annotations

from typing import Any

from anki.collection import Collection  # first: the anki package's modules import each other

TIER_PRESET_KEY = "frankiTier"
# Where a preset keeps its FSRS parameters (Anki reads the newest it finds).
PARAM_KEYS = ("fsrsParams6", "fsrsParams5", "fsrsWeights")


def copy_params(source: dict[str, Any], target: dict[str, Any]) -> None:
    for key in PARAM_KEYS:
        if key in source:
            target[key] = source[key]


def tier_presets_for(col: Collection, conf: dict[str, Any]) -> list[dict[str, Any]]:
    """The tier presets of every deck that uses the preset `conf`."""
    dids = set(col.decks.decks_using_config(conf))
    return [c for c in col.decks.all_config() if c.get(TIER_PRESET_KEY, {}).get("deck") in dids]


def share_params(col: Collection, conf: dict[str, Any]) -> int:
    """Copies a preset's FSRS parameters onto the tier presets of the decks using it; how many it did."""
    tiers = tier_presets_for(col, conf)
    for t in tiers:
        copy_params(conf, t)
        col.decks.update_config(t)
    return len(tiers)
