"""
Anki itself, as the other device in a sync test: runs Anki's own client (the `anki` Python
package, the same Rust code Anki desktop and AnkiMobile use) against a sync server, so the
live sync test in tests/anki/sync/live.test.ts can check Franki against what Anki does.

    python sync-device.py <collection.anki2> <server url> <command> [args...]

Signs in as FRANKI_SYNC_USER / FRANKI_SYNC_PASS (default user / pass). Commands, which can be
chained with "+" as separate arguments:

    upload                      full upload (this collection replaces the server's)
    download                    full download
    sync                        normal sync; prints the result
    study <n>                   answers up to n due cards with Good
    add-note <deck> <front> <back> [tags]   adds a Basic note (making the deck if needed)
    delete-note <front>         deletes the Basic notes with that front
    rename-deck <old> <new>
    add-deck <name>
    delete-deck <name>
    set-new-per-day <deck> <n>  changes the deck's options preset
    edit-template <notetype> <text>   appends text to the first card template's back
    add-field <notetype> <name> adds a field (a change Anki's own merge refuses: full sync)
    integrity                   prints SQLite's integrity check, run with Anki's collation
    add-media <name> <text>     writes a media file and refers to it from a new note
    media-sync                  syncs media
    dump                        prints the collection's rows as JSON
"""

import base64
import json
import os
import sys

from anki.collection import Collection


def main():
    path, server, *rest = sys.argv[1:]
    commands = [[]]
    for a in rest:
        if a == "+":
            commands.append([])
        else:
            commands[-1].append(a)

    col = Collection(path)
    signed_in = []

    def auth_():
        if not signed_in:
            signed_in.append(col.sync_login(os.environ.get("FRANKI_SYNC_USER", "user"), os.environ.get("FRANKI_SYNC_PASS", "pass"), server))
        return signed_in[0]

    out = {}
    for cmd, *args in commands:
        auth = auth_() if cmd in ("upload", "download", "sync", "media-sync") else None
        if cmd == "upload":
            col.close_for_full_sync()
            col.full_upload_or_download(auth=auth, server_usn=None, upload=True)
            col.reopen(after_full_sync=True)
        elif cmd == "download":
            col.close_for_full_sync()
            col.full_upload_or_download(auth=auth, server_usn=None, upload=False)
            col.reopen(after_full_sync=True)
        elif cmd == "sync":
            r = col.sync_collection(auth, False)
            out["sync"] = {"required": int(r.required), "message": r.server_message}
        elif cmd == "study":
            answered = []
            for _ in range(int(args[0])):
                card = col.sched.getCard()
                if not card:
                    break
                card.start_timer()
                col.sched.answerCard(card, 3)
                answered.append(card.id)
            out["studied"] = answered
        elif cmd == "add-note":
            deck, front, back, *tags = args
            did = col.decks.id(deck)
            note = col.new_note(col.models.by_name("Basic"))
            note["Front"], note["Back"] = front, back
            if tags:
                note.tags = tags[0].split()
            col.add_note(note, did)
            out["note"] = note.id
        elif cmd == "delete-note":
            nids = col.find_notes(f'"Front:{args[0]}"')
            col.remove_notes(nids)
            out["deleted"] = list(nids)
        elif cmd == "rename-deck":
            d = col.decks.by_name(args[0])
            col.decks.rename(d, args[1])
        elif cmd == "add-deck":
            out["deck"] = col.decks.id(args[0])
        elif cmd == "collapse-deck":
            # The deck list's collapsed state, as Anki's deck browser sets it.
            from anki.decks import DeckCollapseScope
            col.decks.set_collapsed(col.decks.id(args[0], create=False), args[1] == "1", DeckCollapseScope.REVIEWER)
        elif cmd == "delete-deck":
            col.decks.remove([col.decks.id(args[0], create=False)])
        elif cmd == "edit-template":
            nt = col.models.by_name(args[0])
            nt["tmpls"][0]["afmt"] += args[1]
            col.models.update_dict(nt)
        elif cmd == "add-field":
            nt = col.models.by_name(args[0])
            col.models.add_field(nt, col.models.new_field(args[1]))
            col.models.update_dict(nt)
        elif cmd == "integrity":
            out["integrity"] = col.db.list("pragma integrity_check")
        elif cmd == "set-new-per-day":
            d = col.decks.by_name(args[0])
            conf = col.decks.config_dict_for_deck_id(d["id"])
            conf["new"]["perDay"] = int(args[1])
            col.decks.update_config(conf)
        elif cmd == "add-media":
            name = col.media.write_data(args[0], args[1].encode())
            note = col.new_note(col.models.by_name("Basic"))
            note["Front"], note["Back"] = f'<img src="{name}">', "media"
            col.add_note(note, col.decks.id("Default"))
            out["media"] = name
        elif cmd == "media-sync":
            # Runs in the background; wait for it.
            import time
            col.sync_media(auth)
            time.sleep(0.2)
            while col.media_sync_status().active:
                time.sleep(0.1)
        elif cmd == "dump":
            db = col.db
            b64 = lambda v: base64.b64encode(bytes(v)).decode()
            out["dump"] = {
                "col": db.first("select crt, mod, scm, usn, ls from col"),
                "cards": db.all("select * from cards order by id"),
                "notes": db.all("select id, guid, mid, mod, usn, tags, flds, sfld, csum from notes order by id"),
                "revlog": db.all("select * from revlog order by id"),
                "decks": [[r[0], r[1], r[2], r[3], b64(r[4]), b64(r[5])] for r in db.all("select id, name, mtime_secs, usn, common, kind from decks order by id")],
                "deck_config": [[r[0], r[1], r[2], r[3], b64(r[4])] for r in db.all("select id, name, mtime_secs, usn, config from deck_config order by id")],
                "notetypes": [[r[0], r[1], r[2], r[3], b64(r[4])] for r in db.all("select id, name, mtime_secs, usn, config from notetypes order by id")],
                "fields": [[r[0], r[1], r[2], b64(r[3])] for r in db.all("select ntid, ord, name, config from fields order by ntid, ord")],
                "templates": [[r[0], r[1], r[2], r[3], r[4], b64(r[5])] for r in db.all("select ntid, ord, name, mtime_secs, usn, config from templates order by ntid, ord")],
                "tags": db.all("select tag, usn, collapsed from tags order by tag"),
                "config": {k: json.loads(bytes(v)) for k, v in db.all("select key, val from config")},
                "graves": db.all("select oid, type from graves order by oid"),
            }
        else:
            raise SystemExit(f"unknown command {cmd}")
    col.close()
    print(json.dumps(out))


main()
