import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyMigrationDefaults, migrateLegacyData, type LegacyMigrationDependencies } from '../../src/main/services/migration/legacy-data';

describe('legacy data migration', () => {
  let root: string;
  let old: string;
  let target: string;
  let deps: LegacyMigrationDependencies;
  const seed = (name: string, content = name) => {
    const file = path.join(old, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const run = () => migrateLegacyData(root, target, deps);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'waae-migration-'));
    old = path.join(root, 'open-typeless');
    target = path.join(root, 'WaaE');
    deps = {
      ...legacyMigrationDefaults, fs: { ...fs }, processCommands: vi.fn(() => ''),
      checkpoint: vi.fn(), showMessage: vi.fn(), exit: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
    };
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('checkpoints real WAL data and moves storage while retaining caches and the PID', () => {
    fs.mkdirSync(old);
    const file = path.join(old, 'open-typeless.db');
    const writer = new Database(file);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      writer.exec("CREATE TABLE proof (text TEXT); INSERT INTO proof VALUES ('WAL data')");
      expect(fs.statSync(file + '-wal').size).toBeGreaterThan(0);
      deps.checkpoint = legacyMigrationDefaults.checkpoint;
      for (const name of ['models/model.bin', 'audio/2026/test.wav', 'Local Storage/leveldb/data', 'Cache/cache', 'whisper-server.pid']) seed(name);
      expect(run()).toEqual({ migrated: true, blocked: false });
      const moved = new Database(path.join(target, 'waae.db'), { readonly: true });
      try { expect(moved.prepare('SELECT text FROM proof').get()).toEqual({ text: 'WAL data' }); }
      finally { moved.close(); }
      expect(fs.existsSync(file)).toBe(false);
      for (const name of ['models/model.bin', 'audio/2026/test.wav', 'Local Storage/leveldb/data']) {
        expect(fs.readFileSync(path.join(target, name), 'utf8')).toBe(name);
        expect(fs.existsSync(path.join(old, name))).toBe(false);
      }
      expect(fs.readFileSync(path.join(old, 'MOVED-TO-WaaE.txt'), 'utf8')).toContain(target);
      expect(fs.existsSync(path.join(old, 'Cache/cache'))).toBe(true);
      expect(fs.existsSync(path.join(old, 'whisper-server.pid'))).toBe(true);
      expect(fs.existsSync(path.join(target, 'whisper-server.pid'))).toBe(false);
    } finally { writer.close(); }
  });

  it.each(['missing old', 'existing new'])('skips %s without process inspection or checkpoint', scenario => {
    if (scenario === 'existing new') {
      seed('open-typeless.db');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'waae.db'), 'existing');
    }
    expect(run()).toEqual({ migrated: false, blocked: false });
    expect(deps.processCommands).not.toHaveBeenCalled();
    expect(deps.checkpoint).not.toHaveBeenCalled();
  });

  it.each([
    '/Applications/open-typeless.app/Contents/MacOS/open-typeless --flag',
    '/Users/Test User/My Apps/open-typeless.app/Contents/MacOS/open-typeless',
  ])('prompts and exits without moving anything for the old executable: %s', command => {
    seed('open-typeless.db');
    deps.processCommands = () => command + '\n';
    expect(run()).toEqual({ migrated: false, blocked: true });
    expect(deps.showMessage).toHaveBeenCalledWith('請先結束舊版 open-typeless，再重新開啟 WaaE。');
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.checkpoint).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(old, 'open-typeless.db'))).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('ignores helpers and unrelated commands mentioning the old executable', () => {
    seed('open-typeless.db');
    // A helper's executable is named "open-typeless Helper", not the old main executable.
    deps.processCommands = () => '/Applications/open-typeless.app/Contents/Frameworks/open-typeless Helper.app/Contents/MacOS/open-typeless Helper\n/bin/echo /Applications/open-typeless.app/Contents/MacOS/open-typeless';
    expect(run().migrated).toBe(true);
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('moves leftover WAL/SHM files after the checkpoint', () => {
    for (const name of ['open-typeless.db', 'open-typeless.db-wal', 'open-typeless.db-shm']) seed(name);
    expect(run().migrated).toBe(true);
    for (const suffix of ['', '-wal', '-shm']) expect(fs.existsSync(path.join(target, 'waae.db' + suffix))).toBe(true);
  });

  it('skips existing directories and logs without overwriting them', () => {
    seed('open-typeless.db'); seed('models/old.bin'); seed('audio/test.wav');
    fs.mkdirSync(path.join(target, 'models'), { recursive: true });
    fs.writeFileSync(path.join(target, 'models/new.bin'), 'new');
    expect(run().migrated).toBe(true);
    expect(fs.existsSync(path.join(old, 'models/old.bin'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'models/new.bin'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(target, 'models/old.bin'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'audio/test.wav'))).toBe(true);
    expect(deps.logger.info).toHaveBeenCalledWith('Skipping existing migration target', expect.anything());
  });

  it('stops a partial failure and retains remaining old data', () => {
    seed('open-typeless.db'); seed('models/model.bin'); seed('audio/test.wav'); seed('Local Storage/data');
    deps.fs.renameSync = (source, destination) => {
      if (source === path.join(old, 'audio')) throw new Error('permission denied');
      fs.renameSync(source, destination);
    };
    expect(run()).toEqual({ migrated: true, blocked: false });
    expect(fs.existsSync(path.join(target, 'waae.db'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'models/model.bin'))).toBe(true);
    expect(fs.existsSync(path.join(old, 'audio/test.wav'))).toBe(true);
    expect(fs.existsSync(path.join(old, 'Local Storage/data'))).toBe(true);
    expect(fs.existsSync(path.join(old, 'MOVED-TO-WaaE.txt'))).toBe(false);
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('leaves everything in place if process inspection or checkpoint fails', () => {
    seed('open-typeless.db'); seed('models/model.bin');
    deps.processCommands = () => { throw new Error('ps denied'); };
    expect(run().migrated).toBe(false);
    deps.processCommands = () => '';
    deps.checkpoint = () => { throw new Error('checkpoint failed'); };
    expect(run().migrated).toBe(false);
    expect(fs.existsSync(path.join(old, 'open-typeless.db'))).toBe(true);
    expect(fs.existsSync(path.join(old, 'models/model.bin'))).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('copies and verifies files and nested directories on EXDEV before removing sources', () => {
    seed('open-typeless.db'); seed('models/nested/model.bin'); seed('Local Storage/data');
    deps.fs.renameSync = () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); };
    expect(run().migrated).toBe(true);
    for (const [source, destination] of [['open-typeless.db', 'waae.db'], ['models/nested/model.bin', 'models/nested/model.bin'], ['Local Storage/data', 'Local Storage/data']]) {
      expect(fs.readFileSync(path.join(target, destination), 'utf8')).toBe(source);
      expect(fs.existsSync(path.join(old, source))).toBe(false);
    }
  });

  it('keeps the source if an EXDEV copy has the wrong size', () => {
    seed('open-typeless.db', 'database'); seed('models/model.bin');
    deps.fs.renameSync = () => { throw Object.assign(new Error('cross device'), { code: 'EXDEV' }); };
    deps.fs.cpSync = (_source, destination) => { fs.writeFileSync(destination, 'x'); };
    expect(run().migrated).toBe(false);
    expect(fs.readFileSync(path.join(old, 'open-typeless.db'), 'utf8')).toBe('database');
    expect(fs.existsSync(path.join(old, 'models/model.bin'))).toBe(true);
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
