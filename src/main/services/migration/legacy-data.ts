import * as fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

export interface LegacyMigrationDependencies {
  fs: Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'renameSync' | 'cpSync' | 'rmSync' | 'lstatSync' | 'readdirSync' | 'readlinkSync' | 'writeFileSync'>;
  processCommands: () => string;
  checkpoint: (file: string) => void;
  showMessage: (message: string) => void;
  exit: (code: number) => void;
  logger: { info: (message: string, details?: unknown) => void; error: (message: string, details?: unknown) => void };
}

export interface LegacyMigrationResult { migrated: boolean; blocked: boolean }

/** Keep runtime APIs injectable; tests use real temporary files and SQLite WALs. */
export const legacyMigrationDefaults = {
  fs,
  processCommands: () => execFileSync('ps', ['-axo', 'command'], { encoding: 'utf8' }),
  checkpoint: (file: string): void => {
    const db = new Database(file, { fileMustExist: true });
    try {
      const result = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
      if (result.some(row => row.busy !== 0)) throw new Error('Legacy database WAL checkpoint is busy');
    } finally { db.close(); }
  },
};

/** Verify every entry before removing any source data after an EXDEV copy. */
function verifyCopy(source: string, target: string, files: LegacyMigrationDependencies['fs']): void {
  const original = files.lstatSync(source);
  const copied = files.lstatSync(target);
  if (original.isDirectory() && copied.isDirectory()) {
    const names = files.readdirSync(source).sort();
    if (JSON.stringify(names) !== JSON.stringify(files.readdirSync(target).sort())) throw new Error('Migration directory copy is incomplete');
    for (const name of names) verifyCopy(path.join(source, name), path.join(target, name), files);
  } else if (original.isSymbolicLink() && copied.isSymbolicLink()) {
    if (files.readlinkSync(source) !== files.readlinkSync(target)) throw new Error('Migration symlink copy differs');
  } else if (!original.isFile() || !copied.isFile() || original.size !== copied.size) {
    throw new Error('Migration file copy size differs');
  }
}

/** Synchronous, before Electron opens storage. A failed move never discards remaining data. */
export function migrateLegacyData(appData: string, userData: string, deps: LegacyMigrationDependencies): LegacyMigrationResult {
  const result: LegacyMigrationResult = { migrated: false, blocked: false };
  const old = path.join(appData, 'open-typeless');
  const sourceDb = path.join(old, 'open-typeless.db');
  const targetDb = path.join(userData, 'waae.db');
  const files = deps.fs;
  const move = (source: string, target: string) => {
    try { files.renameSync(source, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      files.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      verifyCopy(source, target, files);
      files.rmSync(source, { recursive: true });
    }
  };

  try {
    if (!files.existsSync(sourceDb) || files.existsSync(targetDb)) return result;
    // Match the executable, not helper processes or shell commands mentioning its name.
    if (deps.processCommands().split('\n').some(command => /^\s*\/(?:[^/\n]*[^\s/]\/)*open-typeless\.app\/Contents\/MacOS\/open-typeless(?:\s|$)/.test(command))) {
      result.blocked = true;
      deps.showMessage('請先結束舊版 open-typeless，再重新開啟 WaaE。');
      deps.exit(0);
      return result;
    }
    deps.checkpoint(sourceDb);
    files.mkdirSync(userData, { recursive: true });
    move(sourceDb, targetDb);
    result.migrated = true;
    for (const suffix of ['-wal', '-shm']) {
      if (files.existsSync(sourceDb + suffix)) move(sourceDb + suffix, targetDb + suffix);
    }
    for (const name of ['models', 'audio', 'Local Storage']) {
      const source = path.join(old, name);
      const target = path.join(userData, name);
      if (!files.existsSync(source)) continue;
      if (files.existsSync(target)) {
        deps.logger.info('Skipping existing migration target', { source, target });
        continue;
      }
      move(source, target);
    }
    files.writeFileSync(path.join(old, 'MOVED-TO-WaaE.txt'), `資料已搬移至 WaaE：\n${userData}\n`, 'utf8');
    deps.logger.info('Legacy data migrated', { old, userData });
  } catch (error) {
    deps.logger.error('Legacy migration stopped; remaining old data was retained', { error, old, userData });
  }
  return result;
}
