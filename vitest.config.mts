import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // One worker runs many test files rather than starting fresh for each: the suite is pure logic
    // with no module-level setup between files, and a worker per file was most of its run time
    // (about 13s against under 3s). The price is that a file can leak state into the next one in
    // its worker, so spies are restored after every test (`restoreMocks`), and CI runs the suite
    // shuffled, which turns a leak into a failure.
    isolate: false,
    restoreMocks: true,
  },
});
