# Builds tests/fixtures/anki/retention-vectors.json: what Anki itself writes when a preset's
# desired retention changes in its deck options (`update_deck_configs`, with "Reschedule cards on
# change" on or off), on the cards of collection.anki2, for tests/anki/retentionWrites.test.ts.
#   <venv with anki>/bin/python tests/fixtures/anki/make-retention-vectors.py tests/fixtures/anki/retention-vectors.json
# Each case runs on a fresh copy of the collection, first running its `setup` SQL (which the test
# runs too), and records every card's row after, the review log rows Anki added (type 5,
# Rescheduled), and the day Anki scheduled against (`today`, `nextDayAt`), since it reads the clock.
import json, os, shutil, sys, tempfile, time
from anki.collection import Collection
from anki import deck_config_pb2

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")
COLS = "id, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data"
REVLOG = "cid, usn, ease, ivl, lastIvl, factor, time, type"

DEFAULT, THAI, TRIVIA = 1, 1794408857990, 1794408857991
THAI_PRESET, DEFAULT_PRESET = 1794408857993, 1
REVIEW, REVIEW2, LEARNING, FILTERED = 1794408858014, 1794408858015, 1794408858016, 1794408858018


def fresh():
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(FIXTURE, path)
    return Collection(path)


def table(col, sql, cols):
    keys = [k.strip() for k in cols.split(",")]
    return [dict(zip(keys, r)) for r in col.db.all(sql)]


cases = []


def consistent(setup, cids):
    """`setup`, then each card's stored memory state set to what Anki works out from its review log
    now, as it would be had Anki answered those reviews: Franki reschedules from the stored state."""
    col = fresh()
    for sql in setup:
        col.db.execute(sql)
    out = list(setup)
    for cid in cids:
        state = col.compute_memory_state(cid)
        out.append(f"update cards set data = json_set(data, '$.s', {round(state.stability, 4)}, '$.d', {round(state.difficulty, 3)}) where id = {cid}")
    col.close()
    return out


def own_retention(did, percent):
    """The SQL that gives a deck a desired retention of its own (Anki's "This deck"), as Anki writes
    it: the legacy deck dict keeps it as a whole percentage."""
    col = fresh()
    d = col.decks.get(did)
    d["desiredRetention"] = percent
    col.decks.save(d)
    kind = col.db.scalar("select kind from decks where id = ?", did)
    col.close()
    return f"update decks set kind = X'{bytes(kind).hex()}' where id = {did}"


def case(name, deck, preset, retention, reschedule, setup=(), load_balancer=True):
    col = fresh()
    for sql in setup:
        col.db.execute(sql)
    col.set_config("loadBalancerEnabled", load_balancer)
    timing = {"today": col.sched.today, "nextDayAt": col.sched.day_cutoff}
    current = col.decks.get_deck_configs_for_update(deck)
    config = next(c.config for c in current.all_config if c.config.id == preset)
    config.config.desired_retention = retention
    col.decks.update_deck_configs(deck_config_pb2.UpdateDeckConfigsRequest(
        target_deck_id=deck,
        configs=[config],
        mode=deck_config_pb2.UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL,
        card_state_customizer=current.card_state_customizer,
        limits=current.current_deck.limits,
        new_cards_ignore_review_limit=current.new_cards_ignore_review_limit,
        apply_all_parent_limits=current.apply_all_parent_limits,
        fsrs=current.fsrs,
        fsrs_reschedule=reschedule,
    ))
    cases.append({
        "name": name, "preset": preset, "retention": retention, "reschedule": reschedule,
        "setup": list(setup), "loadBalancer": load_balancer, **timing,
        "rows": table(col, f"select {COLS} from cards order by id", COLS),
        "revlog": table(col, f"select {REVLOG} from revlog where type = 5 order by id", REVLOG),
    })
    col.close()


# Both reviews were last answered days before `today` and are long overdue at their stability:
# the load balancer gives up on them (`find_interval`), so they're fuzzed, due in the past.
case("lower a preset's retention, rescheduling overdue reviews", THAI, THAI_PRESET, 0.8, True)
case("lower a preset's retention, keeping dates", THAI, THAI_PRESET, 0.8, False)
case("raise a preset's retention, rescheduling", THAI, THAI_PRESET, 0.95, True)

# Answered yesterday, with the stability that history gives: the load balancer picks a day,
# counting each card it reschedules as it goes.
_probe = fresh()
TODAY = _probe.sched.today
_probe.close()
NOW = int(time.time())
recent = [
    f"update revlog set id = ({NOW} - 86400) * 1000 + 34 where id = 1794408858034",
    f"update revlog set id = ({NOW} - 86400) * 1000 + 36 where id = 1794408858036",
    f"update cards set data = json_set(data, '$.lrt', {NOW} - 86400), ivl = 40, due = {TODAY - 1 + 40} where id in ({REVIEW}, {REVIEW2})",
]
recent = consistent(recent, [REVIEW, REVIEW2])
case("reschedule recent reviews through the load balancer", THAI, THAI_PRESET, 0.8, True, setup=recent)
case("reschedule recent reviews with the load balancer off", THAI, THAI_PRESET, 0.8, True, setup=recent, load_balancer=False)
case("leave a suspended review where it is", THAI, THAI_PRESET, 0.8, True, setup=recent + ["update cards set queue = -1 where id = 1794408858015"])

# The filtered deck's card is home in Trivia, on the Default preset: its home due (odue) moves.
case("reschedule a card in a filtered deck by its home deck", TRIVIA, DEFAULT_PRESET, 0.8, True)
# Changed from another deck on the preset (Default): Trivia keeps its own retention, so its card stays.
case("leave a deck with its own retention alone", DEFAULT, DEFAULT_PRESET, 0.8, True, setup=[own_retention(TRIVIA, 90)])

with open(sys.argv[1], "w") as f:
    json.dump(cases, f, indent=1, ensure_ascii=False)
    f.write("\n")
