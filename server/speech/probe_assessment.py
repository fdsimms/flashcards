"""One-off check of what Azure's pronunciation assessment returns for a language, in particular
whether Thai gets any tone information (docs/read-and-listen/architecture.md, Speaking). Nothing in
the app calls this: run it once with a live key and read what it prints.

    cd server/reader
    AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=... \\
        uv run python ../speech/probe_assessment.py clip.wav "สวัสดีครับ" th-TH --raw clip.json

`clip.wav` is 16 kHz, 16-bit, mono (make one from any recording with
`ffmpeg -i clip.m4a -ar 16000 -ac 1 -sample_fmt s16 clip.wav`); the text is what it should say.
Record the word right and then with a wrong tone (ไม้ against ใหม่, say) and run it on both: if the
accuracy scores don't differ, tones aren't being scored. The clip goes to Azure, as Score it's does,
and nowhere else.

It sends the same request as `SpeechClient.assess` (so its host, path and header are checked too) and
prints: Azure's status, the scores at each level it returns (sentence, word, syllable, phoneme), and
every key anywhere in the answer that mentions tone, prosody, stress or intonation.
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

TONE_WORDS = ("tone", "prosody", "stress", "intonation", "pitch")
SCORES = ("AccuracyScore", "FluencyScore", "CompletenessScore", "PronScore", "ProsodyScore")


def find_keys(value: Any, path: str = "") -> list[str]:
    """Paths of keys in the answer whose name mentions tone, prosody, stress, intonation or pitch."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            here = f"{path}.{key}" if path else str(key)
            if any(word in str(key).lower() for word in TONE_WORDS):
                found.append(here)
            found.extend(find_keys(item, here))
    elif isinstance(value, list):
        for i, item in enumerate(value[:3]):  # the first few: every item has the same shape
            found.extend(find_keys(item, f"{path}[{i}]"))
    return found


def scores(item: dict[str, Any]) -> dict[str, Any]:
    nested = item.get("PronunciationAssessment")
    source = {**item, **(nested if isinstance(nested, dict) else {})}
    return {name: source[name] for name in SCORES if name in source}


def describe(answer: dict[str, Any]) -> list[str]:
    best = (answer.get("NBest") or [{}])[0]
    lines = [
        f"RecognitionStatus: {answer.get('RecognitionStatus')}",
        f"heard: {best.get('Display')}",
    ]
    lines.append(f"sentence scores: {scores(best)}")
    for word in best.get("Words") or []:
        lines.append(f"  word {word.get('Word')!r}: {scores(word)}")
        for syllable in word.get("Syllables") or []:
            lines.append(f"    syllable {syllable.get('Syllable')!r}: {scores(syllable)}")
        for phoneme in word.get("Phonemes") or []:
            lines.append(f"    phoneme {phoneme.get('Phoneme')!r}: {scores(phoneme)}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("wav", type=Path)
    parser.add_argument("reference", help="the text the recording should say")
    parser.add_argument("locale", help="for example th-TH")
    parser.add_argument("--raw", type=Path, help="write Azure's whole answer here as JSON")
    args = parser.parse_args()
    key, region = os.environ.get("AZURE_SPEECH_KEY"), os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region:
        print("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION first.", file=sys.stderr)
        return 2
    settings = {
        "ReferenceText": args.reference,
        "GradingSystem": "HundredMark",
        "Granularity": "Phoneme",
        "Dimension": "Comprehensive",
        "EnableMiscue": True,
    }
    header = base64.b64encode(json.dumps(settings, ensure_ascii=False).encode()).decode()
    r = httpx.post(
        f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
        params={"language": args.locale, "format": "detailed"},
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
            "Accept": "application/json",
            "Pronunciation-Assessment": header,
        },
        content=args.wav.read_bytes(),
        timeout=60,
    )
    print(f"HTTP {r.status_code}")
    if r.status_code >= 300:
        print(r.text[:500])
        print(
            f"Azure didn't assess {args.locale} with this request. Thai tones can't be scored this way."
        )
        return 1
    answer = r.json()
    if args.raw:
        args.raw.write_text(json.dumps(answer, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"whole answer written to {args.raw}")
    print("\n".join(describe(answer)))
    keys = find_keys(answer)
    print("\nkeys that mention tone, prosody, stress, intonation or pitch:")
    print("\n".join(f"  {k}" for k in keys) if keys else "  none")
    print(
        "\nTone information was returned. Compare the scores for the right and the wrong tone."
        if keys
        else "\nNo tone information was returned. Compare the accuracy for the right and the wrong "
        "tone: if they match, tones aren't scored."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
