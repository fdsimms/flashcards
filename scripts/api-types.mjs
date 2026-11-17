// Writes src/reader/apiTypes.gen.ts, the app's types for Read & Listen's API, from the schema the
// server exports (server/reader/openapi.json). `npm run api:types` exports the schema and then runs
// this; with --check it changes nothing and fails when the file is stale
// (tests/reader/apiTypes.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';

const root = new URL('..', import.meta.url);
const schemaFile = new URL('server/reader/openapi.json', root);
const typesFile = new URL('src/reader/apiTypes.gen.ts', root);

const header =
  '// Generated from server/reader/openapi.json by `npm run api:types`. Don\'t edit it by hand:\n' +
  '// change the route\'s response model on the server and run that again.\n\n';
const text = header + astToString(await openapiTS(JSON.parse(readFileSync(schemaFile, 'utf8'))));

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(typesFile, 'utf8'); } catch {}
  if (current !== text) {
    console.error('src/reader/apiTypes.gen.ts is stale: run `npm run api:types`.');
    process.exit(1);
  }
} else {
  writeFileSync(typesFile, text);
}
