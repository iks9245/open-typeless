// eslint-plugin-import's resolver does not read package "exports" subpaths
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node. Flows that need the Electron runtime live in
// tests/integration and run through scripts/run-integration-tests.mjs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // better-sqlite3 and child processes are safest in separate processes
    pool: 'forks',
    testTimeout: 20000,
  },
});
