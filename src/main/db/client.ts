/**
 * Main-process SQLite client.
 * Opens configured connections and manages the application database singleton.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const logger = log.scope('database-client');

export type AppDatabase = BetterSQLite3Database<typeof schema>;

let databaseClient: { sqlite: Database.Database; db: AppDatabase } | null = null;

/**
 * Open an independent connection. Explicit filenames do not require Electron APIs.
 */
export function openDatabase(filename?: string): { sqlite: Database.Database; db: AppDatabase } {
  const databasePath = filename ?? path.join(app.getPath('userData'), 'open-typeless.db');

  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);

  try {
    if (databasePath !== ':memory:') {
      sqlite.pragma('journal_mode = WAL');
    }
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('synchronous = NORMAL');

    const db = drizzle(sqlite, { schema });
    logger.info('Database opened', { filename: databasePath });
    return { sqlite, db };
  } catch (error) {
    try {
      sqlite.close();
    } catch (closeError) {
      logger.error('Failed to close database after setup failure', { error: closeError });
    }
    throw error;
  }
}

/**
 * Initialize the singleton once and return its Drizzle client.
 */
export function initDatabaseClient(filename?: string): AppDatabase {
  if (databaseClient) {
    throw new Error('Database client is already initialized');
  }

  databaseClient = openDatabase(filename);
  return databaseClient.db;
}

export function getDb(): AppDatabase {
  if (!databaseClient) {
    throw new Error('Database client is not initialized. Call initDatabaseClient() first.');
  }

  return databaseClient.db;
}

export function isDatabaseAvailable(): boolean {
  return databaseClient?.sqlite.open ?? false;
}

/**
 * Release the singleton connection without interrupting application shutdown.
 */
export function closeDatabase(): void {
  const client = databaseClient;
  databaseClient = null;

  if (!client) {
    return;
  }

  try {
    client.sqlite.close();
    logger.info('Database closed');
  } catch (error) {
    logger.error('Failed to close database', { error });
  }
}
