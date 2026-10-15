/**
 * Storage startup in the Electron main process: degraded mode and crash recovery.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { TMP_DIR, assert, run, test } from './harness';

run(async () => {
  const db = await import('../../src/main/db');
  const { historyService } = await import('../../src/main/services/history');
  const { settingsService } = await import('../../src/main/services/settings');
  const drizzle = path.resolve('drizzle');

  await test('a missing migrations folder degrades instead of crashing', () => {
    assert(db.initDatabase(path.join(TMP_DIR, 'a.db'), path.join(TMP_DIR, 'missing')) === false, 'init fails');
    assert(!db.isDatabaseAvailable(), 'connection closed after the failed migration');
    const list = historyService.list();
    assert(!list.success && /unavailable/.test(list.error), 'history reports unavailable', list);
    assert(historyService.begin({ engine: 'whisper.cpp' }) === null, 'recording is a no-op');
    const settings = settingsService.get();
    assert(settings.success && settings.data.history.enabled, 'settings fall back to defaults', settings);
    const update = settingsService.update({ input: { autoInsert: false } });
    assert(!update.success, 'settings update reports unavailable', update);
  });

  await test('an unwritable data directory degrades instead of crashing', () => {
    const locked = path.join(TMP_DIR, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    try {
      assert(db.initDatabase(path.join(locked, 'sub', 'x.db'), drizzle) === false, 'init fails');
      assert(!db.isDatabaseAvailable(), 'still unavailable');
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  await test('a normal start creates the database in userData', () => {
    assert(db.initDatabase(undefined, drizzle), 'init succeeds');
    assert(existsSync(path.join(TMP_DIR, 'userData', 'open-typeless.db')), 'database file created');
  });

  await test('a session cut off by a crash is marked interrupted on the next launch', () => {
    const id = historyService.begin({ engine: 'whisper.cpp' });
    assert(typeof id === 'string', 'session begun');
    db.closeDatabase();
    db.closeDatabase();
    assert(db.initDatabase(undefined, drizzle), 'relaunch succeeds');
    assert(historyService.recover() === 1, 'one session recovered');
    const row = historyService.get(id);
    assert(row.success && row.data?.status === 'failed' && row.data.errorCode === 'interrupted', 'row interrupted', row);
    const migrations = db.getDb().get<{ c: number }>(sql`select count(*) as c from __drizzle_migrations`);
    // Each migration in the journal is applied exactly once, however many launches there were
    const journal = JSON.parse(readFileSync(path.join(drizzle, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    assert(migrations.c === journal.entries.length, 'migrations applied once', { applied: migrations.c, journal: journal.entries.length });
    db.closeDatabase();
  });
});
