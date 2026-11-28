# Builds tests/fixtures/anki/textimport-vectors.json: what Anki itself writes when it imports a
# text file of notes (its CSV import, `import_csv`, with the defaults Anki's import screen starts
# from: existing notes updated, matched within the note type) into collection.anki2, for
# tests/anki/wordListService.test.ts.
#   <venv with anki>/bin/python tests/fixtures/anki/make-textimport-vectors.py tests/fixtures/anki/textimport-vectors.json
# Each case imports one file into a fresh copy of the collection, into `deck` unless the file names
# its own, and records every note (in id order, so the new ones in the order Anki added them) with
# its cards, which is what the test compares, ids aside.
import json, os, shutil, sys, tempfile
from anki.collection import Collection
from anki import import_export_pb2

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")


def fresh():
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    return Collection(path), work


def notes(col):
    decks = {d.id: d.name for d in col.decks.all_names_and_ids()}
    out = []
    for nid, guid, mid, tags, flds in col.db.all("select id, guid, mid, tags, flds from notes order by id"):
        cards = [
            {"ord": ord, "deck": decks[did], "type": type, "queue": queue, "due": due}
            for ord, did, type, queue, due in col.db.all("select ord, did, type, queue, due from cards where nid = ? order by ord", nid)
        ]
        out.append({"guid": guid, "notetype": col.models.get(mid)["name"], "tags": tags, "fields": flds.split("\x1f"), "cards": cards})
    return out


cases = []


def case(name, deck, text):
    col, work = fresh()
    path = os.path.join(work, "words.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    metadata = col.get_csv_metadata(path, None)
    if not metadata.HasField("deck_column") and not text.startswith("#deck:") and "\n#deck:" not in text:
        metadata.deck_id = col.decks.id_for_name(deck)
    col.import_csv(import_export_pb2.ImportCsvRequest(path=path, metadata=metadata))
    cases.append({"name": name, "deck": deck, "text": text, "notes": notes(col), "nextPos": col.get_config("nextPos")})
    col.close()


TRIVIA = "🧠 Trivia"
THAI = "👅 Languages::🐘 ภาษาไทย"

case("new notes go into the deck, in file order", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\nCapital of France?\tParis\nCapital of Spain?\tMadrid\n")
case("a deck Anki doesn't have is made, with its parents", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\n#deck:Geography::Europe\nCapital of Italy?\tRome\n")
case("a row matching a note's first field updates it, keeping its deck and progress", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\nCapital of Peru?\tLima, on the coast\nCapital of Chile?\tSantiago\nCapital of Laos?\tVientiane\n")
case("a match is found with the HTML taken off the first field", THAI,
     "#separator:tab\n#html:true\n#notetype:Basic (and reversed card)\nน้ำ\twater, drink\n")
case("a tags column replaces a note's tags, and #tags are added either way", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\n#tags:geo\n#tags column:3\nCapital of Bolivia?\tSucre\tsouth-america\nCapital of Peru?\tLima\t\nCapital of Chad?\tN'Djamena\tafrica\n")
case("without a tags column a note keeps its tags, and #tags are added", THAI,
     "#separator:tab\n#html:true\n#notetype:Basic (and reversed card)\n#tags:checked\nหนังสือ\tbook\n")
case("a row with a GUID updates that note, whatever its first field", THAI,
     "#separator:tab\n#html:true\n#notetype:Basic (and reversed card)\n#guid column:1\nd6w&~zeqG5\tหนังสือเล่ม\ta book\nnewguid01\tแมว\tcat\n")
case("a GUID of a note of another type leaves that note alone", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Cloze\n#guid column:1\ntBUe5qNZSp\t{{c1::Lima}}\t\n")
case("two rows with one first field are both added", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\nBank\tbench\nBank\tbank (money)\n")
case("a row that changes nothing leaves the note as it is", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Basic\nCapital of Peru?\tLima\n")
case("a plain text file is escaped, line breaks and all", TRIVIA,
     "#separator:tab\n#html:false\n#notetype:Basic\n\"1 < 2\"\t\"yes &\nno\"\n")
case("a cloze row makes a card for each cloze", TRIVIA,
     "#separator:tab\n#html:true\n#notetype:Cloze\n{{c1::Paris}} is in {{c2::France}}\textra\n")

with open(sys.argv[1], "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
