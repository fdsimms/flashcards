"""Words outside the learner's deck, spread out (docs/read-and-listen/architecture.md, Generation and
coverage). Coverage counts a whole text, so a draft can hold the right share of new words and still
pack four of them into one sentence, where nothing around them is known well enough to work a
meaning out from, and a guess is wasted. A draft with more than `CROWD_MAX` new words in any
`CROWD_WINDOW` words in a row goes back for revision with them named.

Soft, like the grammar rules: if no attempt is clean, the closest by coverage is kept
(`generator.generate`), so a text is never dropped for this alone.
"""

from franki_reader.coverage import Coverage

# More than this many words outside the deck ...
CROWD_MAX = 2
# ... or this many on the Harder level (93%), where about 7 words in 100 are new and two in ten is
# ordinary, not a cluster.
CROWD_MAX_HARDER = 3
HARDER_BELOW = 0.94
# ... in any this many counted words in a row is too crowded.
CROWD_WINDOW = 10
# The most crowded stretches named in a revision message.
NAMED = 3


def crowding(coverage: Coverage, floor: float = 0.95) -> tuple[list[str], int]:
    """The revision problems, as sentences, and how many crowded stretches there are. A new word is
    one the lexicon doesn't count as known: not in the deck, or only inside a longer entry (partial).
    Names are left out of the tokens already, and a stretch word is a deck word."""
    most = CROWD_MAX_HARDER if floor < HARDER_BELOW else CROWD_MAX
    new = [i for i, t in enumerate(coverage.tokens) if t.status in ("unknown", "partial")]
    crowded: set[int] = set()
    for a in range(len(new)):
        b = a
        while b + 1 < len(new) and new[b + 1] - new[a] < CROWD_WINDOW:
            b += 1
        if b - a + 1 > most:
            crowded.update(new[a : b + 1])
    if not crowded:
        return [], 0
    # Neighbouring crowded words make one stretch; a gap of a full window or more starts another.
    stretches: list[list[int]] = []
    for i in sorted(crowded):
        if stretches and i - stretches[-1][-1] < CROWD_WINDOW:
            stretches[-1].append(i)
        else:
            stretches.append([i])
    named = [", ".join(coverage.tokens[i].text for i in s) for s in stretches[:NAMED]]
    more = len(stretches) - len(named)
    problem = (
        "These new words are crowded together, so there is nothing around them to work out their "
        f"meaning from: {'; '.join(named)}"
        + (f"; and {more} more places" if more > 0 else "")
        + f". Spread the words that aren't in the list out, with at most {most} in any "
        f"{CROWD_WINDOW} words in a row."
    )
    return [problem], len(stretches)
