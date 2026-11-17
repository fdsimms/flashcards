/**
 * src/reader/apiTypes.gen.ts is generated from the server's schema (server/reader/openapi.json,
 * itself checked against the routes by server/reader/tests/test_openapi.py), so the app's types for
 * a converted route can't drift from what the server sends. This fails when the file is stale.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('apiTypes.gen.ts is generated from the current openapi.json', () => {
  const check = () => execFileSync(process.execPath, ['scripts/api-types.mjs', '--check'], { cwd: join(__dirname, '../..'), stdio: 'pipe' });
  expect(check, 'src/reader/apiTypes.gen.ts is stale: run `npm run api:types`').not.toThrow();
});
