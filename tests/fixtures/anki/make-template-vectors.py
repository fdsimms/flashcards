"""
Records Anki's own card generation and cloze rendering for tests/core/cloze.test.ts and
tests/core/template.test.ts, from the `anki` package at the sync server's ANKI_VERSION:

- cloze: which cards a cloze note makes, what {{cloze:Text}} and {{cloze-only:Text}} render on
  each side of each, and extract_cloze_for_typing for each cloze number (clozes inside MathJax
  and image occlusion clozes included);
- cardgen: whether a normal note type's template makes a card for a note's fields and tags;
- conditionals: what {{#Field}} / {{^Field}} do with a field's value;
- imageOcclusion: both sides of each card of Image Occlusion notes, with Anki's stock note type.

    <venv>/bin/python tests/fixtures/anki/make-template-vectors.py
"""
import json
import os
import tempfile

from anki.collection import Collection

SPLIT = "@@"

CLOZE = [
    # (Text, Back Extra)
    ("{{c1::Lima}} is the capital of {{c2::Peru::country}}", ""),
    ("{{c1::Paris {{c2::France}}}}", ""),
    ("foo {{c1::bar {{c2::baz}}::qux}}", ""),
    ("{{c1::a::h1 {{c2::b}}::h2}}", ""),
    ("{{c1::outer {{c1::inner}} end}}", ""),
    ("{{c2::te{{c1::s}}}}t{{", ""),
    ("{{c1,2::shared}} and {{c3::three}}", ""),
    ("{{c0::zero}} {{c2::two}}", ""),
    ("a }} b {{c1::x}} {{c", ""),
    ("{{c1::unclosed {{c2::two}}", ""),
    ("{{c1::a}} {{c1::b}} {{c1::a}}", ""),
    ("{{c1::x::hint with <b>&amp;</b> \"q\"}}", ""),
    ("{{c1::<b>bold</b> & \"q\" 'a' <x> é Ł\n1/2}}", ""),
    ("{{c1::}} {{c1:: }}", ""),
    ("{{c1::::}} {{c2::a::}}", ""),
    ("{{C1::upper}} {{c01::leading zero}} {{c::none}} {{c1,::comma}}", ""),
    ("{{c3::only three}}", ""),
    ("{{c1::Text}}", "{{c2::in the other field}}"),
    ("{{c1::x}}}", ""),
    ("".join("{{c%d::%d " % (i, i) for i in range(1, 13)) + "end" + "}}" * 12, ""),
    # MathJax: the cloze filter strips HTML between \( \) or \[ \], its own spans included.
    (r"\({{c1::x^2}}\) and {{c2::y::why}}", ""),
    (r"\({{c1::x::<i>h</i>}} + {{c2::<b>z</b>}}\)", ""),
    (r'\[<b>a</b> {{c1::<span style="color:red">b</span> &lt; c&nbsp;d}}\]', ""),
    (r"{{c1::\(a\)}} {{c2::a \(b}} <i>c</i>\)", ""),
    ("\\(\n<!-- {{c2::note}} -->{{c1::x<br>y}}\n\\]", ""),
    (r"\(<STYLE>p{}</STYLE><script>1<2</script>{{c1::a}}\) \(unclosed {{c2::<b>b</b>}}", ""),
    (r"\\({{c1::<b>x</b>}}\\) \)<b>{{c2::y}}</b>\(", ""),
    # Image occlusion: a cloze starting "image-occlusion:" becomes a div of data attributes.
    ("{{c1::image-occlusion:rect:left=.2:top=.3:width=.1:height=.1:oi=1}}"
     "{{c2::image-occlusion:ellipse:left=.5:top=.5:width=.2:height=.1:rx=.1:ry=.05:oi=1}}", ""),
    ("{{c1::image-occlusion:polygon:left=.1:top=.1:points=.1,.1 .3,.1 .2,.4:oi=1}}"
     "{{c1::image-occlusion:rect:left=.6:top=.6:width=.1:height=.1:angle=1250:fill=#ff0000:oi=1}}"
     '{{c0::image-occlusion:text:left=.4:top=.05:text=Label \\: <b>&"x"</b> \\\\ é:scale=1.5:fs=.04:oi=1}}'
     "{{c2,3::image-occlusion:rect:left=.0:top=.0:width=.05:height=.05}}", ""),
    ("{{c1::image-occlusion:rect:left=:top=.2:width=0:height=.1}} "
     "{{c2::image-occlusion:circle:left=.1:foo=bar:rx=0:ry=:points=1 2,3 4,5,6:text=:fs=:scale=0}} "
     "{{c3::image-occlusion:rect:left=a\\x:top=.1}} {{c4::image-occlusion:rect::left=.1:top=.2::hint}} "
     "{{c5::image-occlusion:}} {{c6::image-occlusion:rect:left=.1\\}} {{c7::image-occlusion:rect}} "
     "{{c8::image-occlusion:rect:left=\\:x=1:top=a=b:x:y=2:points=}}", ""),
    ("{{c1::image-occlusion:rect:left=.1:top=.1:width=.1:height=.1 {{c2::nested}}}} {{c2::two}} \\({{c3::image-occlusion:text:text=<b>m</b>}}\\)", ""),
]

# Image Occlusion notes, rendered with Anki's stock note type: (Occlusion, Image, Header, Back Extra).
IMAGE_OCCLUSION = [
    ("{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:oi=1}}"
     "{{c2::image-occlusion:ellipse:left=.5:top=.2:width=.2:height=.1:rx=.1:ry=.05:oi=1}}"
     "{{c3::image-occlusion:polygon:left=.1:top=.6:points=.1,.6 .3,.6 .2,.9:oi=1}}"
     "{{c0::image-occlusion:text:left=.6:top=.7:text=Label:scale=1:fs=.05:oi=1}}",
     '<img src="io.png">', "Header", "Extra"),
    ("{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}"
     "{{c2::image-occlusion:rect:left=.5:top=.5:width=.2:height=.2:angle=1250}}"
     "{{c2::image-occlusion:rect:left=.7:top=.1:width=.1:height=.1}}",
     '<img src="io.png">', "", ""),
]

FRONTS = [
    "{{Back}}",
    "{{^Extra}}No extra{{/Extra}}{{Back}}",
    "{{#Extra}}static text{{/Extra}}",
    "{{^Back}}{{Extra}}{{/Back}}",
    "{{^Back}}{{Front}}{{/Back}}",
    "{{#Back}}{{Front}}{{/Back}}",
    "{{#Back}}{{/Back}}",
    "<img src='x.png'>{{^Back}}{{/Back}}",
    "{{text:Back}}",
    "{{type:Back}}",
    "{{ Back }}",
    "<!-- {{Back}} -->{{#Extra}}{{/Extra}}",
    "{{Deck}}",
    "{{Subdeck}}",
    "{{Card}}",
    "{{Type}}",
    "{{CardFlag}}",
    "{{Tags}}",
    "{{FrontSide}}",
    "{{=<% %>=}}<%Back%>",
]

FIELDS = {
    "empty": {"Front": "f", "Back": "", "Extra": ""},
    "back": {"Front": "f", "Back": "b", "Extra": ""},
    "extra": {"Front": "f", "Back": "", "Extra": "x"},
    "back &nbsp;": {"Front": "f", "Back": "&nbsp;", "Extra": ""},
    "back U+00A0": {"Front": "f", "Back": " ", "Extra": ""},
    "back <br>": {"Front": "f", "Back": "<br>", "Extra": ""},
    "back <BR />": {"Front": "f", "Back": "<BR />", "Extra": ""},
    "back <br  />": {"Front": "f", "Back": "<br  />", "Extra": ""},
    "back divs": {"Front": "f", "Back": " <div> <br/> </div>\n\t\x0b\x0c\r", "Extra": ""},
    "back <p></p>": {"Front": "f", "Back": "<p></p>", "Extra": ""},
    "back U+2003": {"Front": "f", "Back": " ", "Extra": ""},
}

CONDITIONAL = ["", "&nbsp;", " ", "<br>", " ", " ", "<div></div>", "<img src=x.png>"]


def cloze_vectors(col: Collection) -> list:
    mm = col.models
    nt = mm.copy(mm.by_name("Cloze"))
    nt["name"] = "Cloze probe"
    nt["tmpls"][0]["qfmt"] = "{{cloze:Text}}" + SPLIT + "{{cloze-only:Text}}"
    nt["tmpls"][0]["afmt"] = "{{cloze:Text}}" + SPLIT + "{{cloze-only:Text}}"
    mm.update_dict(nt)
    nt = mm.by_name("Cloze probe")
    out = []
    for text, extra in CLOZE:
        n = col.new_note(nt)
        n["Text"] = text
        n["Back Extra"] = extra
        col.add_note(n, 1)
        cards = {}
        for c in sorted(n.cards(), key=lambda c: c.ord):
            r = c.render_output(reload=True)
            if "No cloze" in r.question_text:
                # The card Anki adds to a note that makes none, to show this error on.
                cards[str(c.ord)] = {"empty": True}
                continue
            q, q_only = r.question_text.split(SPLIT) if SPLIT in r.question_text else (r.question_text, None)
            a, a_only = r.answer_text.split(SPLIT) if SPLIT in r.answer_text else (r.answer_text, None)
            cards[str(c.ord)] = {"front": q, "back": a, "frontOnly": q_only, "backOnly": a_only}
        out.append({
            "text": text,
            "extra": extra,
            "ords": sorted(c.ord for c in n.cards()),
            "cards": cards,
            "typing": {str(o): col.extract_cloze_for_typing(text, o) for o in range(0, 5)},
        })
    return out


def cardgen_vectors(col: Collection) -> list:
    mm = col.models
    out = []
    for i, front in enumerate(FRONTS):
        nt = mm.new(f"Gen {i}")
        for f in ["Front", "Back", "Extra"]:
            mm.add_field(nt, mm.new_field(f))
        # Template 0 always makes a card, so whether template 1 does shows on its own (Anki gives
        # a note that would have none card 0 anyway).
        for j, q in enumerate(["{{Front}}", front]):
            t = mm.new_template(f"T{j}")
            t["qfmt"] = q
            t["afmt"] = "{{FrontSide}}"
            mm.add_template(nt, t)
        mm.add(nt)
        nt = mm.by_name(f"Gen {i}")
        for name, fields in FIELDS.items():
            for tags in ([], ["t"]):
                n = col.new_note(nt)
                for k, v in fields.items():
                    n[k] = v
                n.tags = tags
                col.add_note(n, 1)
                out.append({"front": front, "case": name, "fields": fields, "tags": tags,
                            "generates": 1 in [c.ord for c in n.cards()]})
    return out


def conditional_vectors(col: Collection) -> list:
    mm = col.models
    nt = mm.new("Conditional")
    for f in ["A", "B"]:
        mm.add_field(nt, mm.new_field(f))
    t = mm.new_template("T")
    t["qfmt"] = "{{A}}|{{#B}}has B{{/B}}{{^B}}no B{{/B}}"
    t["afmt"] = "x"
    mm.add_template(nt, t)
    mm.add(nt)
    nt = mm.by_name("Conditional")
    out = []
    for b in CONDITIONAL:
        n = col.new_note(nt)
        n["A"] = "a"
        n["B"] = b
        col.add_note(n, 1)
        out.append({"value": b, "front": n.cards()[0].render_output(reload=True).question_text})
    return out


def image_occlusion_vectors(col: Collection) -> dict:
    col._backend.add_image_occlusion_notetype()
    nt = col.models.by_name("Image Occlusion")
    t = nt["tmpls"][0]
    notes = []
    for occlusion, image, header, extra in IMAGE_OCCLUSION:
        n = col.new_note(nt)
        n["Occlusion"], n["Image"], n["Header"], n["Back Extra"] = occlusion, image, header, extra
        col.add_note(n, 1)
        cards = {}
        for c in sorted(n.cards(), key=lambda c: c.ord):
            r = c.render_output(reload=True)
            cards[str(c.ord)] = {"front": r.question_text, "back": r.answer_text}
        notes.append({"fields": dict(n.items()), "cards": cards})
    return {
        "noteType": {"name": nt["name"], "fields": [f["name"] for f in nt["flds"]], "css": nt["css"],
                     "front": t["qfmt"], "back": t["afmt"]},
        "notes": notes,
    }


def main() -> None:
    d = tempfile.mkdtemp()
    col = Collection(os.path.join(d, "c.anki2"))
    try:
        out = {"cloze": cloze_vectors(col), "cardgen": cardgen_vectors(col), "conditionals": conditional_vectors(col),
               "imageOcclusion": image_occlusion_vectors(col)}
    finally:
        col.close()
    path = os.path.join(os.path.dirname(__file__), "template-vectors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
