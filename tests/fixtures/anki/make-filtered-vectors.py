# Builds tests/fixtures/anki/filtered-vectors.json: the filtered decks Anki itself builds from
# searches on collection.anki2 (`add_or_update_filtered_deck`, then Rebuild and Empty), for
# tests/anki/filteredDeckWrites.test.ts.
#   <venv with anki>/bin/python tests/fixtures/anki/make-filtered-vectors.py tests/fixtures/anki/filtered-vectors.json
# Each case builds one deck on a fresh copy of the collection and records every card's row after,
# with deck names for its deck and home deck, the moment it was built at (`today`, `nextDayAt`,
# `now`, the learn ahead limit), and Anki's error when it refused the search.
import json, os, shutil, sys, tempfile, time
from anki.collection import Collection
from anki import decks_pb2

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")
COLS = "id, did, odid, odue, type, queue, due"


def fresh():
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    return Collection(path)


def cards(col):
    names = {d.id: d.name for d in col.decks.all_names_and_ids()}
    out = []
    for cid, did, odid, odue, ctype, queue, due in col.db.all(f"select {COLS} from cards order by id"):
        out.append({"id": cid, "deck": names.get(did), "home": names.get(odid) if odid else None, "type": ctype, "queue": queue, "due": due, "odue": odue})
    return out


cases = []
Order = decks_pb2.Deck.Filtered.SearchTerm.Order


def case(name, terms, reschedule=True, then=None, setup=(), deck_name="Built"):
    col = fresh()
    for sql in setup:
        col.db.execute(sql)
    timing = {"today": col.sched.today, "nextDayAt": col.sched.day_cutoff, "now": int(time.time()), "learnAheadSecs": col.get_config("collapseTime", 1200)}
    deck = col.sched.get_or_create_filtered_deck(deck_id=0)
    deck.name = deck_name
    del deck.config.search_terms[:]
    for search, limit, order in terms:
        deck.config.search_terms.append(decks_pb2.Deck.Filtered.SearchTerm(search=search, limit=limit, order=order))
    deck.config.reschedule = reschedule
    error = None
    try:
        did = col.sched.add_or_update_filtered_deck(deck).id
        if then == "rebuild":
            col.sched.rebuild_filtered_deck(did)
        elif then == "empty":
            col.sched.empty_filtered_deck(did)
    except Exception as e:  # Anki refuses a search that finds nothing
        error = type(e).__name__
    cases.append({
        "name": name, "terms": terms, "reschedule": reschedule, "then": then, "setup": list(setup), "deckName": deck_name,
        **timing, "error": error, "cards": cards(col),
    })
    col.close()


TRIVIA = "🧠 Trivia"
case("a deck's cards, in the order added", [[f'"deck:{TRIVIA}"', 100, Order.ADDED]])
case("new cards by due, up to a limit", [["is:new", 2, Order.DUE]])
case("latest added first", [["is:new", 3, Order.REVERSE_ADDED]])
case("a preview puts every card in the review queue", [["is:review", 100, Order.DUE]], reschedule=False)
case("two searches, the second over what the first left", [["is:new", 1, Order.ADDED], ["is:review or is:learn", 5, Order.DUE]])
case("a learning card takes a place, keeping its step's time in odue", [["is:learn", 100, Order.DUE]])
case("a plain word ignores ASCII case and searches the fields as stored", [["CAPITAL", 100, Order.ADDED]])
case("a plain word inside HTML still matches", [["<b>", 100, Order.ADDED]])
case("a field search matches the whole field", [["front:capital*", 100, Order.ADDED]])
case("tags, with children and none", [["tag:a1 or tag:none", 100, Order.ADDED]])
case("answered within some days", [["rated:30", 100, Order.ADDED]])
case("answered with a button", [["rated:30:3", 100, Order.ADDED]])
case("a property compared", [["prop:ivl>=4", 100, Order.ADDED]])
case("by interval, largest first", [["is:review", 100, Order.INTERVALS_DESCENDING]])
case("by interval, smallest first", [["is:review", 100, Order.INTERVALS_ASCENDING]])
case("oldest seen first", [["-is:new", 100, Order.OLDEST_REVIEWED_FIRST]])
case("most lapses", [["-is:new", 100, Order.LAPSES]])
case("retrievability ascending", [["is:review", 100, Order.RETRIEVABILITY_ASCENDING]])
case("relative overdueness", [["is:review", 100, Order.RELATIVE_OVERDUENESS]])
case("a note type by name", [["note:Basic*", 100, Order.ADDED]])
case("a card already in a filtered deck is left where it is", [["capital", 100, Order.ADDED]])
_probe = fresh()
TODAY = _probe.sched.today
_probe.close()
# Buried today (Anki unburies a card buried on an earlier day when it opens the collection), and
# one buried on an earlier day, which Anki has unburied by the time it builds.
case("suspended and buried cards are left out", [["is:new", 100, Order.ADDED]], setup=[
    f"update cards set queue = -3, mod = {int(time.time())} where id = 1794408858020",
    f"insert or replace into config (KEY, usn, mtime_secs, val) values ('lastUnburied', 0, 0, CAST('{TODAY}' AS BLOB))",
])
case("a card buried on an earlier day goes in", [["is:new", 100, Order.ADDED]], setup=["update cards set queue = -2, mod = 1000 where id = 1794408858030"])
case("rebuilding gives the same deck", [["is:new", 100, Order.ADDED]], then="rebuild")
case("emptying sends every card home", [["is:new", 100, Order.ADDED]], then="empty")
case("a search that finds nothing is refused", [["tag:nothing-has-this", 100, Order.ADDED]])
case("a parent deck the name names is made", [["is:new", 100, Order.ADDED]], deck_name="Practice::Today")

with open(sys.argv[1], "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
