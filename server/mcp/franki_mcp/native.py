"""
Native recordings (docs/read-and-listen/architecture.md, Native recordings): a word's Audio from a
native speaker on Wikimedia Commons (franki_speech.commons, shared with Read & Listen) in place of an
Azure recording, with the credit its license asks for in the note's AudioCredit field.

Whether it's used is one collection config value (`frankiNativeRecordings`, `{on, languages}`), set in
Franki's Settings, Voices, so the app and the MCP decide alike. A note type without an AudioCredit
field gets none: a recording kept without its credit is what the field exists to prevent.

`NativeRecorder.keep` is the one path: add_notes uses it before recording with Azure, and the
add_native_recordings tool for notes already in a deck (preview first, as the other bulk tools do).
"""

from __future__ import annotations

import hashlib
from typing import Any

from anki.collection import Collection
from franki_speech.commons import Commons, CommonsUnavailable, Recording
from franki_speech.loudness import LoudnessError, normalize_loudness, trim_silence
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from . import omnilanguage
from .collection import CollectionManager
from .pronunciation import LANGUAGE_CODES

NATIVE_KEY = "frankiNativeRecordings"
CREDIT_FIELD = "AudioCredit"
# Commons has too few of these languages' common words to be worth turning on unless asked
# (src/core/nativeRecordings.ts says the same for the app).
OFF_BY_DEFAULT = frozenset({"th", "el"})
MAX_NOTES = 20

READ = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True)


def wanted(config: Any, language: str) -> bool:
    """Whether native recordings are on for `language` (a code): the switch, then the language's own
    choice, else on unless it's one Commons has few of."""
    if not isinstance(config, dict) or not config.get("on"):
        return False
    languages = config.get("languages") if isinstance(config.get("languages"), dict) else {}
    choice = languages.get(language)
    return bool(choice) if isinstance(choice, bool) else language not in OFF_BY_DEFAULT


def native_filename(title: str) -> str:
    return f"franki-native-{hashlib.sha1(title.encode()).hexdigest()[:16]}.mp3"


def _plain(col: Collection, html: str) -> str:
    from .tools import _text

    return _text(col, html).strip()


class NativeRecorder:
    def __init__(self, cm: CollectionManager, commons: Commons | None) -> None:
        self.cm = cm
        self.commons = commons

    async def keep(
        self,
        note_ids: list[int],
        overwrite: bool = False,
        preview: bool = False,
        only_wanted: bool = True,
        only_silent: bool = False,
    ) -> list[dict[str, Any]]:
        """Finds and keeps a native recording for each note (at most `MAX_NOTES`): its Entry looked up
        in its Language, the first recording found put in Audio (any other text there stays) and its
        credit in AudioCredit. A note with a native recording already is skipped unless
        `overwrite`; one with no recording found keeps its Audio. `preview` finds and says what it
        would keep, writing nothing. `only_wanted` skips a language the setting leaves off. `only_silent`
        skips a note whose Audio already holds a recording, as the Azure recording of a new note does."""
        if self.commons is None:
            raise ToolError("Native recordings aren't set up on this server.")
        commons = self.commons

        from .tools import SOUND

        def plan(col: Collection) -> list[dict[str, Any]]:
            config = col.get_config(NATIVE_KEY, {}) or {}
            rows: list[dict[str, Any]] = []
            for nid in note_ids[:MAX_NOTES]:
                row: dict[str, Any] = {"note_id": nid}
                rows.append(row)
                try:
                    note = col.get_note(nid)  # type: ignore[arg-type]
                except Exception:  # noqa: BLE001 - a deleted note
                    row["error"] = "No such note."
                    continue
                nt = note.note_type()
                if nt is None or nt["name"] != omnilanguage.NOTE_TYPE:
                    row["skipped"] = "Not an Omnilanguage note."
                    continue
                if CREDIT_FIELD not in note:
                    row["skipped"] = (
                        f"The note type has no {CREDIT_FIELD} field for the recording's credit. Add it with "
                        "add_field (every device syncs first)."
                    )
                    continue
                language = LANGUAGE_CODES.get(_plain(col, note["Language"]).lower(), "")
                if not language:
                    row["skipped"] = "Its Language isn't one Franki knows."
                    continue
                if only_wanted and not wanted(config, language):
                    row["skipped"] = "Native recordings are off for this language (Franki, Settings, Voices)."
                    continue
                if only_silent and SOUND.search(note["Audio"]):
                    row["skipped"] = "Its Audio has a recording already."
                    continue
                if note[CREDIT_FIELD].strip() and not overwrite:
                    row["skipped"] = "It has a native recording already. Pass overwrite to replace it."
                    continue
                word = _plain(col, note["Entry"])
                if not word:
                    row["skipped"] = "Its Entry is empty."
                    continue
                row.update(word=word, language=language, was=(note["Audio"], note[CREDIT_FIELD]))
            return rows

        rows = await self.cm.read(plan)
        # Every word of a language looked up at once (Commons.find_many): one Lingua Libre query and
        # one Commons request for the call rather than both for each note.
        words: dict[str, list[str]] = {}
        for row in rows:
            if "word" in row:
                words.setdefault(row["language"], []).append(row["word"])
        looked_up: dict[str, dict[str, list[Recording]] | CommonsUnavailable] = {}
        for language, asked in words.items():
            try:
                looked_up[language] = await commons.find_many(language, asked)
            except CommonsUnavailable as e:
                looked_up[language] = e
        files: dict[int, tuple[str, bytes, Recording]] = {}
        for i, row in enumerate(rows):
            if "word" not in row:
                continue
            answer = looked_up[row["language"]]
            if isinstance(answer, CommonsUnavailable):
                row["error"] = f"Couldn't look it up: {answer}"
                continue
            found = answer[row["word"]]
            if not found:
                row["skipped"] = "No native recording on Wikimedia Commons."
                continue
            first = found[0]
            row["recording"] = {"speaker": first.speaker, "license": first.license, "page": first.page_url,
                                "credit": first.credit}
            if preview:
                continue
            try:
                audio = await normalize_loudness(await trim_silence(await commons.audio(first)), sample_rate=44100)
            except (CommonsUnavailable, LoudnessError) as e:
                row["error"] = f"Couldn't get the recording: {e}"
                continue
            files[i] = (native_filename(first.title), audio, first)

        if files:

            def save(col: Collection) -> None:
                for i, (filename, audio, rec) in files.items():
                    row = rows[i]
                    note = col.get_note(row["note_id"])
                    if (note["Audio"], note[CREDIT_FIELD]) != row["was"]:
                        row["error"] = "The note changed while the recording was fetched. Nothing was saved; try again."
                        continue
                    name = col.media.write_data(filename, audio)
                    kept = omnilanguage_sound_free(note["Audio"])
                    note["Audio"] = f"{kept} [sound:{name}]" if kept else f"[sound:{name}]"
                    note[CREDIT_FIELD] = rec.credit
                    col.update_note(note)
                    row["audio"] = name

            await self.cm.write(save, media=True)
        return [{k: v for k, v in r.items() if k not in ("was", "language")} for r in rows]


def omnilanguage_sound_free(audio: str) -> str:
    """The Audio field's text with its recordings taken out: a native recording replaces them."""
    from .tools import SOUND

    return SOUND.sub("", audio).strip()


def register(server: MCPServer, cm: CollectionManager, recorder: NativeRecorder) -> None:
    @server.tool(annotations=READ)
    async def native_recordings_setting() -> dict[str, Any]:
        """Whether native recordings are on (Franki's Settings, Voices), and for which languages: a
        language not listed is on unless it's Thai or Greek, which Commons has few of. add_notes keeps
        a native recording in place of an Azure one where it's on."""
        config = await cm.read(lambda col: col.get_config(NATIVE_KEY, {}) or {})
        codes = sorted(set(LANGUAGE_CODES.values()))
        return {"setting": config, "on_for": [c for c in codes if wanted(config, c)]}

    @server.tool(annotations=WRITE)
    async def add_native_recordings(
        note_ids: list[int], overwrite: bool = False, preview: bool = True
    ) -> dict[str, Any]:
        """Puts a native speaker's recording of each Omnilanguage note's Entry in its Audio, from
        Wikimedia Commons (Lingua Libre's first, then Wiktionary's older files), trimmed and leveled,
        with its credit (speaker, license and link, the file's page, and that it was changed) in the
        note's AudioCredit field. Up to 20 notes a call (find them with find_notes).
        - Previews by default: show the user what was found, then call again with preview=false.
        - Any Azure recording in Audio is replaced; a note with none found keeps what it has.
        - Only for languages where Franki's Settings, Voices has native recordings on, and only on a
          note type with an AudioCredit field (add_field adds one; every device syncs first).
        - A note with a native recording already is skipped unless `overwrite`."""
        if len(note_ids) > MAX_NOTES:
            raise ToolError(f"Up to {MAX_NOTES} notes a call; send the rest in another.")
        results = await recorder.keep(note_ids, overwrite=overwrite, preview=preview)
        kept = sum(1 for r in results if "audio" in r)
        found = sum(1 for r in results if "recording" in r)
        return {"preview": preview, "found": found, "kept": kept, "results": results}
