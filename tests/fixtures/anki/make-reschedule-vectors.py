# Builds tests/fixtures/anki/reschedule-vectors.json: what Anki itself writes for Forget
# (`schedule_cards_as_new`) and Set Due Date (`set_due_date`) on the cards of collection.anki2,
# for tests/anki/rescheduleWrites.test.ts.
#   <venv with anki>/bin/python tests/fixtures/anki/make-reschedule-vectors.py tests/fixtures/anki/reschedule-vectors.json
# Each case runs on a fresh copy of the collection and records the changed cards' rows, the
# review log rows Anki added, `nextPos` after, and the day Anki scheduled against (`today`, and
# `next_day_at`), since Set Due Date reads the clock.
import json, os, shutil, sys, tempfile
from anki.collection import Collection

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")
COLS = "id, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data"
REVLOG = "cid, usn, ease, ivl, lastIvl, factor, time, type"


def fresh():
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    return Collection(path)


def rows(col, cids):
    keys = [k.strip() for k in COLS.split(",")]
    return [dict(zip(keys, r)) for r in col.db.all(f"select {COLS} from cards where id in ({','.join(map(str, cids))}) order by id")]


def revlog(col, cids):
    keys = [k.strip() for k in REVLOG.split(",")]
    return [dict(zip(keys, r)) for r in col.db.all(f"select {REVLOG} from revlog where type = 4 and cid in ({','.join(map(str, cids))}) order by id")]


cases = []


def case(name, op, cids, run, fsrs=True, **args):
    col = fresh()
    col.set_config("fsrs", fsrs)
    timing = {"today": col.sched.today, "nextDayAt": col.sched.day_cutoff}
    run(col)
    cases.append({
        "name": name, "op": op, "cids": cids, "fsrs": fsrs, **args, **timing,
        "rows": rows(col, cids), "revlog": revlog(col, cids), "nextPos": col.get_config("nextPos"),
    })
    col.close()


REVIEW, REVIEW2, LEARNING, NEW, FILTERED, SUSPENDED = 1794408858014, 1794408858015, 1794408858016, 1794408858017, 1794408858018, 1794408858019


def forget(cids, restore, reset):
    return lambda col: col.sched.schedule_cards_as_new(cids, restore_position=restore, reset_counts=reset)


def set_due(cids, days):
    return lambda col: col.sched.set_due_date(cids, days)


for cid, label in [(REVIEW, "a review"), (LEARNING, "a learning card"), (FILTERED, "a card in a filtered deck"), (NEW, "a new card")]:
    case(f"forget {label}, back to its position", "forget", [cid], forget([cid], True, False), restorePosition=True, resetCounts=False)
case("forget a review at the end, with its counts reset", "forget", [REVIEW], forget([REVIEW], False, True), restorePosition=False, resetCounts=True)
case("forget several at the end", "forget", [REVIEW, REVIEW2, LEARNING], forget([REVIEW, REVIEW2, LEARNING], False, False), restorePosition=False, resetCounts=False)

for cid, label in [(REVIEW, "a review"), (LEARNING, "a learning card"), (NEW, "a new card"), (FILTERED, "a card in a filtered deck"), (SUSPENDED, "a suspended new card")]:
    for days in ["0", "5", "3!"]:
        case(f"set {label} due in {days}", "setDue", [cid], set_due([cid], days), days=days)
for cid, label in [(REVIEW, "a review"), (LEARNING, "a learning card"), (NEW, "a new card")]:
    for days in ["5", "3!"]:
        case(f"set {label} due in {days} without FSRS", "setDue", [cid], set_due([cid], days), fsrs=False, days=days)

with open(sys.argv[1], "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
