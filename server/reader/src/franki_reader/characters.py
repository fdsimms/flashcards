"""The drawn characters a dialogue's speakers are shown as (docs/read-and-listen/architecture.md,
Characters).

The model picks one of these for each of A and B when it writes a text, and the app draws it in
the man's or the woman's version, from `genders`. A role with a man's and a woman's name is one
character: a parent is a father or a mother. `src/reader/characters.ts` draws the same keys
(`test_characters.py` checks the two lists match), and an app that doesn't know a key shows the
speaker's A or B badge.
"""

CHARACTERS: tuple[str, ...] = (
    "parent",
    "grandparent",
    "child",
    "friend",
    "waiter",
    "shopkeeper",
    "doctor",
    "teacher",
    "traveler",
    "person",  # anyone else: a neighbor, a coworker, a stranger
)
