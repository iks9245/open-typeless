import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import log from 'electron-log';
import { getDb } from '../../db';
import { historyService } from '../history';
import { settingsService } from '../settings';
import { MemoryIndexer } from './indexer';
import { MemoryService } from './memory.service';
import type { IndexerDependencies } from './types';

const deps: IndexerDependencies = {
  getDb, now: Date.now, readFile: file => readFile(file, 'utf8'), env: process.env, homedir,
  fetch: globalThis.fetch, timers: { setTimeout, clearTimeout }, logger: log.scope('memory'),
  getSettings: () => settingsService.get(), settingsService,
  subscribeHistory: listener => {
    historyService.on('changed', listener);
    return () => { historyService.off('changed', listener); };
  },
};
export const memoryIndexer = new MemoryIndexer(deps);
export const memoryService = new MemoryService(deps, memoryIndexer);
