# Builds tests/fixtures/anki/answer-vectors.json: what Anki itself (FSRS on, load balancer off)
# makes of a card answered at set times, for tests/core/scheduler.test.ts, which gives the same
# answers at the same times of day to `review` and compares.
#   LD_PRELOAD=<libfaketimeMT.so.1> <venv with anki>/bin/python tests/fixtures/anki/make-answer-vectors.py tests/fixtures/anki/answer-vectors.json
# Anki reads the clock, so this runs under libfaketime (apt install faketime), which each scenario
# steers through FAKETIME_TIMESTAMP_FILE. Times are wall-clock times in the scenario's zone. The
# UTC scenarios stay clear of every zone's daylight saving changes (January and February), so the
# test replays them at the same wall-clock times in whatever zone it runs in; a scenario in another
# zone crosses a change there and is replayed only in that zone (`npm run test:tz` has St. John's).
# Recorded after each answer: the card's type, queue, due (seconds from the answer for a step
# within the day, else days from the answer's study day), interval, steps left, reps, lapses, and
# its FSRS memory state.
import json, os, subprocess, sys, tempfile, time
from datetime import datetime, timedelta

FSRS6 = [0.3, 1.5, 3.0, 10.0, 6.0, 0.9, 2.8, 0.01, 1.7, 0.2, 0.85, 1.5, 0.07, 0.3, 1.7, 0.5, 2.0, 0.6, 0.1, 0.08, 0.2]

def straddle(name, hh, mm):
    """Again, Good, Good on 1m 10m steps around hh:mm, then two reviews and a lapse relearned around it."""
    def t(day, mins):
        return (datetime(2026, 1, day, hh, mm) + timedelta(minutes=mins)).strftime("%Y-%m-%dT%H:%M")
    return {"name": name, "created": "2026-01-05T10:00", "answers": [
        [t(10, -10), 1], [t(10, -2), 3], [t(10, 12), 3],
        [t(14, -30), 3], [t(24, 30), 2],
        [t(30, -10), 1], [t(30, 2), 3],
        ["2026-02-03T09:00", 3],
    ]}

SCENARIOS = [
    straddle("steps and a lapse around 14:00 (UTC midnight at UTC+14)", 14, 0),
    straddle("steps and a lapse around 13:00 (UTC midnight at UTC-11)", 13, 0),
    straddle("steps and a lapse around 20:30 (UTC midnight in Newfoundland)", 20, 30),
    straddle("steps and a lapse around 19:00 (UTC midnight in New York)", 19, 0),
    straddle("steps and a lapse around midnight", 0, 0),
    {"name": "late at night: 1 AM still belongs to the day before", "created": "2026-01-05T10:00", "answers": [
        ["2026-01-10T23:00", 4], ["2026-01-12T02:00", 3], ["2026-01-20T03:59", 3], ["2026-01-21T04:01", 2], ["2026-02-10T03:30", 3], ["2026-02-10T04:30", 3],
    ]},
    {"name": "the same day twice: an early answer the same study day", "created": "2026-01-05T10:00", "answers": [
        ["2026-01-10T09:00", 4], ["2026-01-10T21:00", 3], ["2026-01-11T03:00", 2], ["2026-01-11T05:00", 3],
    ]},
    {"name": "steps of a day or more", "created": "2026-01-05T10:00", "learn": [1, 1440, 4320], "relearn": [10, 1440], "answers": [
        ["2026-01-10T21:00", 3], ["2026-01-11T21:10", 3], ["2026-01-14T08:00", 2], ["2026-01-17T22:00", 3],
        ["2026-01-30T09:00", 1], ["2026-01-30T09:11", 3], ["2026-01-31T10:00", 3], ["2026-02-05T10:00", 3],
    ]},
    {"name": "Hard on the first step, then forgotten with no relearning steps", "created": "2026-01-05T10:00", "relearn": [], "answers": [
        ["2026-01-10T12:00", 2], ["2026-01-10T12:06", 2], ["2026-01-10T12:13", 3], ["2026-01-10T12:30", 4],
        ["2026-01-20T12:00", 3], ["2026-02-10T12:00", 1], ["2026-02-12T12:00", 3],
    ]},
    {"name": "a step that crosses the day's start", "created": "2026-01-05T10:00", "answers": [
        ["2026-01-10T03:52", 3], ["2026-01-10T03:59", 1], ["2026-01-10T04:01", 3], ["2026-01-10T04:15", 3], ["2026-01-13T03:00", 3],
    ]},
    {"name": "a preset's own weights, retention, longest interval and a 6 AM day", "created": "2026-01-05T10:00",
     "weights": FSRS6, "retention": 0.85, "maxInterval": 20, "rollover": 6, "learn": [5, 30], "relearn": [15], "answers": [
        ["2026-01-10T05:40", 3], ["2026-01-10T05:50", 3], ["2026-01-10T06:30", 3], ["2026-01-14T05:59", 3], ["2026-01-22T06:01", 4],
        ["2026-02-08T22:00", 1], ["2026-02-08T22:20", 3], ["2026-02-11T07:00", 3],
    ]},
    {"name": "the clocks going forward in Newfoundland", "tz": "America/St_Johns", "created": "2026-02-20T10:00", "answers": [
        ["2026-03-07T04:30", 4], ["2026-03-08T05:00", 3], ["2026-03-09T03:30", 3], ["2026-03-20T12:00", 3],
    ]},
    {"name": "the clocks going back in Newfoundland", "tz": "America/St_Johns", "created": "2026-10-01T10:00", "answers": [
        ["2026-10-31T23:30", 4], ["2026-11-01T03:30", 3], ["2026-11-01T04:30", 3], ["2026-11-08T03:00", 3], ["2026-11-20T12:00", 1], ["2026-11-20T12:11", 3],
    ]},
]


def record(sc):
    from anki.collection import Collection
    clock = os.environ["FAKETIME_TIMESTAMP_FILE"]
    def set_time(at):
        with open(clock, "w") as f:
            f.write("@" + at.replace("T", " ") + ":00")
    path = os.path.join(tempfile.mkdtemp(), "collection.anki2")
    set_time(sc["created"])
    col = Collection(path)
    col.set_config("fsrs", True)
    col.set_config("loadBalancerEnabled", False)
    col.set_config("rollover", sc.get("rollover", 4))
    conf = col.decks.get_config(1)
    conf["new"]["delays"] = sc.get("learn", [1, 10])
    conf["lapse"]["delays"] = sc.get("relearn", [10])
    conf["desiredRetention"] = sc.get("retention", 0.9)
    conf["rev"]["maxIvl"] = sc.get("maxInterval", 36500)
    if "weights" in sc:
        conf["fsrsParams6"] = sc["weights"]
    col.decks.update_config(conf)
    note = col.new_note(col.models.by_name("Basic"))
    note["Front"] = "front"
    col.add_note(note, 1)
    cid = col.db.scalar("select id from cards")
    steps = []
    for at, rating in sc["answers"]:
        set_time(at)
        col.close()
        col = Collection(path)  # Anki keeps the day it worked out when the collection was opened
        card = col.get_card(cid)
        card.start_timer()
        # Anki's own ratings count from 0 (Again).
        col.sched.answer_card(col.sched.build_answer(card=card, states=col._backend.get_scheduling_states(cid), rating=rating - 1))
        ctype, queue, due, ivl, reps, lapses, left, data = col.db.first("select type, queue, due, ivl, reps, lapses, left, data from cards where id = ?", cid)
        data = json.loads(data or "{}")
        steps.append({
            "at": at, "rating": rating, "type": ctype, "queue": queue,
            **({"dueInSecs": due - int(time.time())} if queue == 1 else {"dueInDays": due - col.sched.today}),
            "interval": ivl, "stepsLeft": left % 1000, "reps": reps, "lapses": lapses,
            "stability": data.get("s"), "difficulty": data.get("d"),
        })
    col.close()
    return {**{k: v for k, v in sc.items() if k != "answers"}, "cardId": str(cid), "answers": steps}


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--scenario":
        print(json.dumps(record(SCENARIOS[int(sys.argv[2])])))
        sys.exit()
    if "faketime" not in os.environ.get("LD_PRELOAD", ""):
        sys.exit("Run under libfaketime: LD_PRELOAD=<libfaketimeMT.so.1> python make-answer-vectors.py <out.json>")
    out = []
    for i, sc in enumerate(SCENARIOS):
        clock = tempfile.NamedTemporaryFile(delete=False)
        clock.write(b"@2026-01-01 00:00:00")
        clock.close()
        env = {**os.environ, "TZ": sc.get("tz", "UTC"), "FAKETIME_TIMESTAMP_FILE": clock.name, "FAKETIME_NO_CACHE": "1"}
        out.append(json.loads(subprocess.run([sys.executable, __file__, "--scenario", str(i)], env=env, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]))
    import anki.buildinfo
    with open(sys.argv[1], "w") as f:
        json.dump({"anki": anki.buildinfo.version, "scenarios": out}, f, indent=1)
        f.write("\n")
