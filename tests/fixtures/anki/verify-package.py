# Imports a package Franki wrote with Anki's own code and checks Anki accepts it with the answers
# in place. Not run in CI (it needs the `anki` Python package); run it after changing anything in
# src/anki/ that touches what goes into a package:
#
#   python3 -m venv /tmp/ankienv && /tmp/ankienv/bin/pip install anki
#   FRANKI_VERIFY_OUT=/tmp/franki.colpkg npx vitest run tests/anki/attachedSql.test.ts
#   /tmp/ankienv/bin/python tests/fixtures/anki/verify-package.py /tmp/franki.colpkg
import json, os, sys, tempfile
from anki.collection import Collection

pkg = os.path.abspath(sys.argv[1])
answers = json.load(open(pkg + ".answers.json"))
d = tempfile.mkdtemp()
path = os.path.join(d, "collection.anki2")
col = Collection(path)
backend = col._backend
col.close()
# Replaces the empty collection with the package, exactly as File > Import of a .colpkg does.
backend.import_collection_package(col_path=path, backup_path=pkg, media_folder=os.path.join(d, "media"), media_db=os.path.join(d, "media.db"))

col = Collection(path)
ok = True
for a in answers:
    card = col.get_card(a["cid"])
    last = col.db.first("select ease, type, ivl, factor, time from revlog where cid = ? order by id desc", a["cid"])
    print(f"card {card.id}: type {card.type} queue {card.queue} due {card.due} ivl {card.ivl} reps {card.reps} memory {card.memory_state} | last review {last}")
    if last is None or last[0] != a["ease"]:
        ok = False
# Anki's scheduler has to be able to work with every card as written.
col.sched.get_queued_cards(fetch_limit=50)
print("media:", sorted(os.listdir(os.path.join(d, "media"))))
msg, _ = col.fix_integrity()
print("integrity check:", msg.replace("\n", " | "))
col.close()
print("OK" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
