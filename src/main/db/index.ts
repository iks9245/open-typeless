/**
 * Database module exports.
 * Re-exports the client, schema, and migration utilities.
 */

export {
  openDatabase,
  initDatabaseClient,
  getDb,
  isDatabaseAvailable,
  closeDatabase,
} from './client';
export type { AppDatabase } from './client';
export { transcriptions, settings, historyEmbeddings } from './schema';
export type { Transcription, NewTranscription, SettingRow } from './schema';
export { resolveMigrationsFolder, runMigrations } from './migrate';
export { initDatabase } from './init';
