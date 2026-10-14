/**
 * Application history facade with lazy Electron paths and change subscriptions.
 * Recording operations degrade to no-ops when storage or settings are unavailable.
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { getDb, isDatabaseAvailable, type AppDatabase } from '../../db';
import type { HistoryChange, ListHistoryResult, TranscriptionItem } from '../../../shared/types/history';
import type { InsertStatus } from '../../../shared/constants/history';
import { settingsService } from '../settings';
import {
  beginHistory,
  clearHistory,
  completeHistory,
  deleteHistory,
  failHistory,
  getHistory,
  listHistory,
  markHistoryInserted,
  markHistoryProcessing,
  pruneHistory,
  recoverHistory,
} from './procedures';
import type {
  AudioDependencies,
  BeginHistoryInput,
  CompleteHistoryInput,
  HistoryResult,
  HistoryService,
  HistoryWriteDependencies,
} from './types';

const logger = log.scope('history');
const events = new EventEmitter();

function onChanged(change: HistoryChange): void {
  for (const listener of events.rawListeners('changed')) {
    try {
      listener.call(events, { ...change });
    } catch (error) {
      logger.warn('History change listener failed', { error });
    }
  }
}

function writeDependencies(): HistoryWriteDependencies | null {
  if (!isDatabaseAvailable()) return null;
  const result = settingsService.get();
  if (result.success === false || !result.data.history.enabled) return null;
  return { now: Date.now, settings: result.data, onChanged };
}

function audioDependencies(deps: HistoryWriteDependencies): AudioDependencies {
  return {
    ...deps,
    // Even this path is resolved only when the operation actually needs audio.
    get audioDir() { return path.join(app.getPath('userData'), 'audio'); },
  };
}

function record<T>(fallback: T, operation: (db: AppDatabase, deps: HistoryWriteDependencies) => T): T {
  try {
    const deps = writeDependencies();
    return deps === null ? fallback : operation(getDb(), deps);
  } catch (error) {
    logger.error('History recording unavailable', { error });
    return fallback;
  }
}

/** Maintenance of existing rows runs whenever storage is available, regardless of history.enabled. */
function maintain<T>(fallback: T, operation: (db: AppDatabase, deps: HistoryWriteDependencies) => T): T {
  try {
    if (!isDatabaseAvailable()) return fallback;
    const result = settingsService.get();
    if (result.success === false) return fallback;
    return operation(getDb(), { now: Date.now, settings: result.data, onChanged });
  } catch (error) {
    logger.error('History maintenance unavailable', { error });
    return fallback;
  }
}

function read<T>(operation: (db: AppDatabase) => HistoryResult<T>): HistoryResult<T> {
  if (!isDatabaseAvailable()) return { success: false, error: 'History storage is unavailable' };
  try {
    return operation(getDb());
  } catch (error) {
    logger.error('History operation failed', { error });
    return { success: false, error: 'History operation failed' };
  }
}

async function remove<T>(
  operation: (db: AppDatabase, deps: AudioDependencies) => Promise<HistoryResult<T>>,
): Promise<HistoryResult<T>> {
  if (!isDatabaseAvailable()) return { success: false, error: 'History storage is unavailable' };
  try {
    const settings = settingsService.get();
    if (settings.success === false) return settings;
    return await operation(getDb(), audioDependencies({ now: Date.now, settings: settings.data, onChanged }));
  } catch (error) {
    logger.error('History deletion failed', { error });
    return { success: false, error: 'History deletion failed' };
  }
}

export const historyService: HistoryService = {
  begin(input: BeginHistoryInput): string | null {
    return record(null, (db, deps) => beginHistory(db, input, { ...deps, appVersion: app.getVersion() }));
  },

  markProcessing(id: string | null): boolean {
    return record(false, (db, deps) => markHistoryProcessing(db, id, deps));
  },

  complete(id: string | null, input: CompleteHistoryInput): Promise<boolean> {
    return record(Promise.resolve(false), (db, deps) => completeHistory(db, id, input, audioDependencies(deps)));
  },

  fail(id: string | null, code: string, message: string): boolean {
    return record(false, (db, deps) => failHistory(db, id, code, message, deps));
  },

  markInserted(id: string | null, status: InsertStatus, error?: string): boolean {
    return record(false, (db, deps) => markHistoryInserted(db, id, status, error, deps));
  },

  list(input: unknown = {}): HistoryResult<ListHistoryResult> {
    return read((db) => listHistory(db, input));
  },

  get(input: unknown): HistoryResult<TranscriptionItem | null> {
    return read((db) => getHistory(db, input));
  },

  delete(input: unknown): Promise<HistoryResult<{ deleted: boolean }>> {
    return remove((db, deps) => deleteHistory(db, input, deps));
  },

  clear(input: unknown = {}): Promise<HistoryResult<{ deleted: number }>> {
    return remove((db, deps) => clearHistory(db, input, deps));
  },

  recover(): number {
    return maintain(0, (db, deps) => recoverHistory(db, deps));
  },

  prune(retentionDays?: number | null): Promise<number> {
    return maintain(Promise.resolve(0), (db, deps) => pruneHistory(
      db,
      retentionDays === undefined ? deps.settings.history.retentionDays : retentionDays,
      audioDependencies(deps),
    ));
  },

  on(event: 'changed', listener: (change: HistoryChange) => void): HistoryService {
    events.on(event, listener);
    return historyService;
  },

  off(event: 'changed', listener: (change: HistoryChange) => void): HistoryService {
    events.off(event, listener);
    return historyService;
  },
};
