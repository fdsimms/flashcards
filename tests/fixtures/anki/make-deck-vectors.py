# Builds tests/fixtures/anki/deck-vectors.json: what Anki itself writes when a deck is created,
# renamed or deleted, for tests/anki/deckEdits.test.ts, which runs the same steps through
# src/anki/deckEdits.ts on the same collection and compares.
#   <venv>/bin/python tests/fixtures/anki/make-deck-vectors.py tests/fixtures/anki/deck-vectors.json
# Each scenario starts from a fresh copy of collection.anki2 and records the collection after its
# steps: every deck (its stored blobs, usn, whether its mtime changed), the graves, every card
# (its deck, home deck, queue, due, usn, whether its mod changed), the notes left, the config keys,
# and whether the collection was stamped modified. Ids and times Anki takes from the clock can't
# match a test's, so a deck Anki added is named by its place in the order it was added instead.
import json, os, shutil, sys, tempfile
from anki.collection import Collection

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")

SCENARIOS = [
    ("create with missing parents", [("create", "Polski::Odmiana::Verbs")]),
    ("create under a parent spelled differently", [("create", "👅 languages::Polski")]),
    ("create, trimmed", [("create", "  Nowy  ::  Deck ")]),
    ("rename into a new parent", [("rename", "🧠 Trivia", "Quiz::Trivia")]),
    ("rename a deck with a subdeck", [("rename", "👅 Languages", "Języki")]),
    ("rename into a parent spelled differently", [("rename", "👅 Languages::🐘 ภาษาไทย", "🧠 trivia::Thai")]),
    ("rename, case only", [("rename", "🧠 Trivia", "🧠 TRIVIA")]),
    ("rename a filtered deck", [("rename", "Filtered Deck 1", "Nowy::Filtered")]),
    ("delete a deck with a subdeck", [("remove", "👅 Languages")]),
    ("delete a deck whose cards are in a filtered deck", [("remove", "🧠 Trivia")]),
    ("delete a filtered deck", [("remove", "Filtered Deck 1")]),
    ("delete the Default deck", [("remove", "Default")]),
    ("delete a subdeck, leaving its parent", [("remove", "👅 Languages::🐘 ภาษาไทย")]),
    ("create, rename, delete", [("create", "A::B"), ("rename", "A", "C"), ("remove", "C")]),
]


def human(native):
    return native.replace("\x1f", "::")


def snapshot(col, before, new_ids):
    names = {d: n for d, n in col.db.all("select id, name from decks")}
    key = lambda i: f"new {new_ids.index(i)}" if i in new_ids else i
    decks = []
    for i, name, mtime, usn, common, kind in col.db.all("select id, name, mtime_secs, usn, common, kind from decks order by id"):
        decks.append({
            "id": key(i),
            "name": human(name),
            "common": bytes(common).hex(),
            "kind": bytes(kind).hex(),
            "usn": usn,
            "changed": i in new_ids or before["decks"][i] != mtime,
        })
    deck_name = lambda i: human(names[i]) if i in names else (None if i == 0 else f"gone {i}")
    cards = [
        {"id": cid, "deck": deck_name(did), "home": deck_name(odid), "queue": queue, "due": due, "odue": odue, "usn": usn, "changed": before["cards"].get(cid) != mod}
        for cid, did, odid, queue, due, odue, usn, mod in col.db.all("select id, did, odid, queue, due, odue, usn, mod from cards order by id")
    ]
    return {
        "decks": decks,
        "graves": [{"oid": key(oid) if t == 2 else oid, "type": t, "usn": usn} for oid, t, usn in col.db.all("select oid, type, usn from graves order by type, oid")],
        "cards": cards,
        "notes": [{"id": nid, "usn": usn} for nid, usn in col.db.all("select id, usn from notes order by id")],
        "config": sorted(k for (k,) in col.db.all("select key from config")),
        "modified": col.db.scalar("select mod from col") != before["mod"],
    }


def run(steps):
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    col = Collection(path)
    before = {
        "decks": dict(col.db.all("select id, mtime_secs from decks")),
        "cards": dict(col.db.all("select id, mod from cards")),
        "mod": col.db.scalar("select mod from col"),
    }
    # Every deck added along the way, in the order added (a later step may delete one).
    new_ids = []
    for step in steps:
        if step[0] == "create":
            col.decks.id(step[1])
        elif step[0] == "rename":
            col.decks.rename(col.decks.id_for_name(step[1]), step[2])
        elif step[0] == "remove":
            col.decks.remove([col.decks.id_for_name(step[1])])
        new_ids += sorted(i for (i,) in col.db.all("select id from decks") if i not in before["decks"] and i not in new_ids)
    out = snapshot(col, before, new_ids)
    col.close()
    shutil.rmtree(work)
    return out


vectors = [{"name": name, "steps": [list(s) for s in steps], "after": run(steps)} for name, steps in SCENARIOS]
with open(sys.argv[1], "w") as f:
    json.dump(vectors, f, ensure_ascii=False, indent=1)
    f.write("\n")
