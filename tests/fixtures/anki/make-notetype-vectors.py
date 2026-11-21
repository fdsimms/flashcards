# Builds tests/fixtures/anki/notetype-vectors.json: note types edited by Anki itself, for
# notetypeWrites.test.ts and noteTypeEdits.test.ts.
#   /tmp/ankienv/bin/python tests/fixtures/anki/make-notetype-vectors.py tests/fixtures/anki/notetype-vectors.json
# Each case changes some card templates and the styling of a note type in collection.anki2 with
# `models.update_dict` (what Anki's card layout screen saves through), then records the rows Anki
# wrote: the note type's config, each template's config (base64), and the card requirements
# Anki worked out from the new fronts.
import base64, json, os, shutil, sys, tempfile
from anki.collection import Collection

CASES = [
    {"note_type": "Basic (and reversed card)", "templates": {1: {"front": "{{Front}}<br>{{Back}}"}},
     "css": ".card { font-family: Georgia; font-size: 24px; }"},
    {"note_type": "Basic (optional reversed card)", "templates": {0: {"back": "{{FrontSide}}<hr id=answer>{{Back}}<br>{{Add Reverse}}"}}},
    # Neither field alone fills the front, both together do: "all".
    {"note_type": "Basic", "templates": {0: {"front": "{{#Front}}{{Back}}{{/Front}}"}}},
    # A front that shows no field of the note's own: "none", an empty requirement for card 1.
    {"note_type": "Basic (type in the answer)", "templates": {0: {"front": "{{Tags}}"}}},
    {"note_type": "Cloze", "templates": {0: {"front": "{{cloze:Text}}<br>{{hint:Back Extra}}"}}, "css": ""},
]

out = sys.argv[1]
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collection.anki2")
vectors = []
for case in CASES:
    work = tempfile.mkdtemp()
    path = os.path.join(work, "collection.anki2")
    shutil.copy(src, path)
    col = Collection(path)
    m = col.models.by_name(case["note_type"])
    for ord_, change in case["templates"].items():
        t = m["tmpls"][ord_]
        if "front" in change: t["qfmt"] = change["front"]
        if "back" in change: t["afmt"] = change["back"]
    if "css" in case: m["css"] = case["css"]
    col.models.update_dict(m)
    m = col.models.get(m["id"])
    nt = col.db.first("SELECT config, mtime_secs, usn FROM notetypes WHERE id = ?", m["id"])
    tmpls = col.db.all("SELECT ord, config, mtime_secs, usn FROM templates WHERE ntid = ? ORDER BY ord", m["id"])
    vectors.append({
        "note_type": m["name"],
        "kind": "cloze" if m["type"] == 1 else "normal",
        "fields": [f["name"] for f in m["flds"]],
        "templates": [{"ord": t["ord"], "name": t["name"], "front": t["qfmt"], "back": t["afmt"]} for t in m["tmpls"]],
        "css": m["css"],
        "req": m["req"],
        "config": base64.b64encode(bytes(nt[0])).decode(),
        "usn": nt[2],
        "template_configs": [[r[0], base64.b64encode(bytes(r[1])).decode(), r[2], r[3]] for r in tmpls],
    })
    col.close()
    shutil.rmtree(work)

with open(out, "w") as f:
    json.dump({"cases": vectors}, f, indent=1, ensure_ascii=False)
    f.write("\n")
