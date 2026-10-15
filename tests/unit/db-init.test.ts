import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase, isDatabaseAvailable, runMigrations, settings, transcriptions } from '../../src/main/db';

describe('database initialization', () => {
  let directory: string;
  let restrictedDir: string | undefined;
  const migrations = path.resolve(__dirname, '../../drizzle');

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-db-'));
  });

  afterEach(() => {
    closeDatabase();
    if (restrictedDir) fs.chmodSync(restrictedDir, 0o700);
    restrictedDir = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('opens a temporary database and exposes migrated tables through getDb', () => {
    const filename = path.join(directory, 'database.sqlite');
    expect(initDatabase(filename, migrations)).toBe(true);
    expect(isDatabaseAvailable()).toBe(true);
    expect(fs.existsSync(filename)).toBe(true);
    expect(getDb().select().from(transcriptions).all()).toEqual([]);
    expect(getDb().select().from(settings).all()).toEqual([]);
  });

  it('closes the connection when the migrations directory is missing', () => {
    const filename = path.join(directory, 'database.sqlite');
    expect(initDatabase(filename, path.join(directory, 'missing-migrations'))).toBe(false);
    expect(isDatabaseAvailable()).toBe(false);
    expect(() => getDb()).toThrow('not initialized');
    // Reopening proves the failed startup released the singleton.
    expect(initDatabase(filename, migrations)).toBe(true);
  });

  it('returns false when the database directory is unwritable', () => {
    restrictedDir = path.join(directory, 'read-only');
    fs.mkdirSync(restrictedDir);
    fs.chmodSync(restrictedDir, 0o500);
    expect(initDatabase(path.join(restrictedDir, 'database.sqlite'), migrations)).toBe(false);
    expect(isDatabaseAvailable()).toBe(false);
    expect(() => getDb()).toThrow('not initialized');
  });

  it('applies each migration only once when the runner is called twice', () => {
    expect(initDatabase(path.join(directory, 'database.sqlite'), migrations)).toBe(true);
    const db = getDb();
    const first = db.all(sql`SELECT * FROM __drizzle_migrations ORDER BY id`);
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    expect(first).toHaveLength(journal.entries.length);
    expect(first.length).toBeGreaterThan(0);
    db.insert(settings).values({ key: 'history.enabled', value: false, updatedAt: 1 }).run();
    runMigrations(db, migrations);
    expect(db.all(sql`SELECT * FROM __drizzle_migrations ORDER BY id`)).toEqual(first);
    expect(db.select().from(settings).all()).toEqual([{ key: 'history.enabled', value: false, updatedAt: 1 }]);
  });

  it('closes the singleton idempotently and prevents further access', () => {
    expect(initDatabase(path.join(directory, 'database.sqlite'), migrations)).toBe(true);
    closeDatabase();
    expect(isDatabaseAvailable()).toBe(false);
    expect(() => getDb()).toThrow('not initialized');
    expect(() => closeDatabase()).not.toThrow();
    expect(isDatabaseAvailable()).toBe(false);
  });
});
