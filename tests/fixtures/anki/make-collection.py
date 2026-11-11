# Builds tests/fixtures/anki/collection.anki2, a real Anki collection for the exporter tests.
#   python3 -m venv /tmp/ankienv && /tmp/ankienv/bin/pip install anki
#   /tmp/ankienv/bin/python tests/fixtures/anki/make-collection.py tests/fixtures/anki/collection.anki2
# Remove the old file and collection.media first; Anki opens an existing collection rather than
# replacing it. Then delete collection.media.db2 and any -wal/-shm files: the exporter reads neither.
import sys
from anki.collection import Collection
path = sys.argv[1]
col = Collection(path)
col.set_config("fsrs", True)
thai = col.decks.id("👅 Languages::🐘 ภาษาไทย")
trivia = col.decks.id("🧠 Trivia")
# Preset for Thai: 1 new/day, 150 reviews, retention 0.85, custom weights
conf = col.decks.add_config_returning_id("Thai preset")
c = col.decks.get_config(conf)
c["new"]["perDay"] = 1
c["rev"]["perDay"] = 150
c["desiredRetention"] = 0.85
c["fsrsParams6"] = [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]
c["rev"]["maxIvl"] = 3650
col.decks.update_config(c)
d = col.decks.get(thai); d["conf"] = conf; col.decks.save(d)

basic = col.models.by_name("Basic")
rev = col.models.by_name("Basic (and reversed card)")
def add(model, deck, front, back, tags=""):
    n = col.new_note(model); n["Front"] = front; n["Back"] = back
    if tags: n.tags = tags.split()
    col.add_note(n, deck); return n
n1 = add(rev, thai, "หนังสือ", "book", "noun a1")
n2 = add(rev, thai, "<b>น้ำ</b>", "water")
n3 = add(basic, trivia, "Capital of Peru?", "Lima")
n4 = add(basic, trivia, "Capital of Chile?", "Santiago")
add(basic, trivia, "Capital of Bolivia?", "Sucre")
# Media: an image and a sound in a Basic note, and a cloze note, for template rendering.
col.media.write_data("flag.svg", b'<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="red"/></svg>')
col.media.write_data("hello.mp3", b"ID3fake")
col.media.write_data("unused.png", b"not referenced by any note")
add(basic, trivia, 'Flag of Peru?<br><img src="flag.svg">', "Peru [sound:hello.mp3]")
cloze = col.models.by_name("Cloze")
c = col.new_note(cloze); c["Text"] = "{{c1::Lima}} is the capital of {{c2::Peru::country}}"; col.add_note(c, trivia)
# Answer some cards
def answer_card(cid, ease):
    card = col.get_card(cid); card.start_timer()
    col.sched.answerCard(card, ease)
for cid in n1.card_ids(): answer_card(cid, 3); answer_card(cid, 3)  # learning -> review
answer_card(n2.card_ids()[0], 1)  # learning (again)
answer_card(n3.card_ids()[0], 4)  # easy -> review
# suspend n4
col.sched.suspend_cards(n4.card_ids())
# Trivia keeps the default preset but sets its own new-card limit ("This deck" in deck options).
t = col.decks.get(trivia); t["newLimit"] = 3; col.decks.save(t)
# Borrow the reviewed trivia card into a filtered deck: it must export under its home deck.
fid = col.decks.new_filtered("Filtered Deck 1")
f = col.decks.get(fid); f["terms"] = [["\"deck:🧠 Trivia\" is:review", 100, 0]]; col.decks.save(f)
col.sched.rebuild_filtered_deck(fid)
col.close()
print("ok")
