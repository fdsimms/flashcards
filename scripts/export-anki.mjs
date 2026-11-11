#!/usr/bin/env node
// Exports your Anki collection to one file the app's Import screen reads: every note and card with
// its scheduling and FSRS memory state, each deck's limits and FSRS settings, each note type's
// templates and styling, and the images and sounds the notes use.
//
//   node scripts/export-anki.mjs                       # the only profile, or lists them
//   node scripts/export-anki.mjs --profile "User 1"
//   node scripts/export-anki.mjs path/to/collection.anki2 --out ~/Desktop/anki-export.sqlite
//
// An --out ending in .json writes the JSON alone, without media.
//
// Needs Node 22.13 or later (node:sqlite). Close Anki first, so everything it has written is in
// the collection file. The collection is copied before it's read and the original is never
// opened, so this can't damage it.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exportCollection, writeBundle } from './lib/ankiCollection.mjs';

/** Where Anki keeps its profiles on each desktop platform. */
function ankiBaseDir() {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'Anki2');
  if (platform() === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Anki2');
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'Anki2');
}

function parseArgs(argv) {
  const args = { out: 'anki-export.sqlite' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args.path = a;
  }
  return args;
}

function findCollection(args) {
  if (args.path) return resolve(args.path);
  const base = ankiBaseDir();
  if (!existsSync(base)) throw new Error(`Couldn't find Anki's folder at ${base}. Pass the path to collection.anki2 instead.`);
  const profiles = readdirSync(base).filter((d) => existsSync(join(base, d, 'collection.anki2')));
  if (args.profile) {
    if (!profiles.includes(args.profile)) throw new Error(`No profile "${args.profile}". Profiles: ${profiles.join(', ')}`);
    return join(base, args.profile, 'collection.anki2');
  }
  if (profiles.length === 1) return join(base, profiles[0], 'collection.anki2');
  throw new Error(`Found ${profiles.length} profiles (${profiles.join(', ')}). Pick one with --profile "<name>".`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/export-anki.mjs [collection.anki2] [--profile <name>] [--out <file.sqlite | file.json>]');
    return;
  }
  const path = findCollection(args);
  const data = await exportCollection(path);
  let media = 0;
  if (args.out.toLowerCase().endsWith('.json')) writeFileSync(args.out, JSON.stringify(data));
  else ({ media } = await writeBundle(args.out, data, join(dirname(path), 'collection.media')));
  const decks = Object.keys(data.deckConfigs).length;
  console.log(
    `Exported ${data.notes.length} notes, ${data.cards.length} cards, ${data.noteTypes.length} note types, ` +
      `settings for ${decks} decks and ${media} media files from ${path}`,
  );
  console.log(`Wrote ${resolve(args.out)}. Put it in iCloud Drive or Files, then import it in the app.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
