# Builds tests/fixtures/anki/queue-vectors.json: what Anki's v3 scheduler itself queues for each
# deck of a studied collection, under a list of option sets and at a list of times, for
# tests/core/deckTree.test.ts, which reads the same collection and compares `treeQueue`.
#   TZ=UTC LD_PRELOAD=<libfaketimeMT.so.1> <venv with anki>/bin/python tests/fixtures/anki/make-queue-vectors.py tests/fixtures/anki/queue-vectors.json
# Anki reads the clock, so this runs under libfaketime (apt install faketime). The collection is
# made and studied in UTC in January, clear of every zone's daylight saving changes, so the test
# can replay it at the same wall-clock times in whatever zone it runs in.
# The file holds the collection's rows as the app reads them (COLLECTION_QUERIES in
# src/anki/collection.ts, blobs in hex) and its review log, then each variant: the option rows it
# changed, the time, and for each deck the card ids in the order Anki queues them with Anki's
# three counts. The cards are as they were at noon on the 20th for every variant.
import json, os, random, sys, tempfile, time
from anki.collection import Collection

if "faketime" not in os.environ.get("LD_PRELOAD", "") or os.environ.get("TZ") != "UTC":
    sys.exit("Run in UTC under libfaketime: TZ=UTC LD_PRELOAD=<libfaketimeMT.so.1> python make-queue-vectors.py <out.json>")
clock = tempfile.NamedTemporaryFile(delete=False)
clock.close()
os.environ["FAKETIME_TIMESTAMP_FILE"] = clock.name
os.environ["FAKETIME_NO_CACHE"] = "1"
if not os.environ.get("QUEUE_VECTORS_CHILD"):
    # libfaketime reads its settings when the process starts.
    os.execve(sys.executable, [sys.executable, *sys.argv], {**os.environ, "QUEUE_VECTORS_CHILD": "1"})

PATH = os.path.join(tempfile.mkdtemp(), "collection.anki2")
col = None


def at(when):
    """Sets the clock, and reopens the collection: Anki keeps the day it worked out when opened."""
    global col
    with open(clock.name, "w") as f:
        f.write("@" + when.replace("T", " ") + ":00")
    if col:
        col.close()
    col = Collection(PATH)


def answer(cid, rating):
    card = col.get_card(cid)
    card.start_timer()
    # Anki's own ratings count from 0 (Again).
    col.sched.answer_card(col.sched.build_answer(card=card, states=col._backend.get_scheduling_states(cid), rating=rating - 1))


rnd = random.Random(7)
at("2026-01-05T10:00")
col.set_config("fsrs", True)
col.set_config("loadBalancerEnabled", False)
p1 = col.decks.get_config(1)
p1["new"]["perDay"], p1["rev"]["perDay"], p1["new"]["delays"], p1["lapse"]["delays"] = 6, 20, [1, 10], [10]
col.decks.update_config(p1)
p2 = col.decks.get_config(col.decks.add_config_returning_id("P2"))
p2["new"]["perDay"], p2["rev"]["perDay"], p2["new"]["delays"], p2["lapse"]["delays"] = 3, 7, [1, 1440], [10, 1440]
col.decks.update_config(p2)
PRESETS = (1, p2["id"])
decks = {}
for name, conf in [("A", 1), ("A::B", p2["id"]), ("A::C", 1), ("D", 1)]:
    did = col.decks.id(name)
    deck = col.decks.get(did)
    deck["conf"] = conf
    col.decks.save(deck)
    decks[name] = did
model = col.models.by_name("Basic (and reversed card)")
for name, count in [("A", 16), ("A::B", 18), ("A::C", 18), ("D", 10)]:
    for i in range(count):
        note = col.new_note(model)
        note["Front"], note["Back"] = f"{name} {i}", f"back {name} {i}"
        col.add_note(note, decks[name])
        time.sleep(0.002)

# Two weeks of study: most of what's due each day (less in the last days, so reviews are waiting),
# a few new cards, most steps finished.
for day in range(6, 20):
    at("2026-01-%02dT%s" % (day, rnd.choice(["07:30", "13:00", "21:15", "23:50"])))
    today = col.sched.today
    for cid in col.db.list("select id from cards where (queue = 2 and due <= ?) or (queue = 3 and due <= ?) or queue = 1", today, today):
        if rnd.random() < (0.8 if day < 16 else 0.3):
            answer(cid, rnd.choice([1, 2, 3, 3, 3, 4]))
    for did in decks.values():
        for cid in col.db.list("select id from cards where queue = 0 and did = ? order by due", did)[: rnd.choice([0, 1, 2, 3])]:
            answer(cid, rnd.choice([1, 3, 3, 4, 4]))
    for cid in col.db.list("select id from cards where queue = 1"):
        if rnd.random() < 0.7:
            answer(cid, 3)
# Today: a session before noon that uses some of the limits and leaves steps waiting around noon,
# a card buried and one suspended.
at("2026-01-20T11:50")
today = col.sched.today
for name in ["A", "A::B", "D"]:
    for cid in col.db.list("select id from cards where queue = 0 and did = ? order by due", decks[name])[:2]:
        answer(cid, rnd.choice([1, 3]))
    for cid in col.db.list("select id from cards where queue = 2 and due <= ? and did = ?", today, decks[name])[:2]:
        answer(cid, rnd.choice([1, 3]))
at("2026-01-20T11:58")
for cid in col.db.list("select id from cards where queue = 1 and due < ?", int(time.time()))[:2]:
    answer(cid, 3)
col.sched.bury_cards(col.db.list("select id from cards where queue = 2 and due <= ? and did = ? order by id limit 1", today, decks["A::C"]))
col.sched.bury_cards(col.db.list("select id from cards where queue = 0 and did = ? order by due limit 1", decks["A::C"]))
col.sched.suspend_cards(col.db.list("select id from cards where queue = 0 and did = ? order by due desc limit 1", decks["A::C"]))
NOW = "2026-01-20T12:00"
at(NOW)

CARD_COLS = "id nid did ord type queue due ivl factor reps lapses left odid odue data mod flags".split()


def card_rows():
    return [dict(zip(CARD_COLS, r)) for r in col.db.all(f"SELECT {', '.join(CARD_COLS)} FROM cards ORDER BY id")]


def option_rows():
    return {
        "deckConfigs": [{"id": i, "config": bytes(c).hex()} for i, c in col.db.all("SELECT id, config FROM deck_config")],
        "config": [{"key": k, "val": bytes(v).decode()} for k, v in col.db.all(
            "SELECT key, val FROM config WHERE key IN ('rollover', 'collapseTime', 'newCardsIgnoreReviewLimit', 'applyAllParentLimits', 'creationOffset', 'loadBalancerEnabled')")],
    }


def queues():
    # As Anki's own screens do before studying: showing the deck list is what unburies at a new day.
    col.sched.deck_due_tree()
    out = {}
    for name, did in decks.items():
        col.decks.select(did)
        q = col.sched.get_queued_cards(fetch_limit=10000)
        out[name] = {"order": [str(c.card.id) for c in q.cards], "new": q.new_count, "learning": q.learning_count, "review": q.review_count}
    return out


base_cards = card_rows()
rows = {
    "col": {"crt": col.db.scalar("select crt from col")},
    "notetypes": [{"id": i, "name": n, "config": bytes(c).hex()} for i, n, c in col.db.all("SELECT id, name, config FROM notetypes")],
    "fields": [{"ntid": a, "ord": b, "name": c} for a, b, c in col.db.all("SELECT ntid, ord, name FROM fields")],
    "templates": [{"ntid": a, "ord": b, "name": c, "config": bytes(d).hex()} for a, b, c, d in col.db.all("SELECT ntid, ord, name, config FROM templates")],
    "notes": [{"id": a, "mid": b, "tags": c, "flds": d} for a, b, c, d in col.db.all("SELECT id, mid, tags, flds FROM notes")],
    "cards": base_cards,
    "decks": [{"id": a, "name": b, "kind": bytes(c).hex()} for a, b, c in col.db.all("SELECT id, name, kind FROM decks")],
    "lastReviews": [{"cid": a, "last": b} for a, b in col.db.all("SELECT cid, MAX(id) AS last FROM revlog WHERE ease > 0 AND NOT (type = 3 AND factor = 0) GROUP BY cid")],
    "revlog": [dict(zip("id cid ease lastIvl time type".split(), r)) for r in col.db.all("SELECT id, cid, ease, lastIvl, time, type FROM revlog ORDER BY id")],
}
variants = []


def variant(name, change=None, when=NOW):
    """Records the queues with `change` made to the options, at `when`, then puts the options back."""
    presets = {i: col.decks.get_config(i) for i in PRESETS}
    keys = ("newCardsIgnoreReviewLimit", "applyAllParentLimits", "collapseTime")
    config = {k: col.get_config(k, None) for k in keys}
    if change:
        change()
    at(when)
    variants.append({"name": name, "now": when, **option_rows(), "queues": queues()})
    # The test reads the cards as they were at noon for every variant: a new day may only have
    # unburied them (which leaves `mod` alone), as Franki works out for itself.
    unburied = lambda card: {**card, "queue": card["type"]} if card["queue"] < -1 else card
    assert card_rows() in (base_cards, [unburied(c) for c in base_cards]), name
    for preset in presets.values():
        col.decks.update_config(preset)
    for k, v in config.items():
        col.remove_config(k) if v is None else col.set_config(k, v)


def presets(change):
    def run():
        for i in PRESETS:
            conf = col.decks.get_config(i)
            change(conf)
            col.decks.update_config(conf)
    return run


def bury(conf):
    conf["new"]["bury"] = conf["rev"]["bury"] = conf["buryInterdayLearning"] = True


def large(conf):
    conf["new"]["perDay"] = conf["rev"]["perDay"] = 100


def set_keys(**values):
    return presets(lambda conf: conf.update(values))


variant("as it is")
variant("new cards ignore the review limit", lambda: col.set_config("newCardsIgnoreReviewLimit", True))
variant("every parent's limits apply", lambda: col.set_config("applyAllParentLimits", True))
variant("no learn-ahead", lambda: col.set_config("collapseTime", 0))
variant("siblings buried", presets(bury))
variant("new siblings buried", presets(lambda conf: conf["new"].update(bury=True)))
variant("review siblings buried", presets(lambda conf: conf["rev"].update(bury=True)))
variant("large limits", presets(large))
variant("large limits, siblings buried", presets(lambda conf: (large(conf), bury(conf))))
for order in range(13):
    variant(f"review order {order}", set_keys(reviewOrder=order))
    variant(f"review order {order}, large limits", presets(lambda conf, order=order: (large(conf), conf.update(reviewOrder=order))))
for gather in range(6):
    for sort in range(5):
        variant(f"new gather {gather}, sort {sort}", set_keys(newGatherPriority=gather, newSortOrder=sort))
for mix in range(3):
    variant(f"new mix {mix}", set_keys(newMix=mix))
    variant(f"day-long learning mix {mix}", presets(lambda conf, mix=mix: (large(conf), conf.update(interdayLearningMix=mix))))
# Later the same day, and across the day's start: the limits and the buried cards come back at 4 AM.
variant("once the steps have come due", when="2026-01-20T12:30")
variant("late the same study day", when="2026-01-21T03:59")
variant("large limits, late the same study day", presets(large), when="2026-01-21T03:59")
variant("the next study day", when="2026-01-21T04:01")
variant("large limits, the next study day", presets(large), when="2026-01-21T04:01")
variant("large limits, three days on", presets(large), when="2026-01-23T09:00")

import anki.buildinfo
with open(sys.argv[1], "w") as f:
    json.dump({"anki": anki.buildinfo.version, "rows": rows, "variants": variants}, f, separators=(",", ":"))
    f.write("\n")
print(len(variants), "variants")
