/**
 * SQLite migration runner.
 * Resolves development or packaged SQL migrations and applies them with Drizzle.
 */

import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDatabase } from './client';

const logger = log.scope('database-migrate');

export function resolveMigrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(app.getAppPath(), 'drizzle');
}

/**
 * Apply pending migrations. The caller handles failures and feature degradation.
 */
export function runMigrations(
  db: AppDatabase,
  migrationsFolder = resolveMigrationsFolder(),
): void {
  logger.info('Running database migrations', { migrationsFolder });
  migrate(db, { migrationsFolder });
  logger.info('Database migrations completed');
}
