---
paths:
  - "src/db/**"
  - "src/ui/Backup.tsx"
  - "tests/db/**"
---

# The database and backup

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that
load by path" there). A comment that cites "CLAUDE.md" for one of these sections means this file.

## Backup

- **A backup is `VACUUM INTO` a file plus a `media` table of the media folder, shared through the
  share sheet; a restore replaces each table's rows inside one transaction** (`restorePlan` in
  `src/db/backup.ts`), copying only the columns both sides have, so a backup from before a
  migration still restores, then rewrites the media folder from the backup's. A new table that
  holds the user's data goes in `RESTORED_TABLES`, or a restore silently leaves it behind.
  `settings` is deliberately not in it: when this phone last backed up isn't the backup's to say.
- **The kept Anki collection travels in the backup too** (`anki_collection`, in 1 MB pieces), with
  the settings that say what of it was already sent (`ANKI_SETTING_KEYS`). Without it, a restore
  would bring back answers that could never reach Anki.
- **Automatic backups are `backupTo` without the media table** (`autoBackupTo`; rules in
  `src/db/autoBackup.ts`, files in `src/ui/autoBackup.ts`), kept in the documents folder's
  `backups`. They don't set `last_backup_at`: a copy on the phone is lost with the phone, so the
  reminder and the deck list still ask for one kept elsewhere. Restoring one makes another first and
  doesn't prune, so the one picked can't be removed by it.

## Database

- **A new column is appended to `MIGRATIONS` in `sqliteRepo.ts`**, never added to the
  `CREATE TABLE`, which only runs on a fresh install. Each entry is skipped when `PRAGMA table_info`
  shows the column already exists. Don't switch to a `user_version` counter: it has to be kept in
  step by hand and desyncs when tables are recreated without resetting it.
- **A one-time backfill is behind a done flag**, or it costs a full table scan on every launch.
- Dates are ISO strings; booleans are `0`/`1`; `fields`, `tags` and `sched` are JSON text.
