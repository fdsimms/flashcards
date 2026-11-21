# Builds tests/fixtures/anki/deck.apkg (and deck-legacy.apkg) from collection.anki2, for the .apkg
# merge tests, plus apkg-vectors.json: what Anki's own import makes of deck.apkg in a copy of
# collection.anki2, which tests/anki/apkgMerge.test.ts compares Franki's merge against.
#   python3 -m venv /tmp/ankienv && /tmp/ankienv/bin/pip install anki
#   /tmp/ankienv/bin/python tests/fixtures/anki/make-apkg.py
#
# The package is "🧠 Trivia" exported from a copy of the fixture collection with more added to it,
# so it holds notes the fixture already has (same guids: "already here"), new notes in a subdeck
# with a note type the fixture doesn't have, media new to the fixture, and answered cards (review
# log rows and review-state cards whose due day depends on the collection's creation day).
import json, os, shutil, sys, tempfile
from anki.collection import Collection, DeckIdLimit, ExportAnkiPackageOptions, ImportAnkiPackageOptions, ImportAnkiPackageRequest

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "collection.anki2")
work = tempfile.mkdtemp()

def copy_fixture(name):
    d = os.path.join(work, name)
    os.makedirs(d)
    path = os.path.join(d, "collection.anki2")
    shutil.copy(src, path)
    shutil.copytree(os.path.join(here, "collection.media"), os.path.join(d, "collection.media"))
    return path

col = Collection(copy_fixture("source"))
# A different creation day from the fixture's, so review due days have to be moved.
col.db.execute("update col set crt = crt - 86400 * 40")
trivia = col.decks.id("🧠 Trivia")
geo = col.decks.id("🧠 Trivia::Geography")
vocab = col.models.copy(col.models.by_name("Basic"))
vocab["name"] = "Vocab"
col.models.update_dict(vocab)
vocab = col.models.by_name("Vocab")
col.media.write_data("lima.jpg", b"\xff\xd8\xffjpeg-ish bytes")
def add(model, deck, front, back):
    n = col.new_note(model); n["Front"] = front; n["Back"] = back
    col.add_note(n, deck); return n
a = add(vocab, geo, 'Lima<br><img src="lima.jpg">', "Peru")
b = add(vocab, geo, "Quito", "Ecuador")
c = add(col.models.by_name("Basic"), trivia, "Capital of Uruguay?", "Montevideo")
def answer(cid, ease):
    card = col.get_card(cid); card.start_timer(); col.sched.answerCard(card, ease)
answer(a.card_ids()[0], 3); answer(a.card_ids()[0], 3)  # learning -> review
answer(b.card_ids()[0], 1)                              # learning
opts = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=False)
col.export_anki_package(out_path=os.path.join(here, "deck.apkg"), options=opts, limit=DeckIdLimit(trivia))
legacy = ExportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True, with_media=True, legacy=True)
col.export_anki_package(out_path=os.path.join(here, "deck-legacy.apkg"), options=legacy, limit=DeckIdLimit(trivia))
new_guids = {a.guid, b.guid, c.guid}
col.close()

# What Anki's own import makes of it, in a fresh copy of the fixture.
col = Collection(copy_fixture("target"))
req = ImportAnkiPackageRequest(package_path=os.path.join(here, "deck.apkg"), options=ImportAnkiPackageOptions(with_scheduling=True, with_deck_configs=False))
col.import_anki_package(req)
cards = []
for guid in sorted(new_guids):
    nid = col.db.scalar("select id from notes where guid = ?", guid)
    for cid in col.db.list("select id from cards where nid = ? order by ord", nid):
        card = col.get_card(cid)
        cards.append({"guid": guid, "ord": card.ord, "deck": col.decks.name(card.did), "type": card.type, "queue": card.queue,
                      "due": card.due, "ivl": card.ivl, "reps": card.reps, "lapses": card.lapses, "left": card.left,
                      "revlog": col.db.scalar("select count() from revlog where cid = ?", cid)})
out = {
    "notes": col.note_count(), "cards": col.card_count(),
    "newGuids": sorted(new_guids), "cards_of_new_notes": cards,
    "media": sorted(os.listdir(col.media.dir())),
    "revlog": col.db.scalar("select count() from revlog"),
    "decks": sorted(d.name for d in col.decks.all_names_and_ids()),
    "noteTypes": sorted(m.name for m in col.models.all_names_and_ids()),
    "nextPos": col.get_config("nextPos"),
}
col.close()
json.dump(out, open(os.path.join(here, "apkg-vectors.json"), "w"), indent=1, ensure_ascii=False)
shutil.rmtree(work)
print("ok")
