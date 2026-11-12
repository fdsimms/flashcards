"""
Records how Anki reads its text-to-speech tags, for tests/core/tts.test.ts: each tag's text,
language, voices and speed from extract_av_tags, in the order Anki would play them, from the
`anki` package at the sync server's ANKI_VERSION.

    <venv>/bin/python -I tests/fixtures/anki/make-tts-vectors.py
"""
import json
import os
import tempfile

from anki.collection import Collection

TEXTS = [
    "[anki:tts lang=en_US]Hello[/anki:tts]",
    "[anki:tts lang=th_TH voices=Apple_Kanya,Apple_Narisa speed=0.8]สวัสดี[/anki:tts]",
    "[anki:tts lang=pl_PL]<b>kot</b><br>pies&nbsp;i&amp;ryba<div>koń</div>[/anki:tts]",
    "[anki:tts lang=de_DE]Ich <span class=\"cloze\">[...]</span> nach Hause[/anki:tts]",
    "[anki:tts lang=de_DE cloze_blank=hmm]Ich [...] nach Hause[/anki:tts]",
    "[anki:tts lang=en_US speed=foo]bad speed[/anki:tts]",
    "[anki:tts lang=\"en_US\" voices=\"A B\"]quoted[/anki:tts]",
    "[anki:tts voices=Bob]no language[/anki:tts]",
    "front [sound:a.mp3] [anki:tts lang=ru_RU]мир[/anki:tts] and [anki:tts lang=es_ES]paz[/anki:tts]",
    "[anki:tts lang=en_US]line<br/>break<p>para</p>[/anki:tts]",
    "[anki:tts lang=en_US bar=baz]extra option[/anki:tts]",
]


def main() -> None:
    d = tempfile.mkdtemp()
    col = Collection(os.path.join(d, "c.anki2"))
    out = []
    try:
        for text in TEXTS:
            res = col._backend.extract_av_tags(text=text, question_side=True)
            tags = []
            for t in res.av_tags:
                if t.HasField("tts"):
                    tags.append({"text": t.tts.field_text, "lang": t.tts.lang, "voices": list(t.tts.voices), "speed": round(t.tts.speed, 6)})
                else:
                    tags.append({"sound": t.sound_or_video})
            out.append({"html": text, "tags": tags, "rendered": res.text})
    finally:
        col.close()
    path = os.path.join(os.path.dirname(__file__), "tts-vectors.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
