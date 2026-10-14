/**
 * Database startup.
 * Opens the application database and applies migrations, degrading instead of crashing.
 */

import log from 'electron-log';
import { closeDatabase, initDatabaseClient } from './client';
import { runMigrations } from './migrate';

const logger = log.scope('database-init');

/**
 * Open the database and apply pending migrations.
 *
 * On any failure the connection is closed, so isDatabaseAvailable() reports false and
 * history/settings fall back to their storage-unavailable behavior. Dictation keeps working.
 *
 * @param filename - Database file; defaults to userData/open-typeless.db
 * @param migrationsFolder - Migration SQL folder; defaults to the dev or packaged location
 * @returns true if the database is ready
 */
export function initDatabase(filename?: string, migrationsFolder?: string): boolean {
  try {
    const db = initDatabaseClient(filename);
    if (migrationsFolder === undefined) {
      runMigrations(db);
    } else {
      runMigrations(db, migrationsFolder);
    }
    logger.info('Database ready');
    return true;
  } catch (error) {
    logger.error('Database unavailable; history and settings persistence disabled', { error });
    // A connection left open after a failed migration would report itself as available
    closeDatabase();
    return false;
  }
}
