# Builds tests/fixtures/anki/sync-fixtures.json: what Anki itself makes of decks and note fields,
# for the sync tests that run without Anki (deckRows.test.ts, noteFields.test.ts).
#   /tmp/ankienv/bin/python tests/fixtures/anki/make-sync-fixtures.py tests/fixtures/anki/sync-fixtures.json
# - decks: each deck as sync sends it (the JSON form, `col.decks.all()`) beside the row Anki
#   stores for it (`decks.common` and `decks.kind`, base64).
# - notes: fields beside the sort field and checksum Anki computed for them.
# - unicase: strings in the order Anki's `unicase` collation sorts them (ties by their bytes), for
#   the collation in modules/anki-unicase: every character with a case folding and what it folds
#   to, plus words that exercise multi-character folds.
import base64, json, os, shutil, sys, tempfile
from anki.collection import Collection

out = sys.argv[1]
work = tempfile.mkdtemp()
path = os.path.join(work, "collection.anki2")
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2"), path)
col = Collection(path)

# A normal deck with everything set: description, markdown, limits, today-only limits,
# its own retention, collapsed both ways, studied today.
did = col.decks.id("Polski::Odmiana")
d = col.decks.get(did)
d["desc"] = "Cases & <b>endings</b>"
d["md"] = True
d["reviewLimit"] = 120
d["newLimit"] = 0
d["reviewLimitToday"] = {"limit": 50, "today": col.sched.today}
d["newLimitToday"] = {"limit": 3, "today": col.sched.today}
d["desiredRetention"] = 93
d["collapsed"] = True
d["browserCollapsed"] = True
d["extendNew"] = 5
d["someAddonKey"] = {"nested": [1, 2]}
col.decks.save(d)

# Study a few so the counts are set (a learning card, a review).
col.decks.select(col.decks.id("🧠 Trivia"))
for _ in range(3):
    c = col.sched.getCard()
    if not c:
        break
    c.start_timer()
    col.sched.answerCard(c, 3)

# A filtered deck.
fid = col.decks.new_filtered("Cram")
f = col.decks.get(fid)
f["terms"] = [["deck:Trivia", 50, 1], ["is:due", 20, 6]]
f["resched"] = False
f["previewAgainSecs"] = 30
f["previewHardSecs"] = 0
f["previewGoodSecs"] = 600
col.decks.save(f)

decks = []
for row in col.db.all("select id, common, kind from decks"):
    decks.append({
        "json": col.decks.get(row[0]),
        "common": base64.b64encode(bytes(row[1])).decode(),
        "kind": base64.b64encode(bytes(row[2])).decode(),
    })

basic = col.models.by_name("Basic")
fields = [
    "Tom & Jerry",
    "caf&eacute; &amp; cr&egrave;me",
    "&#x1F600; &#233;t&#xE9;",
    "<div>line one</div><div>line&nbsp;two</div>",
    "<img src='single.png' alt=\"x\"> and <img src=bare.jpg>",
    "<audio src=\"a.mp3\" controls></audio><!-- hidden --><style>p{}</style>text",
    "42",
    "  spaced  ",
    "&unknownentity; stays",
    "Tom & Jerry &amp; co",
    "&amp no semicolon &lt;",
]
notes = []
for front in fields:
    n = col.new_note(basic)
    n["Front"] = front
    n["Back"] = "b"
    col.add_note(n, 1)
    sfld, csum = col.db.first("select sfld, csum from notes where id = ?", n.id)
    notes.append({"fields": [front, "b"], "sfld": sfld, "csum": csum})

sample = set("Straße STRASSE strasse ﬁle FILE ﬃx ffix iffy Ǆemal ǆemal džemal ΐx ΐ İstanbul i̇stanbul Ölçü ölçü Ab aB a A aa _ 0 9 Z z ~ 日本語 Русский русский Ⅻ ⅻ ᾷ ᾶι".split())
for cp in range(1, 0x110000):
    if 0xD800 <= cp <= 0xDFFF:
        continue
    c = chr(cp)
    if c.casefold() != c or c.lower() != c or c.upper() != c:
        sample.update({c, c.casefold()})
col.db.execute("create table unicase_sample (x text)")
col.db.executemany("insert into unicase_sample values (?)", [(x,) for x in sample])
unicase = col.db.list("select x from unicase_sample order by x collate unicase, x")

col.close()
with open(out, "w") as fh:
    json.dump({"decks": decks, "notes": notes, "unicase": unicase}, fh, ensure_ascii=False, indent=1)
shutil.rmtree(work)
