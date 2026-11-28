# Builds tests/fixtures/anki/bulk-vectors.json: what Anki itself writes for the browser's Reposition
# (`reposition_new_cards`), Add Tags and Remove Tags (`tags.bulk_add`, `bulk_remove`) and Change Deck
# (`set_deck`) on collection.anki2, for tests/anki/bulkWrites.test.ts.
#   <venv with anki>/bin/python tests/fixtures/anki/make-bulk-vectors.py tests/fixtures/anki/bulk-vectors.json
# Each case runs on a fresh copy and records every card's deck, home deck, queue, due and odue, and
# every note's tags, after.
import json, os, shutil, sys, tempfile
from anki.collection import Collection

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")


def fresh():
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    return Collection(path)


def state(col):
    names = {d.id: d.name for d in col.decks.all_names_and_ids()}
    cards = [{"id": i, "deck": names.get(did), "home": names.get(odid) if odid else None, "queue": q, "due": due, "odue": odue}
             for i, did, odid, q, due, odue in col.db.all("select id, did, odid, queue, due, odue from cards order by id")]
    notes = [{"id": i, "tags": t} for i, t in col.db.all("select id, tags from notes order by id")]
    return {"cards": cards, "notes": notes}


cases = []


def case(name, op, run, **args):
    col = fresh()
    run(col)
    cases.append({"name": name, "op": op, **args, **state(col)})
    col.close()


NEW = [1794408858020, 1794408858030, 1794408858031]  # Trivia's new cards (030 and 031 are notes 30, 31)
case("reposition from 1 in steps of 1, keeping the others where they are", "reposition",
     lambda col: col.sched.reposition_new_cards(NEW, starting_from=1, step_size=1, randomize=False, shift_existing=False),
     cids=NEW, start=1, step=1, shift=False)
case("reposition from 3 in steps of 10, shifting the others along", "reposition",
     lambda col: col.sched.reposition_new_cards(NEW, starting_from=3, step_size=10, randomize=False, shift_existing=True),
     cids=NEW, start=3, step=10, shift=True)
case("reposition a review card leaves it alone", "reposition",
     lambda col: col.sched.reposition_new_cards([1794408858014, 1794408858020], starting_from=50, step_size=1, randomize=False, shift_existing=False),
     cids=[1794408858014, 1794408858020], start=50, step=1, shift=False)

NOTES = [1794408858013, 1794408858016]
case("add tags, case aside for one already there", "addTags", lambda col: col.tags.bulk_add(NOTES, "Noun travel"), nids=NOTES, tags=["Noun", "travel"])
case("remove a tag with its children", "removeTags", lambda col: col.tags.bulk_remove([1794408858013], "a1"), nids=[1794408858013], tags=["a1"])
case("remove tags case aside, with no wildcards", "removeTags", lambda col: col.tags.bulk_remove([1794408858013], "N* NOUN"), nids=[1794408858013], tags=["N*", "NOUN"])

TRIVIA = 1794408857991
# Every card of each note, as Browse moves a note: one is in a filtered deck and goes home first.
MOVED = [1794408858015, 1794408858016]
case("change deck, a card in a filtered deck going home first", "deck",
     lambda col: col.set_deck([c for n in MOVED for c in col.card_ids_of_note(n)], TRIVIA), nids=MOVED, deckId=TRIVIA)

with open(sys.argv[1], "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
