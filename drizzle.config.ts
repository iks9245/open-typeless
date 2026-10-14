import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations into ./drizzle from the main-process schema.
// Run `pnpm db:generate` after changing src/main/db/schema.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
