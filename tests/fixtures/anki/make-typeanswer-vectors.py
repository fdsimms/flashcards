"""
Records Anki's own type-the-answer output: compare_answer (what the back of a {{type:}} card
shows), for tests/core/typeAnswer.test.ts, and extract_cloze_for_typing (what a {{type:cloze:}}
card expects), for tests/core/cloze.test.ts, from the `anki` package at the sync server's
ANKI_VERSION.

    <venv>/bin/python tests/fixtures/anki/make-typeanswer-vectors.py
"""
import json
import os
import tempfile

from anki.collection import Collection

COMPARE = [
    # (expected field, typed, combining)
    ("kot", "kot", True),
    ("kot", "kto", True),
    ("123", "1123", True),
    ("¿Y ahora qué vamos a hacer?", "y ahora qe vamosa hacer", True),
    ("нос", "нс", True),
    ("쓰다듬다", "스다뜸다", True),
    ("1", "23", True),
    ("12", "1", True),
    ("<div>123</div>", "", True),
    ("<div>123</div>", "123", True),
    ("[sound:foo.mp3]<b>1</b> &nbsp;2", "1  2", True),
    ("source <dir>/bin/activate", "source <dir>/bin/activate", True),
    ("Paris", "paris", True),
    ("  spaced  ", "spaced", True),
    ("line one<br>line two", "line one line two", True),
    ("a<div>b</div><div>c</div>", "a b c", True),
    ("Tom &amp; Jerry", "Tom & Jerry", True),
    ("x &lt; y", "x < y", True),
    ("Straße", "Strasse", True),
    ("język", "jezyk", True),
    ("język", "jezyk", False),
    ("język", "jzyk", False),
    ("ภาษาไทย", "ภาษาไทย", True),
    ("ภาษาไทย", "ภาษไทย", False),
    ("café", "cafe", False),
    ("café", "café", True),
    ("Grüße", "Grusse", False),
    ("привет", "превед", True),
    ("Ich gehe nach Hause", "Ich gehe nach hause", True),
    ("Ich gehe nach Hause", "Ich gehe zu Hause", True),
    ("abc", "xyz", True),
    ("abc", "abcdef", True),
    ("<!-- c -->ok<script>x()</script>", "ok", True),
    ("it's \"x\"", "its 'x'", True),
    ("Tom & Jerry &amp; co", "Tom & Jerry & co", True),
    ("a &bogus; b &amp;", "a b &", True),
    ("&#233;t&eacute; &#x41;", "été A", True),
    ("x&nbsp;y", "x y", True),
    ("[sound:a.mp3]word[anki:tts lang=pl_PL]słowo[/anki:tts]", "word", True),
    ("<style>.a{}</style>Hi<br/>there\n", "Hi there", True),
    ("ę\u0301x", "\u0301x", True),
    # Past 200 characters, where Python's difflib would leave out "popular" characters (Anki doesn't).
    ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
     "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ulamco laboris nisi ut aliquip ex ea comodo consequat", True),
    ("aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb x",
     "aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb aaaa bbbb y", True),
]

CLOZE = [
    ("{{c1::Warsaw}} is the capital of {{c2::Poland}}", 1),
    ("{{c1::Warsaw}} is the capital of {{c2::Poland}}", 2),
    ("{{c1::a}} and {{c1::b}}", 1),
    ("{{c1::same}} and {{c1::same}}", 1),
    ("{{c1::Berlin::city}} in Germany", 1),
    ("no clozes here", 1),
    ("{{c1::one}} {{c3::three}}", 2),
]


def main() -> None:
    d = tempfile.mkdtemp()
    col = Collection(os.path.join(d, "c.anki2"))
    try:
        out = {
            "compare": [
                {"expected": e, "typed": t, "combining": c, "html": col.compare_answer(e, t, c)}
                for e, t, c in COMPARE
            ],
            "cloze": [
                {"text": t, "ord": o, "expected": col.extract_cloze_for_typing(t, o)} for t, o in CLOZE
            ],
        }
    finally:
        col.close()
    path = os.path.join(os.path.dirname(__file__), "typeanswer-vectors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
